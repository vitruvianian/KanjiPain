import { DefaultScheduler, Rating, type DefaultScheduler as FsrsScheduler } from 'ts-fsrs';
import { z } from 'zod';

import type { Grade } from '../domain/types';
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

const schedulerOptions = Object.freeze({
  version: 'FSRS-7' as const,
  desiredRetention: 0.9,
  enableShortTerm: false,
  enableFuzz: false,
  maximumInterval: 36_500,
});

const ratingByGrade: Readonly<Record<Grade, 1 | 2 | 3>> = Object.freeze({
  got: Rating.Good,
  barely: Rating.Hard,
  missed: Rating.Again,
});

let schedulerPromise: Promise<FsrsScheduler> | undefined;
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

function loadScheduler(): Promise<FsrsScheduler> {
  schedulerPromise ??= DefaultScheduler(schedulerOptions);
  return schedulerPromise;
}

function immutableCreateResult(result: SchedulerCreateResult): SchedulerCreateResult {
  return Object.freeze(result);
}

function immutableReviewResult(result: SchedulerReviewResult): SchedulerReviewResult {
  return Object.freeze(result);
}

function createAdapter(scheduler: FsrsScheduler): SchedulerAdapter {
  return Object.freeze({
    create(input: SchedulerCreateInput): SchedulerCreateResult {
      const validated = createInputSchema.parse(input);
      const fsrsCard = scheduler.newCard({
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

      const result = scheduler.review({
        card: fsrsCard,
        grade: ratingByGrade[grade],
        now: new Date(now),
      });
      const card = serializeFsrsCard(result.card);
      const log = serializeFsrsLog(result.revlog);

      return immutableReviewResult({ card, log, dueAt: card.card.dueAt });
    },
  });
}

export function initializeFsrsAdapter(): Promise<SchedulerAdapter> {
  adapterPromise ??= loadScheduler().then(createAdapter);
  return adapterPromise;
}
