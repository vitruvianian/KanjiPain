import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import type { Grade } from '../../src/domain/types';
import { createContentIssueService } from '../../src/services/content-issue-service';
import { StaleRevisionError } from '../../src/storage/errors';
import {
  createHarness,
  openDuePrompt,
  revealDrawnPrompt,
  type ServiceHarness,
} from './service-fixtures';

const databases: { readonly name: string; readonly database: Dexie }[] = [];

async function harness(label: string) {
  const name = `services-review-${label}-${crypto.randomUUID()}`;
  const result = await createHarness(name);
  databases.push({ name, database: result.database });
  return result;
}

afterEach(async () => {
  for (const item of databases.splice(0)) {
    item.database.close();
    await Dexie.delete(item.name);
  }
});

function gradeInput(session: Awaited<ReturnType<typeof revealDrawnPrompt>>, grade: Grade = 'got') {
  if (session.phase.kind !== 'feedback') {
    throw new Error('Review fixture did not reach feedback.');
  }
  return {
    sessionId: session.id,
    attemptId: session.phase.draft.id,
    expectedRevision: session.revision,
    expectedCardVersion: session.phase.expectedCardVersion,
    grade,
  };
}

async function missPrimary(current: ServiceHarness) {
  const feedback = await revealDrawnPrompt(current);
  const result = await current.reviews.commitGrade(gradeInput(feedback, 'missed'));
  return current.sessions.finishRepair(result.session.id, result.session.revision);
}

describe('transactional grading', () => {
  it('deduplicates simultaneous grade submissions and schedules once', async () => {
    const current = await harness('double-submit');
    const feedback = await revealDrawnPrompt(current);
    const input = gradeInput(feedback);

    const [first, second] = await Promise.all([
      current.reviews.commitGrade(input),
      current.reviews.commitGrade(input),
    ]);

    expect(first.event.id).toBe(second.event.id);
    await expect(current.database.events.count()).resolves.toBe(1);
    await expect(current.database.cards.get(first.event.cardId)).resolves.toMatchObject({
      scheduledReviewCount: 2,
      version: 1,
    });
    expect(current.scheduler.review.mock.calls).toHaveLength(1);
  });

  it('rolls back card, event, and queue changes after a failed event write', async () => {
    const current = await harness('rollback');
    const feedback = await revealDrawnPrompt(current);
    const input = gradeInput(feedback, 'missed');
    const cardBefore = await current.database.cards.get(
      feedback.phase.kind === 'feedback' ? feedback.phase.cardId : '',
    );
    const failure = () => {
      throw new Error('forced event failure');
    };
    current.database.events.hook('creating', failure);

    await expect(current.reviews.commitGrade(input)).rejects.toThrow(/committing a review grade/);

    current.database.events.hook('creating').unsubscribe(failure);
    await expect(current.database.events.count()).resolves.toBe(0);
    const cardAfter = await current.database.cards.get(cardBefore?.id ?? 'missing');
    expect(cardAfter).toEqual(cardBefore);
    await expect(current.database.sessions.get(feedback.id)).resolves.toEqual(feedback);
  });

  it('prevents a stale tab from grading newer feedback', async () => {
    const current = await harness('stale-grade');
    const feedback = await revealDrawnPrompt(current);
    const input = gradeInput(feedback);
    await current.database.sessions.update(feedback.id, { revision: feedback.revision + 1 });

    await expect(current.reviews.commitGrade(input)).rejects.toBeInstanceOf(StaleRevisionError);
    await expect(current.database.events.count()).resolves.toBe(0);
  });

  it('forces assisted input submitted as got to missed', async () => {
    const current = await harness('forced-miss');
    const opened = await openDuePrompt(current);
    const saved = await current.sessions.saveDraft(opened.id, opened.revision, {
      strokes: [[{ x: 0.5, y: 0.5 }]],
    });
    const hinted = await current.sessions.requestHint(saved.id, saved.revision);
    const feedback = await current.sessions.revealAnswer(
      hinted.session.id,
      hinted.session.revision,
      'compare',
    );

    const result = await current.reviews.commitGrade(gradeInput(feedback, 'got'));

    expect(result.event).toMatchObject({ grade: 'missed', assisted: true });
    expect(current.scheduler.review.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ grade: 'missed' }),
    );
  });

  it('writes rematch history without changing serialized FSRS card state', async () => {
    const current = await harness('rematch');
    const selecting = await missPrimary(current);
    const opened = await current.sessions.openNextItem(selecting.id, selecting.revision, true);
    const saved = await current.sessions.saveDraft(opened.session.id, opened.session.revision, {
      strokes: [[{ x: 0.5, y: 0.5 }]],
    });
    const feedback = await current.sessions.revealAnswer(saved.id, saved.revision, 'compare');
    if (feedback.phase.kind !== 'feedback') {
      throw new Error('Rematch did not reach feedback.');
    }
    const cardBefore = await current.database.cards.get(feedback.phase.cardId);

    const result = await current.reviews.commitGrade(gradeInput(feedback, 'got'));
    const cardAfter = await current.database.cards.get(feedback.phase.cardId);

    expect(result.event.kind).toBe('rematch');
    expect(result.event.schedulerLog).toBeNull();
    expect(cardAfter).toEqual(cardBefore);
    expect(current.scheduler.review.mock.calls).toHaveLength(1);
  });
});

describe('ambiguity and paused cards', () => {
  it('preserves FSRS state, pauses the card, and cancels its rematch', async () => {
    const current = await harness('ambiguity');
    const selecting = await missPrimary(current);
    const opened = await current.sessions.openNextItem(selecting.id, selecting.revision, true);
    const feedback = await current.sessions.revealAnswer(
      opened.session.id,
      opened.session.revision,
      'surrender',
    );
    if (feedback.phase.kind !== 'feedback') {
      throw new Error('Ambiguity fixture did not reach feedback.');
    }
    const before = await current.database.cards.get(feedback.phase.cardId);

    const result = await current.reviews.flagAmbiguous({
      sessionId: feedback.id,
      attemptId: feedback.phase.draft.id,
      expectedRevision: feedback.revision,
      expectedCardVersion: feedback.phase.expectedCardVersion,
    });
    const after = await current.database.cards.get(feedback.phase.cardId);

    expect(result.event).toMatchObject({ kind: 'ambiguous', grade: null, schedulerLog: null });
    expect(result.session.rematchItems[0]?.status).toBe('skipped');
    expect(after?.schedulerState).toEqual(before?.schedulerState);
    expect(after).toMatchObject({ suspended: true, version: (before?.version ?? 0) + 1 });
    await expect(current.database.contentIssues.count()).resolves.toBe(1);
    if (after === undefined) {
      throw new Error('Ambiguity did not persist the paused card.');
    }

    const issues = createContentIssueService({ database: current.database });
    const resumed = await issues.resumePausedCard(after.id, after.version);
    expect(resumed).toMatchObject({ suspended: false, version: after.version + 1 });
  });
});
