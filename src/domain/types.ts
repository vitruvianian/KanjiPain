import type { SerializedFsrsCard, SerializedFsrsLog } from '../scheduler/types';

export type UnixMs = number;
export type KanjiId = string;
export type Skill = 'production';
export type Grade = 'got' | 'barely' | 'missed';
export type InputMode = 'drawing' | 'paper';
export type HintKey = 'mnemonic' | 'component' | 'stroke-count' | 'full-answer';

export interface KanjiEntry {
  readonly id: KanjiId;
  readonly literal: string;
  readonly grade: 1 | 2 | 3 | 4 | 5 | 6 | 8;
  readonly meanings: readonly string[];
  readonly onReadings: readonly string[];
  readonly kunReadings: readonly string[];
  readonly strokeCount: number;
  readonly frequencyRank: number | null;
  readonly curriculumOrder: number;
}

export interface CatalogManifest {
  schemaVersion: 1;
  datasetVersion: string;
  entryCount: number;
  generatedAt: UnixMs;
  catalogSha256: string;
  teachingNotesSha256: string;
  source: {
    name: 'KANJIDIC2';
    downloadUrl: string;
    documentationUrl: string;
    licenseUrl: string;
    license: 'CC BY-SA 4.0';
    retrievedAt: UnixMs;
    upstreamDate: string | null;
    inputSha256: string;
  };
}

export interface TeachingNote {
  promptOverride?: {
    meaningCue: string;
    readingCues: string[];
  };
  mnemonicHint?: string;
  componentHint?: string;
  source: string;
  reviewer: string;
  reviewedAt?: UnixMs;
}

export type TeachingNotes = Record<KanjiId, TeachingNote>;

export interface SettingsRecord {
  id: 'user';
  dailyNewLimit: number;
  inputMode: InputMode;
  onboardingCompleted: boolean;
}

export interface CardRecord {
  id: string;
  kanjiId: KanjiId;
  skill: Skill;
  introducedAt: UnixMs;
  introducedLocalDay: string;
  introducedInSessionId: string;
  dueAt: UnixMs;
  schedulerState: SerializedFsrsCard;
  scheduledReviewCount: number;
  suspended: boolean;
  version: number;
}

export interface Point {
  x: number;
  y: number;
  /** Brush pressure, 0–1. Absent on strokes saved before pressure was recorded. */
  p?: number | undefined;
  /** Milliseconds since the stroke started. */
  t?: number | undefined;
}

export type Stroke = Point[];

export interface PromptHint {
  key: Exclude<HintKey, 'full-answer'>;
  text: string;
}

export interface ProductionPrompt {
  kanjiId: KanjiId;
  meaningCue: string;
  readingCues: string[];
  hints: PromptHint[];
}

export interface AttemptDraft {
  id: string;
  itemId: string;
  startedAt: UnixMs;
  inputMode: InputMode;
  strokes: Stroke[];
  paperAttemptConfirmed: boolean;
  hintKeysUsed: HintKey[];
  surrendered: boolean;
  revealedAt: UnixMs | null;
}

export type UnrevealedAttemptDraft = Omit<AttemptDraft, 'revealedAt'> & {
  revealedAt: null;
};

export type RevealedAttemptDraft = Omit<AttemptDraft, 'revealedAt'> & {
  revealedAt: UnixMs;
};

export interface ReviewEvent {
  id: string;
  sessionId: string;
  cardId: string;
  itemId: string;
  kind: 'scheduled' | 'rematch' | 'ambiguous';
  isFirstLearningCheck: boolean;
  grade: Grade | null;
  assisted: boolean;
  hintKeysUsed: HintKey[];
  inputMode: InputMode;
  occurredAt: UnixMs;
  durationMs: number;
  beforeVersion: number;
  afterVersion: number;
  schedulerLog: SerializedFsrsLog | null;
  datasetVersion: string;
}

export interface ContentIssue {
  id: string;
  cardId: string;
  eventId: string;
  reason: 'ambiguous-prompt';
  createdAt: UnixMs;
  datasetVersion: string;
}

export interface MetaRecord {
  key: string;
  version: number;
  value: unknown;
}
