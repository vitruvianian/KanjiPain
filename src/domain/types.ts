import type { SerializedFsrsCard, SerializedFsrsLog } from '../scheduler/types';

export type UnixMs = number;
export type KanjiId = string;
export type Skill = 'production';
export type Grade = 'got' | 'barely' | 'missed';
export type InputMode = 'drawing' | 'paper';
/** What the handwriting checker concluded about a drawn attempt. */
export type CheckerVerdict =
  'match' | 'order' | 'direction' | 'stroke-count' | 'lookalike' | 'mismatch';
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

/**
 * What practice needs to know about a character, whichever deck it comes from. Every
 * `KanjiEntry` is one; custom-deck entries leave the dictionary-only fields out.
 */
export interface StudyEntry {
  readonly id: KanjiId;
  readonly literal: string;
  readonly meanings: readonly string[];
  readonly onReadings: readonly string[];
  readonly kunReadings: readonly string[];
  /** Null when there is no stroke data for the character. */
  readonly strokeCount: number | null;
  readonly curriculumOrder: number;
  /** Custom decks only: the learner's readings, not split into on and kun. */
  readonly readings?: readonly string[] | undefined;
  readonly note?: string | undefined;
  readonly mnemonic?: string | undefined;
}

export const STANDARD_DECK_ID = 'standard';

/** Order in which a custom deck introduces new characters. */
export type DeckOrder = 'imported' | 'stroke-count' | 'shuffled';

export interface DeckRecord {
  id: string;
  name: string;
  kind: 'custom';
  createdAt: UnixMs;
  updatedAt: UnixMs;
  /** Increases with every change to the deck or its entries. */
  revision: number;
  order: DeckOrder;
}

export type StrokeStatus = 'available' | 'unrecognized';

export interface DeckEntryRecord {
  /** `${deckId}:${kanjiId}` */
  id: string;
  deckId: string;
  kanjiId: KanjiId;
  literal: string;
  meanings: string[];
  readingCues: string[];
  note?: string | undefined;
  mnemonic?: string | undefined;
  position: number;
  strokeStatus: StrokeStatus;
  /** From the stroke data; null while the character is unrecognized. */
  strokeCount: number | null;
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
  activeDeckId: string;
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
  /** Present only when the checker judged a drawn attempt. The grade is still the learner's. */
  checkerVerdict?: CheckerVerdict | undefined;
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

/**
 * The cloud copy of one synced record as this device last saw it. A record whose current
 * fingerprint differs has changed locally and still has to be uploaded.
 */
export interface SyncShadowRecord {
  /** `${collection}/${id}` */
  key: string;
  fingerprint: string;
}
