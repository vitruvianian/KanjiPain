import type { Clock } from '../domain/clock';
import {
  cleanDraft,
  deckToCsv,
  deckToJson,
  draftProblem,
  MAX_DECK_ENTRIES,
  MAX_DECKS,
  mergeDrafts,
  type DeckEntryDraft,
  type ParsedDeckImport,
  type RejectedRow,
} from '../domain/deck-import';
import { deckEntryId, kanjiIdFromLiteral, type IdSource } from '../domain/ids';
import { DECK_NAME_MAX, settingsRecordSchema } from '../domain/schemas';
import {
  STANDARD_DECK_ID,
  type DeckEntryRecord,
  type DeckOrder,
  type DeckRecord,
  type KanjiId,
  type SettingsRecord,
} from '../domain/types';
import type { StrokeLookup } from '../recognition/load';
import type { KanjiPainDatabase } from '../storage/database';
import { InvalidPersistedDataError, mapStorageError } from '../storage/errors';
import type { CatalogRepository } from './catalog';
import {
  loadDeckContent,
  orderDeckEntries,
  parseDeck,
  parseDeckEntry,
  STANDARD_DECK_NAME,
  standardDeckContent,
  type DeckContent,
} from './deck-content';

export class DeckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown for any attempt to change the Standard deck, whatever the interface allowed. */
export class StandardDeckProtectedError extends DeckError {
  constructor() {
    super('The Standard deck cannot be changed. Copy it to a new deck and edit the copy.');
  }
}

export class DeckNotFoundError extends DeckError {
  constructor() {
    super('That deck no longer exists.');
  }
}

export class DeckInUseError extends DeckError {
  constructor() {
    super('Finish the practice session using this deck before changing or deleting the deck.');
  }
}

export class DeckLimitError extends DeckError {}

export class DeckValidationError extends DeckError {}

export interface DeckImportPreviewRow {
  readonly kanjiId: KanjiId;
  readonly draft: DeckEntryDraft;
  /** `merge`: the character is already in the deck, so its entry is updated instead. */
  readonly status: 'new' | 'merge';
  /** Null when the character is not recognized: there is no stroke data for it. */
  readonly strokeCount: number | null;
}

export interface DeckImportPreview {
  readonly deckId: string;
  readonly rows: readonly DeckImportPreviewRow[];
  readonly rejected: readonly RejectedRow[];
}

export interface DeckImportResult {
  readonly added: number;
  readonly merged: number;
}

export interface DeckListItem {
  readonly id: string;
  readonly name: string;
  readonly kind: 'standard' | 'custom';
  readonly entryCount: number;
  /** Characters with no stroke-order guide and no automatic check. */
  readonly unrecognizedCount: number;
  /** Characters sessions skip until they have a meaning or a reading. */
  readonly withoutCueCount: number;
}

export interface DeckEntryPatch {
  readonly meanings: readonly string[];
  readonly readingCues: readonly string[];
  readonly note?: string | undefined;
  readonly mnemonic?: string | undefined;
}

export interface DeckExport {
  readonly fileName: string;
  readonly mimeType: string;
  readonly text: string;
}

export interface DeckServiceDependencies {
  readonly database: KanjiPainDatabase;
  readonly catalog: CatalogRepository;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly strokeLookup: StrokeLookup;
}

function cleanName(name: string): string {
  const trimmed = name.normalize('NFC').trim();
  if (trimmed === '') {
    throw new DeckValidationError('Give the deck a name.');
  }
  if (trimmed.length > DECK_NAME_MAX) {
    throw new DeckValidationError(`Deck names can be up to ${String(DECK_NAME_MAX)} characters.`);
  }
  return trimmed;
}

function draftOf(entry: DeckEntryRecord): DeckEntryDraft {
  return {
    literal: entry.literal,
    meanings: entry.meanings,
    readingCues: entry.readingCues,
    note: entry.note,
    mnemonic: entry.mnemonic,
  };
}

function recordFrom(
  deckId: string,
  draft: DeckEntryDraft,
  position: number,
  strokeCount: number | null,
): DeckEntryRecord {
  const kanjiId = kanjiIdFromLiteral(draft.literal);
  return parseDeckEntry({
    id: deckEntryId(deckId, kanjiId),
    deckId,
    kanjiId,
    literal: draft.literal,
    meanings: [...draft.meanings],
    readingCues: [...draft.readingCues],
    ...(draft.note === undefined ? {} : { note: draft.note }),
    ...(draft.mnemonic === undefined ? {} : { mnemonic: draft.mnemonic }),
    position,
    strokeStatus: strokeCount === null ? 'unrecognized' : 'available',
    strokeCount,
  });
}

function fileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug === '' ? 'deck' : slug;
}

/**
 * Creates, changes and deletes custom decks. The Standard deck is not stored, and every
 * operation that would change it is rejected here rather than only hidden in the interface.
 * Deleting a deck never deletes cards or history: those belong to the character.
 */
export class DeckService {
  readonly #database: KanjiPainDatabase;
  readonly #catalog: CatalogRepository;
  readonly #clock: Clock;
  readonly #ids: IdSource;
  readonly #strokeLookup: StrokeLookup;

  constructor({ database, catalog, clock, ids, strokeLookup }: DeckServiceDependencies) {
    this.#database = database;
    this.#catalog = catalog;
    this.#clock = clock;
    this.#ids = ids;
    this.#strokeLookup = strokeLookup;
  }

  /** The Standard deck first, then custom decks by name. */
  async listDecks(): Promise<DeckListItem[]> {
    return this.#guard('reading decks', async () => {
      const decks = (await this.#database.decks.toArray()).map(parseDeck);
      const entries = (await this.#database.deckEntries.toArray()).map(parseDeckEntry);
      const custom = decks
        .sort(
          (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
        )
        .map((deck): DeckListItem => {
          const own = entries.filter((entry) => entry.deckId === deck.id);
          return {
            id: deck.id,
            name: deck.name,
            kind: 'custom',
            entryCount: own.length,
            unrecognizedCount: own.filter((entry) => entry.strokeStatus === 'unrecognized').length,
            withoutCueCount: own.filter(
              (entry) => entry.meanings.length + entry.readingCues.length === 0,
            ).length,
          };
        });
      return [
        {
          id: STANDARD_DECK_ID,
          name: STANDARD_DECK_NAME,
          kind: 'standard',
          entryCount: this.#catalog.all.length,
          unrecognizedCount: 0,
          withoutCueCount: 0,
        },
        ...custom,
      ];
    });
  }

  async getDeck(deckId: string): Promise<DeckRecord | undefined> {
    return this.#guard('reading a deck', async () => {
      const deck = await this.#database.decks.get(deckId);
      return deck === undefined ? undefined : parseDeck(deck);
    });
  }

  /** A custom deck's entries in the order new characters are introduced. */
  async getEntries(deckId: string): Promise<DeckEntryRecord[]> {
    return this.#guard('reading deck entries', async () => {
      const deck = await this.#database.decks.get(deckId);
      if (deck === undefined) return [];
      const entries = await this.#database.deckEntries.where('deckId').equals(deckId).toArray();
      return orderDeckEntries(entries.map(parseDeckEntry), parseDeck(deck).order);
    });
  }

  /** Every custom-deck entry for one character, for showing which decks contain it. */
  async getEntriesForKanji(kanjiId: KanjiId): Promise<DeckEntryRecord[]> {
    return this.#guard('reading deck entries', async () => {
      const entries = await this.#database.deckEntries.where('kanjiId').equals(kanjiId).toArray();
      return entries.map(parseDeckEntry);
    });
  }

  /** IDs of every character that is in at least one custom deck. */
  async getCustomKanjiIds(): Promise<Set<KanjiId>> {
    return this.#guard('reading deck entries', async () => {
      const keys = await this.#database.deckEntries.orderBy('kanjiId').uniqueKeys();
      return new Set(keys.map(String));
    });
  }

  async getContent(deckId: string): Promise<DeckContent | undefined> {
    return this.#guard('reading a deck', () =>
      loadDeckContent(this.#database, this.#catalog, deckId),
    );
  }

  /** The deck practice currently uses. Falls back to the Standard deck if it has gone. */
  async getActiveContent(): Promise<DeckContent> {
    return this.#guard('reading the active deck', async () => {
      const settings = await this.#database.settings.get('user');
      return (
        (await loadDeckContent(this.#database, this.#catalog, settings?.activeDeckId)) ??
        standardDeckContent(this.#catalog)
      );
    });
  }

  async setActiveDeck(deckId: string): Promise<SettingsRecord> {
    return this.#guard('choosing the active deck', () =>
      this.#database.transaction('rw', this.#database.settings, this.#database.decks, async () => {
        if (deckId !== STANDARD_DECK_ID && (await this.#database.decks.get(deckId)) === undefined) {
          throw new DeckNotFoundError();
        }
        const row = await this.#database.settings.get('user');
        const result = settingsRecordSchema.safeParse({ ...row, activeDeckId: deckId });
        if (row === undefined || !result.success) {
          throw new InvalidPersistedDataError('settings', result.error);
        }
        await this.#database.settings.put(result.data);
        return result.data;
      }),
    );
  }

  async createDeck(name: string, order: DeckOrder = 'imported'): Promise<DeckRecord> {
    const cleaned = cleanName(name);
    const now = this.#clock.now();
    return this.#guard('creating a deck', () =>
      this.#database.transaction('rw', this.#database.decks, async () => {
        if ((await this.#database.decks.count()) >= MAX_DECKS) {
          throw new DeckLimitError(
            `You can keep up to ${String(MAX_DECKS)} custom decks. Delete one to add another.`,
          );
        }
        const deck = parseDeck({
          id: this.#ids.next(),
          name: cleaned,
          kind: 'custom',
          createdAt: now,
          updatedAt: now,
          revision: 0,
          order,
        });
        await this.#database.decks.add(deck);
        return deck;
      }),
    );
  }

  async updateDeck(
    deckId: string,
    patch: { readonly name?: string; readonly order?: DeckOrder },
  ): Promise<DeckRecord> {
    const name = patch.name === undefined ? undefined : cleanName(patch.name);
    return this.#mutate(deckId, 'updating a deck', (deck) =>
      Promise.resolve({
        ...deck,
        ...(name === undefined ? {} : { name }),
        ...(patch.order === undefined ? {} : { order: patch.order }),
      }),
    );
  }

  /** Removes the deck and its entries. Cards and their history remain. */
  async deleteDeck(deckId: string): Promise<void> {
    await this.#guard('deleting a deck', () =>
      this.#database.transaction(
        'rw',
        this.#database.decks,
        this.#database.deckEntries,
        this.#database.sessions,
        this.#database.settings,
        async () => {
          await this.#assertEditable(deckId);
          await this.#database.deckEntries.where('deckId').equals(deckId).delete();
          await this.#database.decks.delete(deckId);
          const settings = await this.#database.settings.get('user');
          if (settings?.activeDeckId === deckId) {
            await this.#database.settings.put({ ...settings, activeDeckId: STANDARD_DECK_ID });
          }
        },
      ),
    );
  }

  /**
   * Works out what an import would do, without writing anything: which characters are new,
   * which are already in the deck, and which have no stroke data.
   */
  async previewImport(deckId: string, parsed: ParsedDeckImport): Promise<DeckImportPreview> {
    if (deckId === STANDARD_DECK_ID) {
      throw new StandardDeckProtectedError();
    }
    const existing = new Map(
      (await this.getEntries(deckId)).map((entry) => [entry.kanjiId, entry]),
    );
    const kanjiIds = parsed.drafts.map((draft) => kanjiIdFromLiteral(draft.literal));
    const strokeCounts = await this.#strokeLookup(kanjiIds);
    const rejected = [...parsed.rejected];
    const rows: DeckImportPreviewRow[] = [];
    parsed.drafts.forEach((draft, index) => {
      const kanjiId = kanjiIds[index] ?? '';
      const current = existing.get(kanjiId);
      const merged = current === undefined ? draft : mergeDrafts(draftOf(current), draft);
      const reason = draftProblem(merged);
      if (reason !== null) {
        rejected.push({ line: index + 1, text: draft.literal, reason });
        return;
      }
      rows.push({
        kanjiId,
        draft: merged,
        status: current === undefined ? 'new' : 'merge',
        strokeCount: strokeCounts.get(kanjiId) ?? null,
      });
    });
    return { deckId, rows, rejected };
  }

  /** Writes a previewed import in one transaction. */
  async commitImport(preview: DeckImportPreview): Promise<DeckImportResult> {
    let result: DeckImportResult = { added: 0, merged: 0 };
    await this.#mutate(preview.deckId, 'importing into a deck', async (deck) => {
      const existing = new Map(
        (await this.#database.deckEntries.where('deckId').equals(deck.id).toArray()).map(
          (entry) => [entry.kanjiId, parseDeckEntry(entry)],
        ),
      );
      let nextPosition = Math.max(-1, ...[...existing.values()].map((entry) => entry.position)) + 1;
      const records: DeckEntryRecord[] = [];
      let added = 0;
      for (const row of preview.rows) {
        const current = existing.get(row.kanjiId);
        if (current === undefined) {
          records.push(recordFrom(deck.id, row.draft, nextPosition, row.strokeCount));
          nextPosition += 1;
          added += 1;
        } else {
          records.push(
            recordFrom(
              deck.id,
              mergeDrafts(draftOf(current), row.draft),
              current.position,
              row.strokeCount,
            ),
          );
        }
      }
      if (existing.size + added > MAX_DECK_ENTRIES) {
        throw new DeckLimitError(
          `A deck can hold up to ${MAX_DECK_ENTRIES.toLocaleString('en')} characters. This import would make it ${(existing.size + added).toLocaleString('en')}.`,
        );
      }
      await this.#database.deckEntries.bulkPut(records);
      result = { added, merged: records.length - added };
      return deck;
    });
    return result;
  }

  /** Adds Standard-deck characters with their dictionary meanings and readings filled in. */
  async addFromStandard(deckId: string, kanjiIds: readonly KanjiId[]): Promise<DeckImportResult> {
    const existing = new Set((await this.getEntries(deckId)).map((entry) => entry.kanjiId));
    const drafts = kanjiIds.flatMap((kanjiId) => {
      const draft = this.#standardDraft(kanjiId);
      // A character already in the deck keeps the learner's own text.
      return draft === undefined || existing.has(kanjiId) ? [] : [draft];
    });
    return this.commitImport(await this.previewImport(deckId, { drafts, rejected: [] }));
  }

  /** A new custom deck with the Standard deck's characters, free to edit. */
  async copyStandardDeck(name: string): Promise<DeckRecord> {
    const deck = await this.createDeck(name);
    try {
      await this.addFromStandard(deck.id, this.#catalog.orderedIds);
    } catch (error) {
      // Do not leave an empty deck behind when the copy could not be filled.
      await this.deleteDeck(deck.id).catch(() => undefined);
      throw error;
    }
    return (await this.getDeck(deck.id)) ?? deck;
  }

  async updateEntry(deckId: string, kanjiId: KanjiId, patch: DeckEntryPatch): Promise<void> {
    await this.#mutate(deckId, 'updating a deck entry', async (deck) => {
      const current = await this.#database.deckEntries.get(deckEntryId(deckId, kanjiId));
      if (current === undefined) {
        throw new DeckValidationError('That character is no longer in the deck.');
      }
      const entry = parseDeckEntry(current);
      const draft = cleanDraft({ literal: entry.literal, ...patch });
      const reason = draftProblem(draft);
      if (reason !== null) {
        throw new DeckValidationError(reason);
      }
      await this.#database.deckEntries.put(
        recordFrom(deckId, draft, entry.position, entry.strokeCount),
      );
      return deck;
    });
  }

  /** Takes a character out of the deck. Its card and history remain. */
  async removeEntry(deckId: string, kanjiId: KanjiId): Promise<void> {
    await this.#mutate(deckId, 'removing a deck entry', async (deck) => {
      await this.#database.deckEntries.delete(deckEntryId(deckId, kanjiId));
      return deck;
    });
  }

  /**
   * Looks stroke data up again, so a character that newer stroke data covers stops being
   * "unrecognized". Returns how many entries changed. With no deck ID, checks every deck.
   */
  async recheckStrokes(deckId?: string): Promise<number> {
    if (deckId === STANDARD_DECK_ID) {
      throw new StandardDeckProtectedError();
    }
    const read = async () =>
      (deckId === undefined
        ? await this.#database.deckEntries.toArray()
        : await this.#database.deckEntries.where('deckId').equals(deckId).toArray()
      ).map(parseDeckEntry);
    const candidates = await this.#guard('reading deck entries', read);
    const strokeCounts = await this.#strokeLookup([
      ...new Set(candidates.map((entry) => entry.kanjiId)),
    ]);
    const now = this.#clock.now();
    return this.#guard('checking stroke data', () =>
      this.#database.transaction(
        'rw',
        this.#database.decks,
        this.#database.deckEntries,
        async () => {
          const changed = (await read()).flatMap((entry) => {
            const strokeCount = strokeCounts.get(entry.kanjiId) ?? null;
            return strokeCount === entry.strokeCount
              ? []
              : [recordFrom(entry.deckId, draftOf(entry), entry.position, strokeCount)];
          });
          await this.#database.deckEntries.bulkPut(changed);
          for (const id of new Set(changed.map((entry) => entry.deckId))) {
            const deck = await this.#database.decks.get(id);
            if (deck !== undefined) {
              await this.#database.decks.put({
                ...deck,
                revision: deck.revision + 1,
                updatedAt: Math.max(now, deck.updatedAt),
              });
            }
          }
          return changed.length;
        },
      ),
    );
  }

  /** A deck's entries without any progress, for sharing. */
  async exportDeck(deckId: string, format: 'json' | 'csv'): Promise<DeckExport> {
    const deck = await this.getDeck(deckId);
    if (deck === undefined) {
      throw new DeckNotFoundError();
    }
    const entries = await this.getEntries(deckId);
    return format === 'json'
      ? {
          fileName: `kanjipain-deck-${fileSlug(deck.name)}.json`,
          mimeType: 'application/json',
          text: deckToJson(deck, entries),
        }
      : {
          fileName: `kanjipain-deck-${fileSlug(deck.name)}.csv`,
          mimeType: 'text/csv',
          text: deckToCsv(entries),
        };
  }

  #standardDraft(kanjiId: KanjiId): DeckEntryDraft | undefined {
    const entry = this.#catalog.byId(kanjiId);
    if (entry === undefined) return undefined;
    const note = this.#catalog.teachingNotes[kanjiId];
    return cleanDraft({
      literal: entry.literal,
      meanings: entry.meanings.slice(0, 20),
      readingCues: [...entry.kunReadings, ...entry.onReadings].slice(0, 20),
      mnemonic: note?.mnemonicHint,
    });
  }

  /** Must run inside a transaction that includes `decks` and `sessions`. */
  async #assertEditable(deckId: string): Promise<DeckRecord> {
    if (deckId === STANDARD_DECK_ID) {
      throw new StandardDeckProtectedError();
    }
    const row = await this.#database.decks.get(deckId);
    if (row === undefined) {
      throw new DeckNotFoundError();
    }
    const active = await this.#database.sessions.where('status').equals('active').toArray();
    if (active.some((session) => session.deckId === deckId)) {
      throw new DeckInUseError();
    }
    return parseDeck(row);
  }

  /** Runs one change to a custom deck in a transaction and advances the deck's revision. */
  async #mutate(
    deckId: string,
    operation: string,
    change: (deck: DeckRecord) => Promise<DeckRecord>,
  ): Promise<DeckRecord> {
    const now = this.#clock.now();
    return this.#guard(operation, () =>
      this.#database.transaction(
        'rw',
        this.#database.decks,
        this.#database.deckEntries,
        this.#database.sessions,
        async () => {
          const deck = await this.#assertEditable(deckId);
          const changed = await change(deck);
          const next = parseDeck({
            ...changed,
            revision: deck.revision + 1,
            updatedAt: Math.max(now, deck.updatedAt),
          });
          await this.#database.decks.put(next);
          return next;
        },
      ),
    );
  }

  async #guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof DeckError) {
        throw error;
      }
      throw mapStorageError(error, operation);
    }
  }
}

export function createDeckService(dependencies: DeckServiceDependencies): DeckService {
  return new DeckService(dependencies);
}
