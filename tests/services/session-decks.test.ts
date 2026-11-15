import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { parseDeckTable } from '../../src/domain/deck-import';
import { catalogEntry, createHarness, dueCard, NOW, type ServiceHarness } from './service-fixtures';

const databases: { readonly name: string; readonly database: Dexie }[] = [];

async function harness(label: string) {
  const name = `services-session-decks-${label}-${crypto.randomUUID()}`;
  const result = await createHarness(name, [catalogEntry(0), catalogEntry(1), catalogEntry(2)]);
  databases.push({ name, database: result.database });
  return result;
}

/** A custom deck holding 猫 and 一 with cues, and 犬 without any. */
async function petsDeck(current: ServiceHarness) {
  const deck = await current.decks.createDeck('Pets');
  await current.decks.commitImport(
    await current.decks.previewImport(
      deck.id,
      parseDeckTable(
        'kanji,meanings,readings,mnemonic\n猫,cat,ねこ,whiskers\n犬,,,\n一,my one,,\n',
      ),
    ),
  );
  await current.decks.setActiveDeck(deck.id);
  return (await current.decks.getDeck(deck.id)) ?? deck;
}

afterEach(async () => {
  for (const item of databases.splice(0)) {
    item.database.close();
    await Dexie.delete(item.name);
  }
});

describe('sessions in a custom deck', () => {
  it('plans only the active deck: its due cards and its entries that have a cue', async () => {
    const current = await harness('plan');
    const deck = await petsDeck(current);
    // 一 is in both decks and due; 丁 is due too but only in the Standard deck.
    await current.database.cards.bulkPut([dueCard(catalogEntry(0)), dueCard(catalogEntry(1))]);

    const session = await current.sessions.startOrResumeSession();

    expect(session.deckId).toBe(deck.id);
    expect(session.deckRevision).toBe(deck.revision);
    expect(session.primaryItems.map((item) => [item.kanjiId, item.origin])).toEqual([
      ['k-4e00', 'due'],
      ['k-732b', 'new'],
    ]);

    // The card outside the deck was not touched: it is still due for the Standard deck.
    await current.sessions.finishSession(session.id, session.revision);
    await current.decks.setActiveDeck('standard');
    const standard = await current.sessions.startOrResumeSession();
    expect(standard.deckId).toBeUndefined();
    expect(standard.primaryItems.map((item) => item.kanjiId)).toEqual([
      'k-4e00',
      'k-4e01',
      'k-4e02',
    ]);
    const otherCard = await current.database.cards.get('k-4e01:production');
    expect(otherCard?.dueAt).toBe(NOW);
  });

  it('keeps one card per character, so custom-deck learning counts in the Standard deck', async () => {
    const current = await harness('shared');
    await petsDeck(current);
    await current.database.settings.update('user', { dailyNewLimit: 0 });
    await current.database.cards.put(dueCard(catalogEntry(0)));

    const started = await current.sessions.startOrResumeSession();
    const opened = await current.sessions.openNextItem(started.id, started.revision);
    const saved = await current.sessions.saveDraft(opened.session.id, opened.session.revision, {
      paperAttemptConfirmed: true,
      inputMode: 'paper',
    });
    const revealed = await current.sessions.revealAnswer(saved.id, saved.revision, 'compare');
    if (revealed.phase.kind !== 'feedback') throw new Error('Expected feedback.');
    await current.reviews.commitGrade({
      sessionId: revealed.id,
      attemptId: revealed.phase.draft.id,
      expectedRevision: revealed.revision,
      expectedCardVersion: revealed.phase.expectedCardVersion,
      grade: 'got',
    });

    await expect(current.database.cards.count()).resolves.toBe(1);
    const card = await current.database.cards.get('k-4e00:production');
    expect(card?.scheduledReviewCount).toBe(2);
    expect(card?.dueAt).toBeGreaterThan(NOW);
    const [event] = await current.database.events.toArray();
    expect(event?.checkerVerdict).toBeUndefined();
  });

  it("offers the deck entry's own mnemonic as the first hint", async () => {
    const current = await harness('hint');
    await petsDeck(current);
    await current.database.settings.update('user', { dailyNewLimit: 1 });

    const started = await current.sessions.startOrResumeSession();
    const introduced = await current.sessions.openNextItem(started.id, started.revision);
    expect(introduced.session.phase).toMatchObject({ kind: 'introduction', kanjiId: 'k-732b' });
    const prompt = await current.sessions.hideIntroduction(
      introduced.session.id,
      introduced.session.revision,
    );

    const first = await current.sessions.requestHint(prompt.id, prompt.revision);
    expect(first.hintKey).toBe('mnemonic');
    const second = await current.sessions.requestHint(first.session.id, first.session.revision);
    expect(second.hintKey).toBe('stroke-count');
  });

  it('resumes a session in its own deck after another deck becomes active', async () => {
    const current = await harness('resume');
    const deck = await petsDeck(current);
    const started = await current.sessions.startOrResumeSession();

    await current.decks.setActiveDeck('standard');
    const resumed = await current.sessions.startOrResumeSession();

    expect(resumed.id).toBe(started.id);
    expect(resumed.deckId).toBe(deck.id);
  });
});

describe('contrast drills', () => {
  it('drills learned look-alikes back to back, due or not, and records the mode', async () => {
    const name = `services-session-contrast-${crypto.randomUUID()}`;
    const entries = [catalogEntry(0), catalogEntry(1), catalogEntry(2), catalogEntry(3)];
    const current = await createHarness(name, entries, {
      'k-4e00': ['k-4e02'],
      'k-4e02': ['k-4e00'],
      'k-4e01': ['k-4e03'],
      'k-4e03': ['k-4e01'],
    });
    databases.push({ name, database: current.database });
    // 一 and 丂 are not due yet; 丁 is due, but its look-alike 七 is not learned.
    await current.database.cards.bulkPut([
      dueCard(catalogEntry(0), { dueAt: NOW + 86_400_000 }),
      dueCard(catalogEntry(2), { dueAt: NOW + 2 * 86_400_000 }),
      dueCard(catalogEntry(1)),
    ]);

    const session = await current.sessions.startOrResumeSession('contrast');
    expect(session.mode).toBe('contrast');
    expect(session.primaryItems.map((item) => [item.kanjiId, item.origin])).toEqual([
      ['k-4e00', 'due'],
      ['k-4e02', 'due'],
    ]);
  });
});
