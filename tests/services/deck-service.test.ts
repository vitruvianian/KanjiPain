import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_DECKS, parsePastedCharacters, parseDeckTable } from '../../src/domain/deck-import';
import { lookupStrokeCounts } from '../../src/recognition/load';
import {
  DeckInUseError,
  DeckLimitError,
  DeckNotFoundError,
  DeckValidationError,
  StandardDeckProtectedError,
} from '../../src/services/deck-service';
import { catalogEntry, createHarness, dueCard } from './service-fixtures';

const databases: { readonly name: string; readonly database: Dexie }[] = [];

async function harness(label: string, entryCount = 3) {
  const name = `services-deck-${label}-${crypto.randomUUID()}`;
  const result = await createHarness(
    name,
    Array.from({ length: entryCount }, (_, index) => catalogEntry(index)),
  );
  databases.push({ name, database: result.database });
  return result;
}

afterEach(async () => {
  for (const item of databases.splice(0)) {
    item.database.close();
    await Dexie.delete(item.name);
  }
});

describe('deck service', () => {
  it('rejects every change aimed at the Standard deck', async () => {
    const { decks } = await harness('standard');

    await expect(decks.updateDeck('standard', { name: 'Mine' })).rejects.toBeInstanceOf(
      StandardDeckProtectedError,
    );
    await expect(decks.deleteDeck('standard')).rejects.toBeInstanceOf(StandardDeckProtectedError);
    await expect(
      decks.previewImport('standard', parsePastedCharacters('猫')),
    ).rejects.toBeInstanceOf(StandardDeckProtectedError);
    await expect(
      decks.commitImport({ deckId: 'standard', rows: [], rejected: [] }),
    ).rejects.toBeInstanceOf(StandardDeckProtectedError);
    await expect(decks.removeEntry('standard', 'k-4e00')).rejects.toBeInstanceOf(
      StandardDeckProtectedError,
    );
    await expect(
      decks.updateEntry('standard', 'k-4e00', { meanings: ['x'], readingCues: [] }),
    ).rejects.toBeInstanceOf(StandardDeckProtectedError);
    await expect(decks.recheckStrokes('standard')).rejects.toBeInstanceOf(
      StandardDeckProtectedError,
    );

    const list = await decks.listDecks();
    expect(list).toEqual([
      expect.objectContaining({ id: 'standard', kind: 'standard', entryCount: 3 }),
    ]);
  });

  it('imports pasted characters, classifying recognized and unrecognized ones', async () => {
    const { decks } = await harness('import');
    const deck = await decks.createDeck('  Pets ');
    expect(deck.name).toBe('Pets');

    const preview = await decks.previewImport(deck.id, parsePastedCharacters('猫犬☃'));
    expect(
      preview.rows.map((row) => [row.draft.literal, row.status, row.strokeCount !== null]),
    ).toEqual([
      ['猫', 'new', true],
      ['犬', 'new', true],
      ['☃', 'new', false],
    ]);
    await expect(decks.commitImport(preview)).resolves.toEqual({ added: 3, merged: 0 });

    const entries = await decks.getEntries(deck.id);
    expect(entries.map((entry) => [entry.literal, entry.strokeStatus, entry.position])).toEqual([
      ['猫', 'available', 0],
      ['犬', 'available', 1],
      ['☃', 'unrecognized', 2],
    ]);
    expect((await decks.getDeck(deck.id))?.revision).toBe(1);
    expect(await decks.listDecks()).toContainEqual(
      expect.objectContaining({
        id: deck.id,
        entryCount: 3,
        unrecognizedCount: 1,
        withoutCueCount: 3,
      }),
    );
  });

  it('merges a character that is already in the deck instead of adding it twice', async () => {
    const { decks } = await harness('merge');
    const deck = await decks.createDeck('Pets');
    await decks.commitImport(
      await decks.previewImport(deck.id, parseDeckTable('kanji,meanings,note\n猫,cat,old note\n')),
    );

    const preview = await decks.previewImport(
      deck.id,
      parseDeckTable('kanji,meanings,readings,note\n猫,feline,ねこ,new note\n鳥,bird,とり,\n'),
    );
    expect(preview.rows.map((row) => row.status)).toEqual(['merge', 'new']);
    await expect(decks.commitImport(preview)).resolves.toEqual({ added: 1, merged: 1 });

    const entries = await decks.getEntries(deck.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      literal: '猫',
      meanings: ['cat', 'feline'],
      readingCues: ['ねこ'],
      note: 'new note',
      position: 0,
    });
  });

  it('rejects an edit whose cue contains the character itself', async () => {
    const { decks } = await harness('leak');
    const deck = await decks.createDeck('Pets');
    await decks.commitImport(await decks.previewImport(deck.id, parsePastedCharacters('猫')));

    await expect(
      decks.updateEntry(deck.id, 'k-732b', { meanings: ['the 猫'], readingCues: [] }),
    ).rejects.toBeInstanceOf(DeckValidationError);
    await decks.updateEntry(deck.id, 'k-732b', {
      meanings: [' cat ', 'cat', ''],
      readingCues: ['ねこ'],
      note: ' ',
      mnemonic: 'whiskers',
    });
    expect((await decks.getEntries(deck.id))[0]).toMatchObject({
      meanings: ['cat'],
      readingCues: ['ねこ'],
      mnemonic: 'whiskers',
    });
    expect((await decks.getEntries(deck.id))[0]).not.toHaveProperty('note');
  });

  it('enforces the deck count, name and entry limits', async () => {
    const { decks } = await harness('limits');
    await expect(decks.createDeck('   ')).rejects.toBeInstanceOf(DeckValidationError);
    await expect(decks.createDeck('x'.repeat(81))).rejects.toBeInstanceOf(DeckValidationError);

    const first = await decks.createDeck('Deck 0');
    for (let index = 1; index < MAX_DECKS; index += 1) {
      await decks.createDeck(`Deck ${String(index)}`);
    }
    await expect(decks.createDeck('One too many')).rejects.toBeInstanceOf(DeckLimitError);

    const tooMany = Array.from({ length: 5_001 }, (_, index) =>
      String.fromCodePoint(0x4e00 + index),
    ).join('');
    const preview = await decks.previewImport(first.id, parsePastedCharacters(tooMany));
    await expect(decks.commitImport(preview)).rejects.toBeInstanceOf(DeckLimitError);
    await expect(decks.getEntries(first.id)).resolves.toHaveLength(0);
  });

  it('keeps cards and history when a deck is deleted, and resets the active deck', async () => {
    const { decks, database } = await harness('delete');
    const deck = await decks.createDeck('Pets');
    await decks.commitImport(await decks.previewImport(deck.id, parsePastedCharacters('猫')));
    await decks.setActiveDeck(deck.id);
    await database.cards.put(dueCard({ ...catalogEntry(0), id: 'k-732b', literal: '猫' }));

    await decks.deleteDeck(deck.id);

    await expect(database.cards.count()).resolves.toBe(1);
    await expect(database.deckEntries.count()).resolves.toBe(0);
    await expect(decks.getDeck(deck.id)).resolves.toBeUndefined();
    expect((await database.settings.get('user'))?.activeDeckId).toBe('standard');
    expect((await decks.getActiveContent()).deck.id).toBe('standard');
    await expect(decks.deleteDeck(deck.id)).rejects.toBeInstanceOf(DeckNotFoundError);
    await expect(decks.setActiveDeck(deck.id)).rejects.toBeInstanceOf(DeckNotFoundError);
  });

  it('cannot be edited or deleted while a session is using it', async () => {
    const { decks, sessions } = await harness('in-use');
    const deck = await decks.createDeck('Pets');
    await decks.commitImport(
      await decks.previewImport(deck.id, parseDeckTable('kanji,meanings\n猫,cat\n')),
    );
    await decks.setActiveDeck(deck.id);
    const session = await sessions.startOrResumeSession();
    expect(session.deckId).toBe(deck.id);

    await expect(decks.deleteDeck(deck.id)).rejects.toBeInstanceOf(DeckInUseError);
    await expect(decks.updateDeck(deck.id, { name: 'Other' })).rejects.toBeInstanceOf(
      DeckInUseError,
    );
    await expect(decks.removeEntry(deck.id, 'k-732b')).rejects.toBeInstanceOf(DeckInUseError);

    await sessions.finishSession(session.id, session.revision);
    await expect(decks.updateDeck(deck.id, { name: 'Other' })).resolves.toMatchObject({
      name: 'Other',
    });
  });

  it('copies the Standard deck with dictionary text, and adds single characters', async () => {
    const { decks } = await harness('copy');
    const copy = await decks.copyStandardDeck('Copy of Standard');
    const entries = await decks.getEntries(copy.id);
    expect(entries.map((entry) => entry.literal)).toEqual(['一', '丁', '丂']);
    expect(entries[0]).toMatchObject({ meanings: ['meaning 0'], readingCues: ['くん0', 'オン0'] });

    // The learner's own text is kept when the character is added again.
    await decks.updateEntry(copy.id, 'k-4e00', { meanings: ['mine'], readingCues: [] });
    await expect(decks.addFromStandard(copy.id, ['k-4e00'])).resolves.toEqual({
      added: 0,
      merged: 0,
    });
    expect((await decks.getEntries(copy.id))[0]?.meanings).toEqual(['mine']);
  });

  it('upgrades an unrecognized entry when stroke data appears', async () => {
    const { decks, database } = await harness('recheck');
    const deck = await decks.createDeck('Pets');
    await decks.commitImport(await decks.previewImport(deck.id, parsePastedCharacters('猫')));
    // As if 猫 had been imported before the stroke data covered it.
    await database.deckEntries.update(`${deck.id}:k-732b`, {
      strokeStatus: 'unrecognized',
      strokeCount: null,
    });

    await expect(decks.recheckStrokes()).resolves.toBe(1);
    expect((await decks.getEntries(deck.id))[0]).toMatchObject({ strokeStatus: 'available' });
    await expect(decks.recheckStrokes(deck.id)).resolves.toBe(0);
  });

  it('orders new introductions as imported, by stroke count, or shuffled', async () => {
    const { decks } = await harness('order');
    const deck = await decks.createDeck('Order');
    // Fixture stroke counts: 丁 (U+4E01) 2, 一 (U+4E00) 1; ☃ has none.
    await decks.commitImport(await decks.previewImport(deck.id, parsePastedCharacters('☃丁一')));
    const literals = async () => (await decks.getEntries(deck.id)).map((entry) => entry.literal);

    await expect(literals()).resolves.toEqual(['☃', '丁', '一']);
    await decks.updateDeck(deck.id, { order: 'stroke-count' });
    await expect(literals()).resolves.toEqual(['一', '丁', '☃']);
    await decks.updateDeck(deck.id, { order: 'shuffled' });
    const shuffled = await literals();
    expect([...shuffled].sort()).toEqual(['☃', '一', '丁'].sort());
    await expect(literals()).resolves.toEqual(shuffled);
  });
});

describe('bundled stroke shards', () => {
  it('recognizes characters beyond the Jōyō set and reports the rest as missing', async () => {
    // 猫 is Jōyō, 鷲 is not but KanjiVG has it, ☃ is not a character KanjiVG covers.
    const counts = await lookupStrokeCounts(['k-732b', 'k-9df2', 'k-2603']);
    expect(counts.get('k-732b')).toBe(11);
    expect(counts.get('k-9df2')).toBe(23);
    expect(counts.has('k-2603')).toBe(false);
  });
});
