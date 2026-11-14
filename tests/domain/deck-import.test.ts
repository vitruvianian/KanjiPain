import { describe, expect, it } from 'vitest';

import {
  DeckImportError,
  deckToCsv,
  deckToJson,
  MAX_DECK_IMPORT_BYTES,
  normalizeCharacterText,
  parseDeckFile,
  parseDeckJson,
  parseDeckTable,
  parsePastedCharacters,
} from '../../src/domain/deck-import';

describe('deck import parsing', () => {
  it('normalizes to NFC and strips variation selectors', () => {
    // か + combining dakuten composes to が; a variation selector after 葛 is dropped.
    expect(normalizeCharacterText('が')).toBe('が');
    expect(normalizeCharacterText(' 葛󠄀 ')).toBe('葛');
    expect(normalizeCharacterText('猫️')).toBe('猫');
  });

  it('turns pasted characters into one entry each, merging repeats', () => {
    const parsed = parsePastedCharacters('猫犬、鳥\n猫 魚︀');
    expect(parsed.drafts.map((draft) => draft.literal)).toEqual(['猫', '犬', '鳥', '魚']);
    expect(parsed.drafts.every((draft) => draft.meanings.length === 0)).toBe(true);
    expect(parsed.rejected).toEqual([]);
  });

  it('reads CSV with quotes, several meanings, and reports unusable rows', () => {
    const parsed = parseDeckTable(
      [
        '﻿Kanji,Meanings,Readings,Note',
        '猫,cat; feline,ねこ;ビョウ,"likes fish, hates baths"',
        '犬,"dog ""best friend""",いぬ,',
        '',
        '日本,Japan,にほん,',
        ',nothing,,',
        '鳥,the 鳥 itself,とり,',
        '猫,kitty,,',
      ].join('\r\n'),
    );

    expect(parsed.drafts).toEqual([
      {
        literal: '猫',
        meanings: ['cat', 'feline', 'kitty'],
        readingCues: ['ねこ', 'ビョウ'],
        note: 'likes fish, hates baths',
      },
      { literal: '犬', meanings: ['dog "best friend"'], readingCues: ['いぬ'] },
    ]);
    expect(parsed.rejected.map((row) => [row.line, row.reason])).toEqual([
      [5, expect.stringMatching(/More than one character/)],
      [6, 'No character.'],
      [7, expect.stringMatching(/contains the character itself/)],
    ]);
  });

  it('reads TSV and requires a kanji column', () => {
    const parsed = parseDeckTable('kanji\tmeaning\treading\n猫\tcat\tねこ\n');
    expect(parsed.drafts).toEqual([{ literal: '猫', meanings: ['cat'], readingCues: ['ねこ'] }]);
    expect(() => parseDeckTable('word,meaning\n猫,cat\n')).toThrow(DeckImportError);
  });

  it('round-trips a deck through JSON and CSV export', () => {
    const entries = [
      { literal: '猫', meanings: ['cat', 'feline'], readingCues: ['ねこ'], note: 'a, "note"' },
      { literal: '☃', meanings: ['snowman'], readingCues: [], mnemonic: 'three balls' },
    ];
    const json = parseDeckFile(
      'deck.json',
      deckToJson({ name: 'Pets', order: 'shuffled' }, entries),
    );
    expect(json.name).toBe('Pets');
    expect(json.order).toBe('shuffled');
    expect(json.drafts).toEqual(entries);
    expect(json.rejected).toEqual([]);

    expect(parseDeckFile('deck.csv', deckToCsv(entries)).drafts).toEqual(entries);
  });

  it('rejects files that are not decks or are too large', () => {
    expect(() => parseDeckJson('{')).toThrow(/not valid JSON/);
    expect(() => parseDeckJson('{"format":"kanjipain-backup","version":1}')).toThrow(
      /full KanjiPain backup/,
    );
    expect(() => parseDeckJson('{"format":"kanjipain-deck","version":9,"entries":[]}')).toThrow(
      /version 9/,
    );
    expect(() => parsePastedCharacters('猫'.repeat(MAX_DECK_IMPORT_BYTES / 3 + 1))).toThrow(
      /larger than 5 MiB/,
    );
  });
});
