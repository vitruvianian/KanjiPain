import { DefaultScheduler, Rating, type DefaultScheduler as FsrsScheduler } from 'ts-fsrs';
import { z } from 'zod';

import { LEGACY_REVIEW_PACE, REVIEW_PACES, type Grade, type ReviewPace } from '../domain/types';
import { deserializeFsrsCard, serializeFsrsCard, serializeFsrsLog } from './serialization';
import type {
  SchedulerAdapter,
  SchedulerCreateInput,
  SchedulerCreateResult,
  SchedulerReviewInput,
  SchedulerReviewResult,
} from './types';

const unixMsSchema = z.number().int().nonnegative().max(8_640_000_000_000_000);
const createInputSchema = z.strictObject({
  cardId: z.string().min(1),
  now: unixMsSchema,
});
const gradeSchema = z.enum(['got', 'barely', 'missed']);

/**
 * Each pace is a retention target: how likely a character should still be remembered when
 * its review comes. A higher target means sooner reviews. Measured for a new character that
 * is always graded "Got it", the reviews come after roughly:
 *
 * - relaxed:   5 days, 26 days, 3 months, 10 months (the only pace before the setting)
 * - steady:    2 days, 9 days, 28 days, 2.4 months
 * - frequent:  1 day, 4 days, 11 days, 25 days (close to Anki's defaults)
 * - intensive: 1 day, 1 day, 3 days, 6 days, 11 days
 */
export const RETENTION_BY_PACE: Readonly<Record<ReviewPace, number>> = Object.freeze({
  relaxed: 0.9,
  steady: 0.93,
  frequent: 0.95,
  intensive: 0.97,
});

/**
 * A character that was recalled never comes back the same day, whatever the model says: the
 * higher targets would otherwise ask for it again within hours. A miss stays due at once.
 */
export const MINIMUM_PASS_INTERVAL_MS = 86_400_000;

const schedulerOptions = Object.freeze({
  version: 'FSRS-7' as const,
  enableShortTerm: false,
  enableFuzz: false,
  maximumInterval: 36_500,
});

const ratingByGrade: Readonly<Record<Grade, 1 | 2 | 3>> = Object.freeze({
  got: Rating.Good,
  barely: Rating.Hard,
  missed: Rating.Again,
});

type Schedulers = Readonly<Record<ReviewPace, FsrsScheduler>>;

let schedulerPromise: Promise<Schedulers> | undefined;
let adapterPromise: Promise<SchedulerAdapter> | undefined;

export class FsrsClockRollbackError extends Error {
  readonly reviewTime: number;
  readonly lastReviewAt: number;

  constructor(reviewTime: number, lastReviewAt: number) {
    super(
      `FSRS review time ${String(reviewTime)} is before the latest scheduled review ${String(lastReviewAt)}.`,
    );
    this.name = 'FsrsClockRollbackError';
    this.reviewTime = reviewTime;
    this.lastReviewAt = lastReviewAt;
  }
}

function loadSchedulers(): Promise<Schedulers> {
  schedulerPromise ??= Promise.all(
    REVIEW_PACES.map(
      async (pace) =>
        [
          pace,
          await DefaultScheduler({
            ...schedulerOptions,
            desiredRetention: RETENTION_BY_PACE[pace],
          }),
        ] as const,
    ),
  ).then((entries) => Object.fromEntries(entries) as Record<ReviewPace, FsrsScheduler>);
  return schedulerPromise;
}

function immutableCreateResult(result: SchedulerCreateResult): SchedulerCreateResult {
  return Object.freeze(result);
}

function immutableReviewResult(result: SchedulerReviewResult): SchedulerReviewResult {
  return Object.freeze(result);
}

function createAdapter(schedulers: Schedulers): SchedulerAdapter {
  return Object.freeze({
    create(input: SchedulerCreateInput): SchedulerCreateResult {
      const validated = createInputSchema.parse(input);
      // A new card is the same at every pace; the pace only matters once it is reviewed.
      const fsrsCard = schedulers[LEGACY_REVIEW_PACE].newCard({
        cardId: validated.cardId,
        now: new Date(validated.now),
      });
      const card = serializeFsrsCard(fsrsCard);

      return immutableCreateResult({ card, dueAt: card.card.dueAt });
    },

    review(input: SchedulerReviewInput): SchedulerReviewResult {
      const now = unixMsSchema.parse(input.now);
      const grade = gradeSchema.parse(input.grade);
      const fsrsCard = deserializeFsrsCard(input.card);
      const lastReviewAt = fsrsCard.lastReviewAt?.getTime() ?? null;

      if (lastReviewAt !== null && now < lastReviewAt) {
        throw new FsrsClockRollbackError(now, lastReviewAt);
      }

      const result = schedulers[input.pace ?? LEGACY_REVIEW_PACE].review({
        card: fsrsCard,
        grade: ratingByGrade[grade],
        now: new Date(now),
      });
      const earliest = now + MINIMUM_PASS_INTERVAL_MS;
      const card = serializeFsrsCard(
        grade !== 'missed' && result.card.dueAt.getTime() < earliest
          ? {
              ...result.card,
              dueAt: new Date(earliest),
              scheduledDays: Math.max(result.card.scheduledDays, 1),
            }
          : result.card,
      );
      const log = serializeFsrsLog(result.revlog);

      return immutableReviewResult({ card, log, dueAt: card.card.dueAt });
    },
  });
}

export function initializeFsrsAdapter(): Promise<SchedulerAdapter> {
  adapterPromise ??= loadSchedulers().then(createAdapter);
  return adapterPromise;
}
