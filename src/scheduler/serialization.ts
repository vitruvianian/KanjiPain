import { z } from 'zod';
import type { DefaultSchedulerCard, DefaultSchedulerRevlog } from 'ts-fsrs';

import {
  FSRS_ADAPTER_VERSION,
  FSRS_MODEL,
  FSRS_PACKAGE_VERSION,
  type SerializedFsrsCard,
  type SerializedFsrsLog,
} from './types';

const maximumDateMs = 8_640_000_000_000_000;
const finiteNumberSchema = z.number();
const nonNegativeNumberSchema = finiteNumberSchema.nonnegative();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const schedulerUnixMsSchema = nonNegativeIntegerSchema.max(maximumDateMs);
const cardIdSchema = z.union([z.string().min(1), finiteNumberSchema]);
const stateSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const scheduleStatusSchema = z.enum(['new', 'learning', 'review']);
const ratingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const metadataShape = {
  adapterVersion: z.literal(FSRS_ADAPTER_VERSION),
  packageVersion: z.literal(FSRS_PACKAGE_VERSION),
  model: z.literal(FSRS_MODEL),
};

export const serializedFsrsCardDataSchema = z.strictObject({
  stability: nonNegativeNumberSchema,
  stabilityFast: nonNegativeNumberSchema,
  difficulty: nonNegativeNumberSchema,
  state: stateSchema,
  scheduleStatus: scheduleStatusSchema,
  dueAt: schedulerUnixMsSchema,
  lastReviewAt: schedulerUnixMsSchema.nullable(),
  cardId: cardIdSchema,
  reps: nonNegativeIntegerSchema,
  lapses: nonNegativeIntegerSchema,
  scheduledDays: nonNegativeNumberSchema,
  learningStep: nonNegativeIntegerSchema,
});

export const serializedFsrsLogDataSchema = z.strictObject({
  stability: nonNegativeNumberSchema,
  stabilityFast: nonNegativeNumberSchema,
  difficulty: nonNegativeNumberSchema,
  state: stateSchema,
  scheduleStatus: scheduleStatusSchema,
  rating: ratingSchema,
  dueAt: schedulerUnixMsSchema,
  lastReviewAt: schedulerUnixMsSchema.nullable(),
  reviewTime: schedulerUnixMsSchema,
  cardId: cardIdSchema,
  scheduledDays: nonNegativeNumberSchema,
  learningStep: nonNegativeIntegerSchema,
});

export const serializedFsrsCardSchema = z.strictObject({
  ...metadataShape,
  card: serializedFsrsCardDataSchema,
});

export const serializedFsrsLogSchema = z.strictObject({
  ...metadataShape,
  revlog: serializedFsrsLogDataSchema,
});

export class UnsupportedFsrsEnvelopeError extends Error {
  constructor(kind: 'card' | 'revlog', value: unknown) {
    const actual = readMetadata(value);
    super(
      `Unsupported FSRS ${kind} envelope (${actual}); expected adapter ${String(FSRS_ADAPTER_VERSION)}, ` +
        `ts-fsrs ${FSRS_PACKAGE_VERSION}, model ${FSRS_MODEL}.`,
    );
    this.name = 'UnsupportedFsrsEnvelopeError';
  }
}

function readMetadata(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return 'metadata unavailable';
  }

  const record = value as Record<string, unknown>;
  return `adapter ${String(record.adapterVersion)}, ts-fsrs ${String(record.packageVersion)}, model ${String(record.model)}`;
}

function assertSupportedEnvelope(value: unknown, kind: 'card' | 'revlog'): void {
  if (typeof value !== 'object' || value === null) {
    throw new UnsupportedFsrsEnvelopeError(kind, value);
  }

  const record = value as Record<string, unknown>;
  if (
    record.adapterVersion !== FSRS_ADAPTER_VERSION ||
    record.packageVersion !== FSRS_PACKAGE_VERSION ||
    record.model !== FSRS_MODEL
  ) {
    throw new UnsupportedFsrsEnvelopeError(kind, value);
  }
}

function dateToUnixMs(value: Date, field: string): number {
  const unixMs = value.getTime();
  const result = schedulerUnixMsSchema.safeParse(unixMs);
  if (!result.success) {
    throw new TypeError(`ts-fsrs returned an invalid ${field} date.`, { cause: result.error });
  }
  return result.data;
}

function unixMsToDate(value: number): Date {
  return new Date(schedulerUnixMsSchema.parse(value));
}

function freezeEnvelope<T extends object>(envelope: T, data: object): Readonly<T> {
  Object.freeze(data);
  return Object.freeze(envelope);
}

export function serializeFsrsCard(card: DefaultSchedulerCard): SerializedFsrsCard {
  const data = serializedFsrsCardDataSchema.parse({
    stability: card.stability,
    stabilityFast: card.stabilityFast,
    difficulty: card.difficulty,
    state: card.state,
    scheduleStatus: card.scheduleStatus,
    dueAt: dateToUnixMs(card.dueAt, 'dueAt'),
    lastReviewAt:
      card.lastReviewAt === null ? null : dateToUnixMs(card.lastReviewAt, 'lastReviewAt'),
    cardId: card.cardId,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduledDays,
    learningStep: card.learningStep,
  });

  return freezeEnvelope(
    {
      adapterVersion: FSRS_ADAPTER_VERSION,
      packageVersion: FSRS_PACKAGE_VERSION,
      model: FSRS_MODEL,
      card: data,
    },
    data,
  );
}

export function deserializeFsrsCard(value: unknown): DefaultSchedulerCard {
  assertSupportedEnvelope(value, 'card');
  const { card } = serializedFsrsCardSchema.parse(value);

  return {
    stability: card.stability,
    stabilityFast: card.stabilityFast,
    difficulty: card.difficulty,
    state: card.state,
    scheduleStatus: card.scheduleStatus,
    dueAt: unixMsToDate(card.dueAt),
    lastReviewAt: card.lastReviewAt === null ? null : unixMsToDate(card.lastReviewAt),
    cardId: card.cardId,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduledDays,
    learningStep: card.learningStep,
  };
}

export function serializeFsrsLog(revlog: DefaultSchedulerRevlog): SerializedFsrsLog {
  const data = serializedFsrsLogDataSchema.parse({
    stability: revlog.stability,
    stabilityFast: revlog.stabilityFast,
    difficulty: revlog.difficulty,
    state: revlog.state,
    scheduleStatus: revlog.scheduleStatus,
    rating: revlog.rating,
    dueAt: dateToUnixMs(revlog.dueAt, 'dueAt'),
    lastReviewAt:
      revlog.lastReviewAt === null ? null : dateToUnixMs(revlog.lastReviewAt, 'lastReviewAt'),
    reviewTime: dateToUnixMs(revlog.reviewTime, 'reviewTime'),
    cardId: revlog.cardId,
    scheduledDays: revlog.scheduledDays,
    learningStep: revlog.learningStep,
  });

  return freezeEnvelope(
    {
      adapterVersion: FSRS_ADAPTER_VERSION,
      packageVersion: FSRS_PACKAGE_VERSION,
      model: FSRS_MODEL,
      revlog: data,
    },
    data,
  );
}

export function deserializeFsrsLog(value: unknown): DefaultSchedulerRevlog {
  assertSupportedEnvelope(value, 'revlog');
  const { revlog } = serializedFsrsLogSchema.parse(value);

  return {
    stability: revlog.stability,
    stabilityFast: revlog.stabilityFast,
    difficulty: revlog.difficulty,
    state: revlog.state,
    scheduleStatus: revlog.scheduleStatus,
    rating: revlog.rating,
    dueAt: unixMsToDate(revlog.dueAt),
    lastReviewAt: revlog.lastReviewAt === null ? null : unixMsToDate(revlog.lastReviewAt),
    reviewTime: unixMsToDate(revlog.reviewTime),
    cardId: revlog.cardId,
    scheduledDays: revlog.scheduledDays,
    learningStep: revlog.learningStep,
  };
}
