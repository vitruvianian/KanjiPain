import type { DeckEntryRecord, DeckOrder } from './types';

export const MAX_DECK_ENTRIES = 5_000;
export const MAX_DECKS = 50;
export const MAX_DECK_IMPORT_BYTES = 5 * 1024 * 1024;
export const DECK_EXPORT_FORMAT = 'kanjipain-deck';
export const DECK_EXPORT_VERSION = 1;

const MAX_CUES = 20;
const MAX_CUE_LENGTH = 200;
const MAX_NOTE_LENGTH = 2_000;
const VARIATION_SELECTORS = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;
const PASTE_SEPARATORS = /[\s,、;；・|/]/u;
const LIST_SEPARATOR = /[;；]/u;

export class DeckImportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeckImportError';
  }
}

/** One character and the learner's text for it, before it is stored in a deck. */
export interface DeckEntryDraft {
  readonly literal: string;
  readonly meanings: readonly string[];
  readonly readingCues: readonly string[];
  readonly note?: string | undefined;
  readonly mnemonic?: string | undefined;
}

export interface RejectedRow {
  /** 1-based position in the pasted text or file, counting the header row. */
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface ParsedDeckImport {
  /** Usable entries, one per character, in the order they first appeared. */
  readonly drafts: readonly DeckEntryDraft[];
  readonly rejected: readonly RejectedRow[];
  /** From a deck JSON file: the name and order the deck was exported with. */
  readonly name?: string | undefined;
  readonly order?: DeckOrder | undefined;
}

/** NFC, without variation selectors, so one character is always looked up the same way. */
export function normalizeCharacterText(text: string): string {
  return text.normalize('NFC').replace(VARIATION_SELECTORS, '').trim();
}

function cleanList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.normalize('NFC').trim()))].filter(
    (value) => value !== '',
  );
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.normalize('NFC').trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function withOptional(
  draft: Omit<DeckEntryDraft, 'note' | 'mnemonic'>,
  note: string | undefined,
  mnemonic: string | undefined,
): DeckEntryDraft {
  return {
    ...draft,
    ...(note === undefined ? {} : { note }),
    ...(mnemonic === undefined ? {} : { mnemonic }),
  };
}

/** Tidies a draft's text. The result still has to pass `draftProblem`. */
export function cleanDraft(draft: DeckEntryDraft): DeckEntryDraft {
  return withOptional(
    {
      literal: normalizeCharacterText(draft.literal),
      meanings: cleanList(draft.meanings),
      readingCues: cleanList(draft.readingCues),
    },
    cleanText(draft.note),
    cleanText(draft.mnemonic),
  );
}

/** Why a cleaned draft cannot be stored, or `null` when it can. */
export function draftProblem(draft: DeckEntryDraft): string | null {
  const characters = Array.from(draft.literal);
  if (characters.length === 0) {
    return 'No character.';
  }
  if (characters.length > 1) {
    return 'More than one character. Each entry holds exactly one, so words cannot be imported.';
  }
  const cues = [...draft.meanings, ...draft.readingCues];
  if ([...cues, draft.mnemonic ?? ''].some((cue) => cue.includes(draft.literal))) {
    return 'A meaning, reading or mnemonic contains the character itself, which would give the answer away.';
  }
  if (draft.meanings.length > MAX_CUES || draft.readingCues.length > MAX_CUES) {
    return `More than ${String(MAX_CUES)} meanings or readings.`;
  }
  if (cues.some((cue) => cue.length > MAX_CUE_LENGTH)) {
    return `A meaning or reading is longer than ${String(MAX_CUE_LENGTH)} characters.`;
  }
  if (
    (draft.note?.length ?? 0) > MAX_NOTE_LENGTH ||
    (draft.mnemonic?.length ?? 0) > MAX_NOTE_LENGTH
  ) {
    return `A note or mnemonic is longer than ${String(MAX_NOTE_LENGTH)} characters.`;
  }
  return null;
}

/**
 * Combines two drafts for the same character: meanings and readings are united, and a note or
 * mnemonic in `added` replaces the earlier one.
 */
export function mergeDrafts(base: DeckEntryDraft, added: DeckEntryDraft): DeckEntryDraft {
  return withOptional(
    {
      literal: base.literal,
      meanings: cleanList([...base.meanings, ...added.meanings]),
      readingCues: cleanList([...base.readingCues, ...added.readingCues]),
    },
    added.note ?? base.note,
    added.mnemonic ?? base.mnemonic,
  );
}

interface RawRow {
  readonly line: number;
  readonly text: string;
  readonly draft: DeckEntryDraft;
}

function collect(rows: readonly RawRow[]): Pick<ParsedDeckImport, 'drafts' | 'rejected'> {
  const drafts = new Map<string, DeckEntryDraft>();
  const rejected: RejectedRow[] = [];
  for (const row of rows) {
    const draft = cleanDraft(row.draft);
    const existing = drafts.get(draft.literal);
    const candidate = existing === undefined ? draft : mergeDrafts(existing, draft);
    const reason = draftProblem(candidate);
    if (reason === null) {
      drafts.set(draft.literal, candidate);
    } else {
      rejected.push({ line: row.line, text: row.text, reason });
    }
  }
  return { drafts: [...drafts.values()], rejected };
}

function assertSize(text: string): void {
  if (new TextEncoder().encode(text).byteLength > MAX_DECK_IMPORT_BYTES) {
    throw new DeckImportError('This is larger than 5 MiB and cannot be imported into a deck.');
  }
}

/** Pasted characters, such as `猫犬鳥` or one per line. Each becomes an entry with no cues. */
export function parsePastedCharacters(text: string): ParsedDeckImport {
  assertSize(text);
  const rows: RawRow[] = [];
  text.split(/\r\n|\r|\n/).forEach((lineText, index) => {
    for (const character of Array.from(normalizeCharacterText(lineText))) {
      if (PASTE_SEPARATORS.test(character)) continue;
      rows.push({
        line: index + 1,
        text: character,
        draft: { literal: character, meanings: [], readingCues: [] },
      });
    }
  });
  return collect(rows);
}

/** Splits delimited text into rows of fields, honouring double-quoted fields. */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field === '') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const COLUMN_NAMES: Readonly<
  Record<string, 'kanji' | 'meanings' | 'readings' | 'note' | 'mnemonic'>
> = {
  kanji: 'kanji',
  character: 'kanji',
  meaning: 'meanings',
  meanings: 'meanings',
  reading: 'readings',
  readings: 'readings',
  note: 'note',
  notes: 'note',
  mnemonic: 'mnemonic',
};

/**
 * A CSV or TSV table with a header row naming a `kanji` column and, optionally, `meanings`,
 * `readings`, `note` and `mnemonic`. Several meanings or readings are separated with `;`.
 */
export function parseDeckTable(text: string): ParsedDeckImport {
  assertSize(text);
  const content = text.replace(/^\uFEFF/, '');
  const headerLine = content.split(/\r\n|\r|\n/, 1)[0] ?? '';
  const table = parseDelimited(content, headerLine.includes('\t') ? '\t' : ',');
  const header = (table[0] ?? []).map((name) => COLUMN_NAMES[name.trim().toLowerCase()]);
  const column = (name: (typeof header)[number]) => header.indexOf(name);
  if (column('kanji') === -1) {
    throw new DeckImportError(
      'The first row must name the columns, and one of them must be "kanji". Other columns: meanings, readings, note, mnemonic.',
    );
  }

  const rows: RawRow[] = [];
  table.slice(1).forEach((fields, index) => {
    const value = (name: (typeof header)[number]) => fields[column(name)] ?? '';
    const lineText = fields.join(' ').trim();
    if (lineText === '') return;
    rows.push({
      line: index + 2,
      text: lineText,
      draft: {
        literal: value('kanji'),
        meanings: value('meanings').split(LIST_SEPARATOR),
        readingCues: value('readings').split(LIST_SEPARATOR),
        note: value('note'),
        mnemonic: value('mnemonic'),
      },
    });
  });
  return collect(rows);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(LIST_SEPARATOR);
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/** A deck exported by KanjiPain as JSON, so decks can be shared. */
export function parseDeckJson(text: string): ParsedDeckImport {
  assertSize(text);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new DeckImportError('This file is not valid JSON.', { cause: error });
  }
  if (!isRecord(value) || value.format !== DECK_EXPORT_FORMAT || !Array.isArray(value.entries)) {
    throw new DeckImportError(
      value !== null && isRecord(value) && value.format === 'kanjipain-backup'
        ? 'This is a full KanjiPain backup, not a deck. Restore backups from Settings.'
        : 'This JSON file is not a KanjiPain deck.',
    );
  }
  if (value.version !== DECK_EXPORT_VERSION) {
    throw new DeckImportError(`Deck file version ${String(value.version)} is not supported.`);
  }

  const rows = value.entries.map((entry: unknown, index): RawRow => {
    const fields = isRecord(entry) ? entry : {};
    return {
      line: index + 1,
      text: typeof fields.kanji === 'string' ? fields.kanji : JSON.stringify(entry),
      draft: {
        literal: typeof fields.kanji === 'string' ? fields.kanji : '',
        meanings: stringList(fields.meanings),
        readingCues: stringList(fields.readings),
        note: typeof fields.note === 'string' ? fields.note : undefined,
        mnemonic: typeof fields.mnemonic === 'string' ? fields.mnemonic : undefined,
      },
    };
  });
  const order = value.order;
  return {
    ...collect(rows),
    ...(typeof value.name === 'string' && value.name.trim() !== ''
      ? { name: value.name.trim() }
      : {}),
    ...(order === 'imported' || order === 'stroke-count' || order === 'shuffled' ? { order } : {}),
  };
}

/** Reads a deck file as JSON or as a CSV/TSV table, judging by its name and content. */
export function parseDeckFile(fileName: string, text: string): ParsedDeckImport {
  const looksLikeJson = /\.json$/i.test(fileName) || /^\s*\{/.test(text);
  return looksLikeJson ? parseDeckJson(text) : parseDeckTable(text);
}

type ExportableEntry = Pick<
  DeckEntryRecord,
  'literal' | 'meanings' | 'readingCues' | 'note' | 'mnemonic'
>;

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Entries only, no progress: the table `parseDeckTable` reads back. */
export function deckToCsv(entries: readonly ExportableEntry[]): string {
  const lines = entries.map((entry) =>
    [
      entry.literal,
      entry.meanings.join('; '),
      entry.readingCues.join('; '),
      entry.note ?? '',
      entry.mnemonic ?? '',
    ]
      .map(csvField)
      .join(','),
  );
  return `${['kanji,meanings,readings,note,mnemonic', ...lines].join('\n')}\n`;
}

/** Entries only, no progress: the file `parseDeckJson` reads back. */
export function deckToJson(
  deck: { readonly name: string; readonly order: DeckOrder },
  entries: readonly ExportableEntry[],
): string {
  return `${JSON.stringify(
    {
      format: DECK_EXPORT_FORMAT,
      version: DECK_EXPORT_VERSION,
      name: deck.name,
      order: deck.order,
      entries: entries.map((entry) => ({
        kanji: entry.literal,
        meanings: entry.meanings,
        readings: entry.readingCues,
        ...(entry.note === undefined ? {} : { note: entry.note }),
        ...(entry.mnemonic === undefined ? {} : { mnemonic: entry.mnemonic }),
      })),
    },
    null,
    2,
  )}\n`;
}
