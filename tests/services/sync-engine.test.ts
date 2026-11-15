import { describe, expect, it } from 'vitest';

import type { CardRecord } from '../../src/domain/types';
import { MemoryRemoteStore } from '../../src/services/sync/memory-remote';
import { CloudCopyDeletedError } from '../../src/services/sync/sync-engine';
import { answerNext, DAY, device, practice, type Device } from './device-fixtures';
import { catalogEntry } from './service-fixtures';

/** A card's version only orders changes on one device, so devices may disagree on it. */
function withoutVersion(card: CardRecord): CardRecord {
  return { ...card, version: 0 };
}

async function snapshot(current: Device) {
  const { database } = current;
  return {
    cards: (await database.cards.orderBy('id').toArray()).map(withoutVersion),
    events: await database.events.orderBy('id').toArray(),
    sessions: await database.sessions.orderBy('id').toArray(),
    decks: await database.decks.orderBy('id').toArray(),
    deckEntries: await database.deckEntries.orderBy('id').toArray(),
  };
}

describe('account sync', () => {
  it('gives a new device the same progress, and that progress is a valid backup', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    await practice(phone);

    const first = await phone.engine.sync(cloud);
    expect(first.pushed).toBeGreaterThan(0);
    expect(cloud.count('cards')).toBe(3);
    expect(cloud.count('events')).toBe(3);

    const tablet = await device('tablet');
    const second = await tablet.engine.sync(cloud);
    expect(second.pulled).toBeGreaterThan(0);

    const expected = await snapshot(phone);
    const actual = await snapshot(tablet);
    expect(actual.events).toEqual(expected.events);
    expect(actual.sessions).toEqual(expected.sessions);
    expect(actual.cards).toEqual(expected.cards);
    await expect(tablet.backup.createExport()).resolves.toMatchObject({
      format: 'kanjipain-backup',
    });
  });

  it('does nothing when neither side has changed', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    const tablet = await device('tablet');
    await practice(phone);
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    await expect(phone.engine.sync(cloud)).resolves.toMatchObject({ pulled: 0, pushed: 0 });
    await expect(tablet.engine.sync(cloud)).resolves.toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('keeps both reviews when two devices review the same card while apart', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    const tablet = await device('tablet');
    await practice(phone);
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    // Both devices go offline and review once the cards are due, an hour apart.
    phone.clock.value += 30 * DAY;
    tablet.clock.value += 30 * DAY + 3_600_000;
    await practice(phone, 'got');
    await practice(tablet, 'barely');

    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    const onPhone = await snapshot(phone);
    const onTablet = await snapshot(tablet);
    expect(onPhone.events).toHaveLength(9);
    expect(onTablet.events).toEqual(onPhone.events);
    expect(onTablet.cards).toEqual(onPhone.cards);
    for (const card of onPhone.cards) {
      // The first review on the first device, then one more on each device.
      expect(card.scheduledReviewCount).toBe(3);
      expect(card.schedulerState.card.lastReviewAt).toBeGreaterThanOrEqual(
        tablet.clock.value - 60_000,
      );
    }
    await expect(phone.engine.sync(cloud)).resolves.toMatchObject({ pulled: 0, pushed: 0 });
    await expect(tablet.backup.createExport()).resolves.toBeDefined();
  });

  it('merges progress made before signing in on a second device', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    const tablet = await device('tablet');
    await practice(phone);
    tablet.clock.value += 5_000;
    await practice(tablet, 'missed');

    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);
    await phone.engine.sync(cloud);

    const onPhone = await snapshot(phone);
    expect(onPhone.sessions).toHaveLength(2);
    expect(await snapshot(tablet)).toEqual(onPhone);
    for (const card of onPhone.cards) {
      expect(card.introducedInSessionId).toMatch(/^phone-/);
    }
  });

  it('syncs custom decks: created, edited and deleted', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    const tablet = await device('tablet');

    const deck = await phone.decks.copyStandardDeck('Trip words');
    await phone.decks.setActiveDeck(deck.id);
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    expect((await tablet.decks.listDecks()).map((item) => item.name)).toContain('Trip words');
    expect(await tablet.decks.getEntries(deck.id)).toHaveLength(3);
    await expect(tablet.database.settings.get('user')).resolves.toMatchObject({
      activeDeckId: deck.id,
    });

    tablet.clock.value += 1_000;
    await tablet.decks.updateDeck(deck.id, { name: 'Travel' });
    await tablet.decks.removeEntry(deck.id, catalogEntry(2).id);
    await tablet.engine.sync(cloud);
    await phone.engine.sync(cloud);

    await expect(phone.decks.getDeck(deck.id)).resolves.toMatchObject({ name: 'Travel' });
    expect(await phone.decks.getEntries(deck.id)).toHaveLength(2);

    await phone.decks.deleteDeck(deck.id);
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    await expect(tablet.decks.getDeck(deck.id)).resolves.toBeUndefined();
    expect(await tablet.decks.getEntries(deck.id)).toHaveLength(0);
    await expect(tablet.database.settings.get('user')).resolves.toMatchObject({
      activeDeckId: 'standard',
    });
    expect(cloud.count('decks')).toBe(0);
    await expect(phone.engine.sync(cloud)).resolves.toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('keeps the later edit when a deck changes on two devices', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    const tablet = await device('tablet');
    const deck = await phone.decks.createDeck('Shared');
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    phone.clock.value += 1_000;
    await phone.decks.updateDeck(deck.id, { name: 'Earlier' });
    tablet.clock.value += 2_000;
    await tablet.decks.updateDeck(deck.id, { name: 'Later' });

    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);
    await phone.engine.sync(cloud);

    await expect(phone.decks.getDeck(deck.id)).resolves.toMatchObject({ name: 'Later' });
    await expect(tablet.decks.getDeck(deck.id)).resolves.toMatchObject({ name: 'Later' });
  });

  it('leaves a session open on this device and drops work done elsewhere', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    const tablet = await device('tablet');
    await practice(phone);
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    // The tablet starts the due reviews and answers one; the phone then does them all.
    phone.clock.value += 30 * DAY;
    tablet.clock.value += 30 * DAY;
    const started = await answerNext(tablet);
    expect(started.primaryItems.map((item) => item.status)).toEqual(['done', 'pending', 'pending']);
    await tablet.engine.sync(cloud);
    phone.clock.value += 60_000;
    await phone.engine.sync(cloud);
    await practice(phone);
    await phone.engine.sync(cloud);

    // The phone saw the tablet's unfinished session as ended so far.
    await expect(phone.database.sessions.get(started.id)).resolves.toMatchObject({
      status: 'ended',
    });

    tablet.clock.value += 120_000;
    await tablet.engine.sync(cloud);
    const resumed = await tablet.sessions.startOrResumeSession();
    expect(resumed.id).toBe(started.id);
    expect(resumed.status).toBe('active');
    expect(resumed.revision).toBeGreaterThan(started.revision);
    expect(resumed.primaryItems.map((item) => item.status)).toEqual(['done', 'skipped', 'skipped']);
    const finished = await tablet.sessions.openNextItem(resumed.id, resumed.revision);
    expect(finished.session.status).toBe('completed');

    await tablet.engine.sync(cloud);
    await phone.engine.sync(cloud);
    await expect(phone.database.sessions.get(started.id)).resolves.toMatchObject({
      status: 'completed',
    });
    expect((await snapshot(tablet)).cards).toEqual((await snapshot(phone)).cards);
  });

  it('replaces progress everywhere when a backup is restored', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    const tablet = await device('tablet');
    await practice(phone);
    const backupText = await phone.backup.exportJson();
    await phone.engine.sync(cloud);
    await tablet.engine.sync(cloud);

    phone.clock.value += 30 * DAY;
    tablet.clock.value += 30 * DAY;
    await practice(tablet);
    await tablet.engine.sync(cloud);
    await phone.engine.sync(cloud);
    expect(await phone.database.events.count()).toBe(6);

    await phone.backup.replaceWithImport(backupText);
    await expect(phone.engine.sync(cloud)).resolves.toMatchObject({ replaced: false });
    expect(cloud.count('events')).toBe(3);

    await expect(tablet.engine.sync(cloud)).resolves.toMatchObject({ replaced: true });
    expect(await tablet.database.events.count()).toBe(3);
    expect(await snapshot(tablet)).toEqual(await snapshot(phone));
    await expect(phone.engine.sync(cloud)).resolves.toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('stops, keeping local progress, when the cloud copy was deleted elsewhere', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    await practice(phone);
    await phone.engine.sync(cloud);
    await cloud.deleteAll();

    await expect(phone.engine.sync(cloud)).rejects.toBeInstanceOf(CloudCopyDeletedError);
    expect(await phone.database.events.count()).toBe(3);
    expect(cloud.count('events')).toBe(0);
  });

  it('refuses to mix two accounts on one device until the device is replaced', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone', 'user-1');
    await practice(phone);
    await phone.engine.unlink();

    await expect(phone.engine.link('user-2')).resolves.toBe(false);
    await expect(phone.engine.link('user-1')).resolves.toBe(true);
    await phone.engine.unlink();

    await phone.engine.replaceLocalData('user-2');
    expect(await phone.database.cards.count()).toBe(0);
    await expect(phone.engine.sync(cloud)).resolves.toMatchObject({ pulled: 0 });
    expect(cloud.count('events')).toBe(0);
  });

  it('rejects cloud records it cannot read without changing anything', async () => {
    const cloud = new MemoryRemoteStore();
    const phone = await device('phone');
    await phone.engine.sync(cloud);
    const state = await phone.engine.readState();
    await cloud.push({
      generation: state.generation ?? '',
      deviceId: 'another-device',
      records: [{ collection: 'cards', id: 'k-4e00:production', data: { id: 1 }, deleted: false }],
    });

    await expect(phone.engine.sync(cloud)).rejects.toThrow(/cannot read/);
    expect(await phone.database.cards.count()).toBe(0);
    await expect(phone.engine.readState()).resolves.toMatchObject({ cursor: state.cursor });
  });
});
