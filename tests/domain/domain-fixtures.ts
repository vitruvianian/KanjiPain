import type { SessionRecord } from '../../src/domain/session-types';
import type {
  CardRecord,
  Grade,
  KanjiEntry,
  ReviewEvent,
  UnrevealedAttemptDraft,
} from '../../src/domain/types';
import type { SerializedFsrsCard, SerializedFsrsLog } from '../../src/scheduler/types';

export const DATASET_VERSION = 'a'.repeat(64);
export const BASE_TIME = 1_800_000_000_000;

export const schedulerState: SerializedFsrsCard = {
  adapterVersion: 1,
  packageVersion: '6.0.0',
  model: 'FSRS-7',
  card: {
    stability: 3,
    stabilityFast: 2,
    difficulty: 4,
    state: 2,
    scheduleStatus: 'review',
    dueAt: BASE_TIME,
    lastReviewAt: BASE_TIME - 1_000,
    cardId: 'fixture',
    reps: 1,
    lapses: 0,
    scheduledDays: 7,
    learningStep: 0,
  },
};

export const schedulerLog: SerializedFsrsLog = {
  adapterVersion: 1,
  packageVersion: '6.0.0',
  model: 'FSRS-7',
  revlog: {
    stability: 2,
    stabilityFast: 1,
    difficulty: 4,
    state: 2,
    scheduleStatus: 'review',
    rating: 3,
    dueAt: BASE_TIME - 1_000,
    lastReviewAt: BASE_TIME - 2_000,
    reviewTime: BASE_TIME - 1_000,
    cardId: 'fixture',
    scheduledDays: 3,
    learningStep: 0,
  },
};

export function entry(index: number): KanjiEntry {
  const codePoint = 0x4e00 + index;
  return {
    id: `k-${codePoint.toString(16)}`,
    literal: String.fromCodePoint(codePoint),
    grade: 1,
    meanings: [`meaning ${String(index)}`],
    onReadings: [`オン${String(index)}`],
    kunReadings: [`くん${String(index)}`],
    strokeCount: index + 1,
    frequencyRank: index + 1,
    curriculumOrder: index,
  };
}

export function card(catalogEntry: KanjiEntry, overrides: Partial<CardRecord> = {}): CardRecord {
  const id = `${catalogEntry.id}:production`;
  return {
    id,
    kanjiId: catalogEntry.id,
    skill: 'production',
    introducedAt: BASE_TIME - 10_000,
    introducedLocalDay: '2027-01-15',
    introducedInSessionId: 'older-session',
    dueAt: BASE_TIME,
    schedulerState: {
      ...schedulerState,
      card: { ...schedulerState.card, cardId: id },
    },
    scheduledReviewCount: 1,
    suspended: false,
    version: 0,
    ...overrides,
  };
}

export function draft(itemId: string, id = `attempt:${itemId}`): UnrevealedAttemptDraft {
  return {
    id,
    itemId,
    startedAt: BASE_TIME,
    inputMode: 'drawing',
    strokes: [[{ x: 0.5, y: 0.5 }]],
    paperAttemptConfirmed: false,
    hintKeysUsed: [],
    surrendered: false,
    revealedAt: null,
  };
}

export function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    status: 'active',
    revision: 0,
    startedAt: BASE_TIME - 1_000,
    endedAt: null,
    startedLocalDay: '2027-01-15',
    datasetVersion: DATASET_VERSION,
    primaryLimit: 20,
    primaryItems: [],
    rematchItems: [],
    phase: { kind: 'selecting' },
    completedEventIds: [],
    ...overrides,
  };
}

interface ReviewEventOptions {
  readonly id: string;
  readonly itemId: string;
  readonly cardId: string;
  readonly grade: Grade;
  readonly kind?: 'scheduled' | 'rematch';
  readonly assisted?: boolean;
  readonly isFirstLearningCheck?: boolean;
  readonly beforeVersion?: number;
}

export function reviewEvent({
  id,
  itemId,
  cardId,
  grade,
  kind = 'scheduled',
  assisted = false,
  isFirstLearningCheck = false,
  beforeVersion = 0,
}: ReviewEventOptions): ReviewEvent & { grade: Grade } {
  return {
    id,
    sessionId: 'session-1',
    cardId,
    itemId,
    kind,
    isFirstLearningCheck,
    grade,
    assisted,
    hintKeysUsed: assisted ? ['stroke-count'] : [],
    inputMode: 'drawing',
    occurredAt: BASE_TIME + 1_000,
    durationMs: 1_000,
    beforeVersion,
    afterVersion: kind === 'scheduled' ? beforeVersion + 1 : beforeVersion,
    schedulerLog: kind === 'scheduled' ? schedulerLog : null,
    datasetVersion: DATASET_VERSION,
  };
}
