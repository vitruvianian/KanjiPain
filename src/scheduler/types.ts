import type { Grade, UnixMs } from '../domain/types';

export const FSRS_ADAPTER_VERSION = 1 as const;
export const FSRS_PACKAGE_VERSION = '6.0.0' as const;
export const FSRS_MODEL = 'FSRS-7' as const;

export type FsrsState = 0 | 1 | 2 | 3;
export type FsrsScheduleStatus = 'new' | 'learning' | 'review';
export type FsrsRating = 1 | 2 | 3 | 4;

export interface SerializedFsrsMetadata {
  readonly adapterVersion: typeof FSRS_ADAPTER_VERSION;
  readonly packageVersion: typeof FSRS_PACKAGE_VERSION;
  readonly model: typeof FSRS_MODEL;
}

export interface SerializedFsrsCardData {
  readonly stability: number;
  readonly stabilityFast: number;
  readonly difficulty: number;
  readonly state: FsrsState;
  readonly scheduleStatus: FsrsScheduleStatus;
  readonly dueAt: UnixMs;
  readonly lastReviewAt: UnixMs | null;
  readonly cardId: string | number;
  readonly reps: number;
  readonly lapses: number;
  readonly scheduledDays: number;
  readonly learningStep: number;
}

export interface SerializedFsrsLogData {
  readonly stability: number;
  readonly stabilityFast: number;
  readonly difficulty: number;
  readonly state: FsrsState;
  readonly scheduleStatus: FsrsScheduleStatus;
  readonly rating: FsrsRating;
  readonly dueAt: UnixMs;
  readonly lastReviewAt: UnixMs | null;
  readonly reviewTime: UnixMs;
  readonly cardId: string | number;
  readonly scheduledDays: number;
  readonly learningStep: number;
}

export interface SerializedFsrsCard extends SerializedFsrsMetadata {
  readonly card: Readonly<SerializedFsrsCardData>;
}

export interface SerializedFsrsLog extends SerializedFsrsMetadata {
  readonly revlog: Readonly<SerializedFsrsLogData>;
}

export interface SchedulerCreateInput {
  readonly cardId: string;
  readonly now: UnixMs;
}

export interface SchedulerCreateResult {
  readonly card: SerializedFsrsCard;
  readonly dueAt: UnixMs;
}

export interface SchedulerReviewInput {
  readonly card: SerializedFsrsCard;
  readonly grade: Grade;
  readonly now: UnixMs;
}

export interface SchedulerReviewResult {
  readonly card: SerializedFsrsCard;
  readonly log: SerializedFsrsLog;
  readonly dueAt: UnixMs;
}

export interface SchedulerAdapter {
  create(input: SchedulerCreateInput): SchedulerCreateResult;
  review(input: SchedulerReviewInput): SchedulerReviewResult;
}
