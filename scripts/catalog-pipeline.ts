import { createHash } from 'node:crypto';

import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

import { kanjiEntrySchema, teachingNotesSchema } from '../src/domain/schemas';
import { kanjiIdFromLiteral } from '../src/domain/ids';
import type { KanjiEntry } from '../src/domain/types';

export const KANJIDIC_DOWNLOAD_URL = 'https://www.edrdg.org/kanjidic/kanjidic2.xml.gz';
export const KANJIDIC_DOCUMENTATION_URL = 'https://www.edrdg.org/wiki/KANJIDIC_Project.html';
export const KANJIDIC_LICENSE_URL = 'https://www.edrdg.org/edrdg/licence.html';
export const EXPECTED_JOYO_COUNT = 2_136;

const includedGrades = new Set<number>([1, 2, 3, 4, 5, 6, 8]);
const arrayPaths = new Set([
  'kanjidic2.character',
  'kanjidic2.character.misc.stroke_count',
  'kanjidic2.character.reading_meaning.rmgroup',
  'kanjidic2.character.reading_meaning.rmgroup.reading',
  'kanjidic2.character.reading_meaning.rmgroup.meaning',
]);

const sourceTextWithAttributesSchema = z.looseObject({
  '#text': z.string(),
  '@_r_type': z.string().optional(),
  '@_m_lang': z.string().optional(),
});

const sourceTextSchema = z.union([z.string(), sourceTextWithAttributesSchema]);

function oneOrMany<T extends z.ZodType>(schema: T) {
  return z.union([schema, z.array(schema)]);
}

const sourceReadingMeaningGroupSchema = z.looseObject({
  reading: oneOrMany(sourceTextSchema).optional(),
  meaning: oneOrMany(sourceTextSchema).optional(),
});

const sourceCharacterSchema = z.looseObject({
  literal: z.string(),
  misc: z.looseObject({
    grade: oneOrMany(z.string()).optional(),
    stroke_count: oneOrMany(z.string()),
    freq: oneOrMany(z.string()).optional(),
  }),
  reading_meaning: z
    .looseObject({
      rmgroup: oneOrMany(sourceReadingMeaningGroupSchema).optional(),
    })
    .optional(),
});

const sourceDocumentSchema = z.looseObject({
  kanjidic2: z.looseObject({
    character: oneOrMany(sourceCharacterSchema),
  }),
});

type SourceText = z.infer<typeof sourceTextSchema>;
type SourceCharacter = z.infer<typeof sourceCharacterSchema>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function parsePositiveInteger(value: string | undefined, field: string): number | null {
  if (value === undefined) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`KANJIDIC2 ${field} must be a positive integer; received ${value}.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`KANJIDIC2 ${field} is outside the supported integer range: ${value}.`);
  }

  return parsed;
}

function isIncludedGrade(grade: number): grade is KanjiEntry['grade'] {
  return includedGrades.has(grade);
}

function textOf(value: SourceText): string {
  return typeof value === 'string' ? value : value['#text'];
}

function attributeOf(value: SourceText, attribute: '@_r_type' | '@_m_lang'): string | undefined {
  return typeof value === 'string' ? undefined : value[attribute];
}

function uniqueInSourceOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function extractMeanings(character: SourceCharacter): string[] {
  const meanings: string[] = [];

  for (const group of asArray(character.reading_meaning?.rmgroup)) {
    for (const meaning of asArray(group.meaning)) {
      const language = attributeOf(meaning, '@_m_lang');
      if (language === undefined || language === 'en') {
        meanings.push(textOf(meaning));
      }
    }
  }

  return uniqueInSourceOrder(meanings);
}

function extractReadings(character: SourceCharacter, readingType: 'ja_on' | 'ja_kun'): string[] {
  const readings: string[] = [];

  for (const group of asArray(character.reading_meaning?.rmgroup)) {
    for (const reading of asArray(group.reading)) {
      if (attributeOf(reading, '@_r_type') === readingType) {
        readings.push(textOf(reading));
      }
    }
  }

  return uniqueInSourceOrder(readings);
}

function codePointFor(literal: string): number {
  if (Array.from(literal).length !== 1) {
    throw new Error(`KANJIDIC2 literal must be one Unicode code point: ${literal}`);
  }

  const codePoint = literal.codePointAt(0);
  if (codePoint === undefined) {
    throw new Error('KANJIDIC2 contained an empty literal.');
  }

  return codePoint;
}

function compareCatalogEntries(
  left: Omit<KanjiEntry, 'curriculumOrder'>,
  right: Omit<KanjiEntry, 'curriculumOrder'>,
): number {
  if (left.grade !== right.grade) {
    return left.grade - right.grade;
  }

  const leftFrequency = left.frequencyRank ?? Number.POSITIVE_INFINITY;
  const rightFrequency = right.frequencyRank ?? Number.POSITIVE_INFINITY;
  if (leftFrequency !== rightFrequency) {
    return leftFrequency - rightFrequency;
  }

  return codePointFor(left.literal) - codePointFor(right.literal);
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function datasetVersion(catalogSha256: string, teachingNotesSha256: string): string {
  return sha256(`${catalogSha256}\n${teachingNotesSha256}`);
}

export function normalizeKanjidicXml(xml: string): KanjiEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    processEntities: false,
    trimValues: true,
    isArray: (_tagName, path) => typeof path === 'string' && arrayPaths.has(path),
  });
  const parsed: unknown = parser.parse(xml);
  const document = sourceDocumentSchema.parse(parsed);
  const selected: Omit<KanjiEntry, 'curriculumOrder'>[] = [];
  const seenIds = new Set<string>();
  const seenLiterals = new Set<string>();

  for (const character of asArray(document.kanjidic2.character)) {
    const grade = parsePositiveInteger(asArray(character.misc.grade)[0], 'grade');
    if (grade === null || !isIncludedGrade(grade)) {
      continue;
    }

    const literal = character.literal;
    codePointFor(literal);
    const id = kanjiIdFromLiteral(literal);
    if (seenIds.has(id) || seenLiterals.has(literal)) {
      throw new Error(`KANJIDIC2 contains a duplicate selected literal: ${literal}.`);
    }
    seenIds.add(id);
    seenLiterals.add(literal);

    const strokeCount = parsePositiveInteger(
      asArray(character.misc.stroke_count)[0],
      `stroke count for ${literal}`,
    );
    if (strokeCount === null) {
      throw new Error(`KANJIDIC2 is missing a stroke count for ${literal}.`);
    }

    const frequencyRank = parsePositiveInteger(
      asArray(character.misc.freq)[0],
      `frequency for ${literal}`,
    );
    const entry = {
      id,
      literal,
      grade,
      meanings: extractMeanings(character),
      onReadings: extractReadings(character, 'ja_on'),
      kunReadings: extractReadings(character, 'ja_kun'),
      strokeCount,
      frequencyRank,
    };
    selected.push(entry);
  }

  selected.sort(compareCatalogEntries);
  return selected.map((entry, curriculumOrder) =>
    kanjiEntrySchema.parse({ ...entry, curriculumOrder }),
  );
}

export function validateProductionCatalog(
  catalogInput: unknown,
  teachingNotesInput: unknown,
): KanjiEntry[] {
  const catalog = z.array(kanjiEntrySchema).length(EXPECTED_JOYO_COUNT).parse(catalogInput);
  const teachingNotes = teachingNotesSchema.parse(teachingNotesInput);
  const byId = new Map<string, KanjiEntry>();
  const seenLiterals = new Set<string>();

  for (const [index, entry] of catalog.entries()) {
    if (entry.curriculumOrder !== index) {
      throw new Error(`Catalog curriculum order is not contiguous at index ${String(index)}.`);
    }
    if (entry.id !== kanjiIdFromLiteral(entry.literal)) {
      throw new Error(`Catalog ID does not match its literal: ${entry.id}.`);
    }
    if (byId.has(entry.id) || seenLiterals.has(entry.literal)) {
      throw new Error(`Catalog contains a duplicate ID or literal: ${entry.id}.`);
    }
    if (index > 0) {
      const previous = catalog[index - 1];
      if (previous !== undefined && compareCatalogEntries(previous, entry) > 0) {
        throw new Error(`Catalog is out of curriculum order at ${entry.id}.`);
      }
    }

    byId.set(entry.id, entry);
    seenLiterals.add(entry.literal);
  }

  validateTeachingNoteReferences(teachingNotes, byId);
  validateDistinctMeaningCues(catalog, teachingNotes);
  return catalog;
}

/**
 * Two characters must never share a meaning cue: the prompt would point at both, and only
 * the reading would tell them apart. A teaching-note prompt override separates such pairs.
 */
export function validateDistinctMeaningCues(
  catalog: readonly KanjiEntry[],
  teachingNotes: z.output<typeof teachingNotesSchema>,
): void {
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const entry of catalog) {
    const cue = (
      teachingNotes[entry.id]?.promptOverride?.meaningCue ?? entry.meanings.slice(0, 3).join(', ')
    ).toLowerCase();
    const earlier = seen.get(cue);
    if (earlier === undefined) seen.set(cue, entry.literal);
    else collisions.push(`${earlier}/${entry.literal} ("${cue}")`);
  }
  if (collisions.length > 0) {
    throw new Error(
      `Characters share a meaning cue; add a teaching-note prompt override: ${collisions.join(', ')}.`,
    );
  }
}

function validateTeachingNoteReferences(
  teachingNotes: z.output<typeof teachingNotesSchema>,
  catalogById: ReadonlyMap<string, KanjiEntry>,
): void {
  for (const [kanjiId, note] of Object.entries(teachingNotes)) {
    const entry = catalogById.get(kanjiId);
    if (entry === undefined) {
      throw new Error(`Teaching note references an unknown kanji ID: ${kanjiId}.`);
    }

    const promptOverride = note.promptOverride;
    if (
      promptOverride !== undefined &&
      (promptOverride.meaningCue.includes(entry.literal) ||
        promptOverride.readingCues.some((cue) => cue.includes(entry.literal)))
    ) {
      throw new Error(`Teaching-note prompt leaks the target glyph for ${kanjiId}.`);
    }
  }
}
