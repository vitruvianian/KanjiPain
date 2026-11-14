import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import type { SessionRecord } from '../../src/domain/session-types';
import type { ReviewEvent } from '../../src/domain/types';
import { StaleRevisionError } from '../../src/storage/errors';
import { schedulerLog } from '../domain/domain-fixtures';
import {
  catalogEntry,
  createHarness,
  DATASET_VERSION,
  dueCard,
  NOW,
  openDuePrompt,
} from './service-fixtures';

const databases: { readonly name: string; readonly database: Dexie }[] = [];

async function harness(label: string, entryCount = 1) {
  const name = `services-session-${label}-${crypto.randomUUID()}`;
  const result = await createHarness(
    name,
    Array.from({ length: entryCount }, (_, index) => catalogEntry(index)),
  );
  databases.push({ name, database: result.database });
  return result;
}

afterEach(async () => {
  for (const item of databases.splice(0)) {
    item.database.close();
    await Dexie.delete(item.name);
  }
});

describe('session creation', () => {
  it('serializes simultaneous starts into one active session', async () => {
    const current = await harness('single-active');

    const [first, second] = await Promise.all([
      current.sessions.startOrResumeSession(),
      current.sessions.startOrResumeSession(),
    ]);

    expect(first.id).toBe(second.id);
    await expect(current.database.sessions.where('status').equals('active').count()).resolves.toBe(
      1,
    );
  });

  it('ends a dataset-mismatched active session without deleting its events', async () => {
    const current = await harness('dataset-mismatch');
    const obsolete: SessionRecord = {
      id: 'obsolete',
      status: 'active',
      revision: 0,
      startedAt: NOW - 1_000,
      endedAt: null,
      startedLocalDay: '2027-01-15',
      datasetVersion: 'd'.repeat(64),
      primaryLimit: 20,
      primaryItems: [],
      rematchItems: [],
      phase: { kind: 'selecting' },
      completedEventIds: ['old-event'],
    };
    const event: ReviewEvent = {
      id: 'old-event',
      sessionId: obsolete.id,
      cardId: 'old-card',
      itemId: 'old-item',
      kind: 'scheduled',
      isFirstLearningCheck: false,
      grade: 'got',
      assisted: false,
      hintKeysUsed: [],
      inputMode: 'drawing',
      occurredAt: NOW - 500,
      durationMs: 500,
      beforeVersion: 0,
      afterVersion: 1,
      schedulerLog,
      datasetVersion: obsolete.datasetVersion,
    };
    await current.database.sessions.add(obsolete);
    await current.database.events.add(event);

    const replacement = await current.sessions.startOrResumeSession();

    expect(replacement.id).not.toBe(obsolete.id);
    expect(replacement.datasetVersion).toBe(DATASET_VERSION);
    await expect(current.database.sessions.get(obsolete.id)).resolves.toMatchObject({
      status: 'ended',
      phase: { kind: 'summary' },
    });
    await expect(current.database.events.get(event.id)).resolves.toEqual(event);
  });
});

describe('introductions', () => {
  it('creates a card only when its introduction opens and consumes one slot once', async () => {
    const current = await harness('introduction', 3);
    await current.database.settings.update('user', { dailyNewLimit: 2 });
    const started = await current.sessions.startOrResumeSession();

    await expect(current.database.cards.count()).resolves.toBe(0);
    const opened = await current.sessions.openNextItem(started.id, started.revision);

    expect(opened.session.phase.kind).toBe('introduction');
    await expect(current.database.cards.count()).resolves.toBe(1);
    await expect(current.database.cards.toArray()).resolves.toMatchObject([
      { introducedInSessionId: started.id },
    ]);
    expect(started.primaryItems).toHaveLength(2);
  });

  it('rechecks the device local day when a planned introduction opens after midnight', async () => {
    const current = await harness('midnight', 2);
    await current.database.settings.update('user', { dailyNewLimit: 1 });
    const started = await current.sessions.startOrResumeSession();
    expect(started.primaryItems).toHaveLength(1);
    current.clock.value = new Date(2027, 0, 16, 0, 1).getTime();

    const opened = await current.sessions.openNextItem(started.id, started.revision);
    const cards = await current.database.cards.toArray();

    expect(opened.session.phase.kind).toBe('introduction');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.introducedLocalDay).toBe('2027-01-16');
  });

  it('shows an introduction again for an exposed card with no scheduled reviews', async () => {
    const current = await harness('unreviewed');
    const entry = catalogEntry(0);
    await current.database.settings.update('user', { dailyNewLimit: 0 });
    await current.database.cards.put(dueCard(entry, { scheduledReviewCount: 0 }));

    const started = await current.sessions.startOrResumeSession();
    const opened = await current.sessions.openNextItem(started.id, started.revision);

    expect(opened.session.phase.kind).toBe('introduction');
    await expect(current.database.cards.count()).resolves.toBe(1);
  });
});

describe('draft durability and concurrency', () => {
  it('persists hints and surrender before feedback is returned', async () => {
    const current = await harness('reload-feedback');
    const opened = await openDuePrompt(current);
    const hinted = await current.sessions.requestHint(opened.id, opened.revision);
    const revealed = await current.sessions.revealAnswer(
      hinted.session.id,
      hinted.session.revision,
      'surrender',
    );

    const reloaded = await current.sessions.getSession(revealed.id);
    expect(reloaded?.phase).toMatchObject({
      kind: 'feedback',
      draft: { hintKeysUsed: ['stroke-count'], surrendered: true },
    });
  });

  it('prevents a stale tab from overwriting a newer saved draft', async () => {
    const current = await harness('stale-draft');
    const opened = await openDuePrompt(current);
    const saved = await current.sessions.saveDraft(opened.id, opened.revision, {
      strokes: [[{ x: 0.25, y: 0.25 }]],
    });

    await expect(
      current.sessions.saveDraft(opened.id, opened.revision, {
        strokes: [[{ x: 0.75, y: 0.75 }]],
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    const reloaded = await current.sessions.getSession(saved.id);
    expect(reloaded?.phase).toMatchObject({
      kind: 'prompt',
      draft: { strokes: [[{ x: 0.25, y: 0.25 }]] },
    });
  });

  it('finishes mid-prompt without fabricating a grade or changing the due card', async () => {
    const current = await harness('finish-prompt');
    const entry = catalogEntry(0);
    const opened = await openDuePrompt(current, entry);
    const before = await current.database.cards.get(`${entry.id}:production`);

    const ended = await current.sessions.finishSession(opened.id, opened.revision);
    const after = await current.database.cards.get(`${entry.id}:production`);

    expect(ended.status).toBe('ended');
    expect(ended.phase).toEqual({ kind: 'summary' });
    await expect(current.database.events.count()).resolves.toBe(0);
    expect(after).toEqual(before);
  });
});
