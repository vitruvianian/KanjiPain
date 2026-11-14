import { DefaultScheduler, Rating, type Grade as FsrsGrade } from 'ts-fsrs';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Grade } from '../../src/domain/types';
import { FsrsClockRollbackError, initializeFsrsAdapter } from '../../src/scheduler/fsrs-adapter';
import {
  deserializeFsrsCard,
  deserializeFsrsLog,
  serializeFsrsCard,
  serializeFsrsLog,
  UnsupportedFsrsEnvelopeError,
} from '../../src/scheduler/serialization';
import type { SchedulerAdapter } from '../../src/scheduler/types';

const createdAt = Date.parse('2026-01-02T03:04:05.678Z');
const secondReviewAt = Date.parse('2026-01-12T03:04:05.678Z');
const cardId = 'k-6e56:production';

const directSchedulerOptions = {
  version: 'FSRS-7' as const,
  desiredRetention: 0.9,
  enableShortTerm: false,
  enableFuzz: false,
  maximumInterval: 36_500,
};

const ratings: readonly (readonly [Grade, FsrsGrade])[] = [
  ['got', Rating.Good],
  ['barely', Rating.Hard],
  ['missed', Rating.Again],
];

let adapter: SchedulerAdapter;

beforeAll(async () => {
  adapter = await initializeFsrsAdapter();
});

function expectFiniteCard(card: ReturnType<SchedulerAdapter['create']>['card']): void {
  expect(Number.isFinite(card.card.stability)).toBe(true);
  expect(Number.isFinite(card.card.stabilityFast)).toBe(true);
  expect(Number.isFinite(card.card.difficulty)).toBe(true);
  expect(Number.isFinite(card.card.scheduledDays)).toBe(true);
  expect(Number.isFinite(card.card.dueAt)).toBe(true);
  expect(card.card.dueAt).toBeGreaterThanOrEqual(0);
}

describe('pinned FSRS adapter', () => {
  it('initializes once and creates an immutable, complete FSRS-7 card', async () => {
    const result = adapter.create({ cardId, now: createdAt });

    expect(await initializeFsrsAdapter()).toBe(adapter);
    expect(result.card).toEqual({
      adapterVersion: 1,
      packageVersion: '6.0.0',
      model: 'FSRS-7',
      card: {
        stability: 0,
        stabilityFast: 0,
        difficulty: 0,
        state: 0,
        scheduleStatus: 'new',
        dueAt: createdAt,
        lastReviewAt: null,
        cardId,
        reps: 0,
        lapses: 0,
        scheduledDays: 0,
        learningStep: 0,
      },
    });
    expect(result.dueAt).toBe(createdAt);
    expectFiniteCard(result.card);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.card)).toBe(true);
    expect(Object.isFrozen(result.card.card)).toBe(true);
  });

  it.each(ratings)('maps %s to the matching pinned-library grade', async (grade, rating) => {
    const directScheduler = await DefaultScheduler(directSchedulerOptions);
    const initial = adapter.create({ cardId, now: createdAt }).card;
    const direct = directScheduler.review({
      card: deserializeFsrsCard(initial),
      grade: rating,
      now: new Date(createdAt),
    });

    const actual = adapter.review({ card: initial, grade, now: createdAt });

    expect(actual.card).toEqual(serializeFsrsCard(direct.card));
    expect(actual.log).toEqual(serializeFsrsLog(direct.revlog));
    expect(actual.log.revlog.rating).toBe(rating);
    expect(actual.dueAt).toBe(actual.card.card.dueAt);
    expectFiniteCard(actual.card);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(Object.isFrozen(actual.log.revlog)).toBe(true);
  });

  it('produces identical output for the same state, grade, and time', () => {
    const initial = adapter.create({ cardId, now: createdAt }).card;

    const first = adapter.review({ card: initial, grade: 'got', now: createdAt });
    const second = adapter.review({ card: initial, grade: 'got', now: createdAt });

    expect(second).toEqual(first);
  });

  it('does not mutate serialized input state', () => {
    const initial = adapter.create({ cardId, now: createdAt }).card;
    const snapshot = JSON.stringify(initial);

    adapter.review({ card: initial, grade: 'barely', now: createdAt });

    expect(JSON.stringify(initial)).toBe(snapshot);
  });

  it('preserves every card and revlog field through JSON serialization', async () => {
    const directScheduler = await DefaultScheduler(directSchedulerOptions);
    const initial = directScheduler.newCard({ cardId, now: new Date(createdAt) });
    const reviewed = directScheduler.review({
      card: initial,
      grade: Rating.Good,
      now: new Date(createdAt),
    });

    const cardEnvelope = JSON.parse(JSON.stringify(serializeFsrsCard(reviewed.card))) as unknown;
    const logEnvelope = JSON.parse(JSON.stringify(serializeFsrsLog(reviewed.revlog))) as unknown;

    expect(deserializeFsrsCard(cardEnvelope)).toEqual(reviewed.card);
    expect(deserializeFsrsLog(logEnvelope)).toEqual(reviewed.revlog);
    expect(Object.keys(deserializeFsrsCard(cardEnvelope)).sort()).toEqual(
      Object.keys(reviewed.card).sort(),
    );
    expect(Object.keys(deserializeFsrsLog(logEnvelope)).sort()).toEqual(
      Object.keys(reviewed.revlog).sort(),
    );
  });

  it('matches a direct second review after a card round trip', async () => {
    const directScheduler = await DefaultScheduler(directSchedulerOptions);
    const initial = directScheduler.newCard({ cardId, now: new Date(createdAt) });
    const first = directScheduler.review({
      card: initial,
      grade: Rating.Good,
      now: new Date(createdAt),
    });
    const roundTripped = deserializeFsrsCard(
      JSON.parse(JSON.stringify(serializeFsrsCard(first.card))),
    );

    const directSecond = directScheduler.review({
      card: first.card,
      grade: Rating.Hard,
      now: new Date(secondReviewAt),
    });
    const roundTrippedSecond = directScheduler.review({
      card: roundTripped,
      grade: Rating.Hard,
      now: new Date(secondReviewAt),
    });

    expect(roundTrippedSecond).toEqual(directSecond);
  });

  it.each([{ packageVersion: '6.0.1' }, { model: 'FSRS-6' }, { adapterVersion: 2 }])(
    'clearly rejects unsupported envelope metadata: $model$packageVersion',
    (override) => {
      const supported = adapter.create({ cardId, now: createdAt }).card;
      const unsupported = { ...supported, ...override };

      expect(() => deserializeFsrsCard(unsupported)).toThrow(UnsupportedFsrsEnvelopeError);
      expect(() => deserializeFsrsCard(unsupported)).toThrow(/expected adapter 1, ts-fsrs 6\.0\.0/);
    },
  );

  it('rejects clock rollback without producing or mutating output state', () => {
    const initial = adapter.create({ cardId, now: createdAt }).card;
    const reviewed = adapter.review({ card: initial, grade: 'got', now: createdAt }).card;
    const snapshot = JSON.stringify(reviewed);

    expect(() => adapter.review({ card: reviewed, grade: 'missed', now: createdAt - 1 })).toThrow(
      FsrsClockRollbackError,
    );
    expect(JSON.stringify(reviewed)).toBe(snapshot);
  });

  it('does not accept Easy as an application grade', () => {
    const initial = adapter.create({ cardId, now: createdAt }).card;

    expect(() =>
      adapter.review({
        card: initial,
        grade: 'easy' as Grade,
        now: createdAt,
      }),
    ).toThrow();
  });
});
