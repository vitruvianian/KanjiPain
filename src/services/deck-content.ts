import { hasCue } from '../domain/prompts';
import { deckEntryRecordSchema, deckRecordSchema } from '../domain/schemas';
import {
  STANDARD_DECK_ID,
  type DeckEntryRecord,
  type DeckOrder,
  type DeckRecord,
  type KanjiId,
  type StudyEntry,
  type TeachingNote,
} from '../domain/types';
import type { KanjiPainDatabase } from '../storage/database';
import { InvalidPersistedDataError } from '../storage/errors';
import type { CatalogRepository } from './catalog';

export const STANDARD_DECK_NAME = 'Standard (Jōyō)';

export interface DeckSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: 'standard' | 'custom';
  readonly revision: number;
}

/**
 * One deck's characters as practice sees them. A deck decides which cards a session uses and
 * what the prompt says; the cards themselves are shared between decks.
 */
export interface DeckContent {
  readonly deck: DeckSummary;
  /** Every character in the deck, in the order new ones are introduced. */
  readonly entries: readonly StudyEntry[];
  /** The entries a session can use: those with a meaning or a reading to prompt with. */
  readonly practicable: readonly StudyEntry[];
  byId(id: KanjiId): StudyEntry | undefined;
  noteFor(id: KanjiId): TeachingNote | undefined;
}

const standardContent = new WeakMap<CatalogRepository, DeckContent>();

/** The Standard deck: the bundled Jōyō catalog, read-only. */
export function standardDeckContent(catalog: CatalogRepository): DeckContent {
  const cached = standardContent.get(catalog);
  if (cached !== undefined) return cached;
  const content: DeckContent = Object.freeze({
    deck: Object.freeze({
      id: STANDARD_DECK_ID,
      name: STANDARD_DECK_NAME,
      kind: 'standard' as const,
      revision: 0,
    }),
    entries: catalog.all,
    practicable: catalog.all,
    byId: (id: KanjiId) => catalog.byId(id),
    noteFor: (id: KanjiId) => catalog.teachingNotes[id],
  });
  standardContent.set(catalog, content);
  return content;
}

/** A stable pseudo-random rank, so a shuffled deck keeps one order across sessions. */
function shuffleRank(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function orderDeckEntries(
  entries: readonly DeckEntryRecord[],
  order: DeckOrder,
): DeckEntryRecord[] {
  const byPosition = (left: DeckEntryRecord, right: DeckEntryRecord) =>
    left.position - right.position || left.id.localeCompare(right.id);
  const sorted = [...entries];
  if (order === 'stroke-count') {
    // Characters without stroke data have no count; they come last.
    return sorted.sort(
      (left, right) =>
        (left.strokeCount ?? Infinity) - (right.strokeCount ?? Infinity) || byPosition(left, right),
    );
  }
  if (order === 'shuffled') {
    return sorted.sort(
      (left, right) => shuffleRank(left.id) - shuffleRank(right.id) || byPosition(left, right),
    );
  }
  return sorted.sort(byPosition);
}

export function studyEntryFromRecord(record: DeckEntryRecord, curriculumOrder: number): StudyEntry {
  return Object.freeze({
    id: record.kanjiId,
    literal: record.literal,
    meanings: Object.freeze([...record.meanings]),
    onReadings: Object.freeze([]),
    kunReadings: Object.freeze([]),
    readings: Object.freeze([...record.readingCues]),
    strokeCount: record.strokeCount,
    curriculumOrder,
    ...(record.note === undefined ? {} : { note: record.note }),
    ...(record.mnemonic === undefined ? {} : { mnemonic: record.mnemonic }),
  });
}

export function customDeckContent(
  deck: DeckRecord,
  records: readonly DeckEntryRecord[],
): DeckContent {
  const entries = Object.freeze(orderDeckEntries(records, deck.order).map(studyEntryFromRecord));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return Object.freeze({
    deck: Object.freeze({
      id: deck.id,
      name: deck.name,
      kind: 'custom' as const,
      revision: deck.revision,
    }),
    entries,
    practicable: Object.freeze(entries.filter(hasCue)),
    byId: (id: KanjiId) => byId.get(id),
    noteFor: () => undefined,
  });
}

export function parseDeck(value: unknown): DeckRecord {
  const result = deckRecordSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('deck', result.error);
  }
  return result.data;
}

export function parseDeckEntry(value: unknown): DeckEntryRecord {
  const result = deckEntryRecordSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('deck entry', result.error);
  }
  return result.data;
}

/**
 * Reads a deck's content; `undefined` when a custom deck no longer exists. Safe to call inside
 * a transaction that includes the `decks` and `deckEntries` tables.
 */
export async function loadDeckContent(
  database: KanjiPainDatabase,
  catalog: CatalogRepository,
  deckId: string | undefined,
): Promise<DeckContent | undefined> {
  if (deckId === undefined || deckId === STANDARD_DECK_ID) {
    return standardDeckContent(catalog);
  }
  const deck = await database.decks.get(deckId);
  if (deck === undefined) return undefined;
  const records = await database.deckEntries.where('deckId').equals(deckId).toArray();
  return customDeckContent(parseDeck(deck), records.map(parseDeckEntry));
}
