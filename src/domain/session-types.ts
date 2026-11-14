import type {
  CardRecord,
  Grade,
  KanjiEntry,
  KanjiId,
  ReviewEvent,
  RevealedAttemptDraft,
  SettingsRecord,
  Stroke,
  UnixMs,
  UnrevealedAttemptDraft,
} from './types';

export type SessionStatus = 'active' | 'completed' | 'ended';
export type SessionItemStatus = 'pending' | 'done' | 'skipped';

export interface PrimarySessionItem {
  id: string;
  cardId: string;
  kanjiId: KanjiId;
  origin: 'due' | 'new';
  status: SessionItemStatus;
  expectedCardVersion: number | null;
}

export interface GapCompletion {
  cardId: string;
  eventId: string;
}

export interface RematchSessionItem {
  id: string;
  cardId: string;
  ordinal: 1 | 2;
  afterOtherCompletions: GapCompletion[];
  status: SessionItemStatus;
  expectedCardVersion: number | null;
}

export interface SelectingPhase {
  kind: 'selecting';
}

export interface IntroductionPhase {
  kind: 'introduction';
  itemId: string;
  cardId: string;
  kanjiId: KanjiId;
}

export interface PromptPhase {
  kind: 'prompt';
  itemId: string;
  cardId: string;
  expectedCardVersion: number;
  draft: UnrevealedAttemptDraft;
}

export interface FeedbackPhase {
  kind: 'feedback';
  itemId: string;
  cardId: string;
  expectedCardVersion: number;
  draft: RevealedAttemptDraft;
}

export interface RepairPhase {
  kind: 'repair';
  itemId: string;
  cardId: string;
  committedEventId: string;
  targetHidden: boolean;
  practiceStrokes: Stroke[];
}

export interface SummaryPhase {
  kind: 'summary';
}

export type SessionPhase =
  SelectingPhase | IntroductionPhase | PromptPhase | FeedbackPhase | RepairPhase | SummaryPhase;

export interface SessionRecord {
  id: string;
  status: SessionStatus;
  revision: number;
  startedAt: UnixMs;
  endedAt: UnixMs | null;
  startedLocalDay: string;
  datasetVersion: string;
  primaryLimit: number;
  primaryItems: PrimarySessionItem[];
  rematchItems: RematchSessionItem[];
  phase: SessionPhase;
  completedEventIds: string[];
}

export interface PlanSessionInput {
  readonly cards: readonly CardRecord[];
  readonly catalog: readonly KanjiEntry[];
  readonly settings: SettingsRecord;
  readonly introducedToday: number;
  readonly now: UnixMs;
}

export interface SessionPlan {
  readonly primaryItems: readonly PrimarySessionItem[];
  readonly dueCount: number;
  readonly newCount: number;
}

export type NextItemDecision =
  | {
      readonly kind: 'item';
      readonly itemType: 'primary' | 'rematch';
      readonly itemId: string;
    }
  | {
      readonly kind: 'short-rematch-offer';
      readonly itemId: string;
      readonly cardId: string;
    }
  | {
      readonly kind: 'complete';
    };

export type OpenItemTarget =
  | {
      readonly kind: 'introduction';
    }
  | {
      readonly kind: 'prompt';
      readonly expectedCardVersion: number;
      readonly draft: UnrevealedAttemptDraft;
    };

export type SessionReducerEvent =
  | {
      readonly type: 'open-item';
      readonly itemId: string;
      readonly selection: 'automatic' | 'short-rematch';
      readonly target: OpenItemTarget;
    }
  | {
      readonly type: 'hide-introduction';
      readonly expectedCardVersion: number;
      readonly draft: UnrevealedAttemptDraft;
    }
  | {
      readonly type: 'save-draft';
      readonly draft: UnrevealedAttemptDraft;
    }
  | {
      readonly type: 'reveal';
      readonly reason: 'compare' | 'surrender';
      readonly revealedAt: UnixMs;
    }
  | {
      readonly type: 'commit-grade';
      readonly reviewEvent: ReviewEvent & { readonly grade: Grade };
      readonly retryItemId?: string;
    }
  | {
      readonly type: 'skip-ambiguity';
      readonly reviewEvent: ReviewEvent & {
        readonly kind: 'ambiguous';
        readonly grade: null;
      };
    }
  | {
      readonly type: 'update-repair';
      readonly targetHidden: boolean;
      readonly practiceStrokes: readonly Stroke[];
    }
  | {
      readonly type: 'complete-repair';
    }
  | {
      readonly type: 'skip-item';
      readonly itemId: string;
    }
  | {
      readonly type: 'complete';
      readonly endedAt: UnixMs;
    }
  | {
      readonly type: 'finish';
      readonly endedAt: UnixMs;
    };

export interface SessionSummary {
  readonly independentReviews: number;
  readonly newCharactersIntroduced: number;
  readonly missesRecovered: number;
  readonly needsAnotherRound: number;
}

export type CharacterLearningStatus = 'unseen' | 'introduced' | 'developing' | 'reliable';

export interface CharacterStatus {
  readonly learning: CharacterLearningStatus;
  readonly due: boolean;
  readonly paused: boolean;
}
