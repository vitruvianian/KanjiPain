const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_OFFSET = 0x60;

const KATAKANA_WITH_MARKS = new Map<number, string>([
  [0x30f7, 'わ'],
  [0x30f8, 'ゐ'],
  [0x30f9, 'ゑ'],
  [0x30fa, 'を'],
]);

export interface SearchableKanji {
  readonly literal: string;
  readonly meanings: readonly string[];
  readonly onReadings: readonly string[];
  readonly kunReadings: readonly string[];
}

function normalizeKatakana(character: string): string {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    return character;
  }
  if (codePoint >= KATAKANA_START && codePoint <= KATAKANA_END) {
    return String.fromCodePoint(codePoint - KANA_OFFSET);
  }
  return KATAKANA_WITH_MARKS.get(codePoint) ?? character;
}

/**
 * Normalizes kana for comparison only. Stored source readings are never
 * rewritten.
 */
export function normalizeKana(value: string): string {
  return Array.from(value.normalize('NFKC'), normalizeKatakana).join('');
}

function matchesQuery(entry: SearchableKanji, query: string, lowerQuery: string): boolean {
  if (entry.literal.includes(query)) {
    return true;
  }
  if (entry.meanings.some((meaning) => meaning.toLocaleLowerCase().includes(lowerQuery))) {
    return true;
  }

  const normalizedQuery = normalizeKana(query);
  return [...entry.onReadings, ...entry.kunReadings].some((reading) =>
    normalizeKana(reading).includes(normalizedQuery),
  );
}

/**
 * Searches the whole catalog before any pagination happens. A query is matched
 * as a literal kanji substring, an English meaning substring, or a kana reading
 * substring with katakana/hiragana equivalence.
 */
export function searchEntries<T extends SearchableKanji>(
  entries: readonly T[],
  query: string,
): readonly T[] {
  const trimmed = query.trim();
  if (trimmed === '') {
    return entries;
  }

  const lowerQuery = trimmed.toLocaleLowerCase();
  return entries.filter((entry) => matchesQuery(entry, trimmed, lowerQuery));
}
