import { DefaultScheduler, Rating, type Grade as FsrsGrade } from 'ts-fsrs';
import { beforeAll, describe, expect, it } from 'vitest';

import { REVIEW_PACES, type Grade, type ReviewPace } from '../../src/domain/types';
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
const DAY = 86_400_000;

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

    // The memory state is the library's own. The due date is too, except that a recalled
    // card never comes back within a day.
    const directCard = serializeFsrsCard(direct.card);
    const floored = grade !== 'missed' && directCard.card.dueAt < createdAt + DAY;
    expect(actual.card).toEqual(
      floored
        ? {
            ...directCard,
            card: {
              ...directCard.card,
              dueAt: createdAt + DAY,
              scheduledDays: Math.max(directCard.card.scheduledDays, 1),
            },
          }
        : directCard,
    );
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

  describe('review pace', () => {
    function intervalsInDays(pace: ReviewPace, count: number): number[] {
      let now = createdAt;
      let card = adapter.create({ cardId, now }).card;
      const days: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const result = adapter.review({ card, grade: 'got', now, pace });
        days.push((result.dueAt - now) / DAY);
        card = result.card;
        now = result.dueAt;
      }
      return days;
    }

    it('keeps the schedule of earlier versions when no pace is given', () => {
      const initial = adapter.create({ cardId, now: createdAt }).card;

      expect(adapter.review({ card: initial, grade: 'got', now: createdAt })).toEqual(
        adapter.review({ card: initial, grade: 'got', now: createdAt, pace: 'relaxed' }),
      );
    });

    it('brings a recalled character back sooner at each faster pace', () => {
      const first = REVIEW_PACES.map((pace) => intervalsInDays(pace, 4));
      for (let step = 0; step < 4; step += 1) {
        const atStep = first.map((days) => days[step] ?? 0);
        expect([...atStep].sort((left, right) => right - left)).toEqual(atStep);
      }
      // The first review of a character graded "Got it": days away when relaxed, tomorrow
      // when frequent.
      expect(first[0]?.[0]).toBeGreaterThan(4);
      expect(intervalsInDays('frequent', 1)).toEqual([1]);
    });

    it('spaces the frequent pace about like Anki: a day, a few days, over a week, weeks', () => {
      const [first = 0, second = 0, third = 0, fourth = 0] = intervalsInDays('frequent', 4);
      expect(first).toBe(1);
      expect(second).toBeGreaterThan(2);
      expect(second).toBeLessThan(6);
      expect(third).toBeGreaterThan(6);
      expect(third).toBeLessThan(16);
      expect(fourth).toBeGreaterThan(14);
      expect(fourth).toBeLessThan(40);
    });

    it('never brings a recalled character back the same day, and a miss at once', () => {
      const initial = adapter.create({ cardId, now: createdAt }).card;
      for (const pace of REVIEW_PACES) {
        for (const grade of ['got', 'barely'] as const) {
          const { dueAt, card } = adapter.review({ card: initial, grade, now: createdAt, pace });
          expect(dueAt).toBeGreaterThanOrEqual(createdAt + DAY);
          expect(card.card.dueAt).toBe(dueAt);
        }
        expect(
          adapter.review({ card: initial, grade: 'missed', now: createdAt, pace }).dueAt,
        ).toBeLessThan(createdAt + DAY);
      }
    });

    it('does not let the pace change what is remembered about a card', () => {
      const initial = adapter.create({ cardId, now: createdAt }).card;
      const relaxed = adapter.review({ card: initial, grade: 'got', now: createdAt }).card.card;
      const intensive = adapter.review({
        card: initial,
        grade: 'got',
        now: createdAt,
        pace: 'intensive',
      }).card.card;

      expect(intensive.stability).toBe(relaxed.stability);
      expect(intensive.difficulty).toBe(relaxed.difficulty);
      expect(intensive.dueAt).toBeLessThan(relaxed.dueAt);
    });
  });
});
