import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import type { CardRecord, ReviewEvent, SettingsRecord } from '../../src/domain/types';
import type { SerializedFsrsCard, SerializedFsrsLog } from '../../src/scheduler/types';
import {
  createDatabase,
  initializeDatabase,
  type KanjiPainDatabase,
} from '../../src/storage/database';
import { InvalidPersistedDataError } from '../../src/storage/errors';
import { createStorageRepositories } from '../../src/storage/repositories';

const datasetVersion = 'a'.repeat(64);
const openDatabases: KanjiPainDatabase[] = [];
const databaseNames = new Set<string>();

const schedulerState: SerializedFsrsCard = {
  adapterVersion: 1,
  packageVersion: '6.0.0',
  model: 'FSRS-7',
  card: {
    stability: 3.9221,
    stabilityFast: 3.13768,
    difficulty: 3.53072398,
    state: 2,
    scheduleStatus: 'review',
    dueAt: 1_800_000_001_000,
    lastReviewAt: 1_800_000_000_000,
    cardId: 'k-6e56:production',
    reps: 1,
    lapses: 0,
    scheduledDays: 4.77,
    learningStep: 0,
  },
};

const schedulerLog: SerializedFsrsLog = {
  adapterVersion: 1,
  packageVersion: '6.0.0',
  model: 'FSRS-7',
  revlog: {
    stability: 0,
    stabilityFast: 0,
    difficulty: 0,
    state: 0,
    scheduleStatus: 'new',
    rating: 3,
    dueAt: 1_800_000_000_000,
    lastReviewAt: null,
    reviewTime: 1_800_000_000_000,
    cardId: 'k-6e56:production',
    scheduledDays: 0,
    learningStep: 0,
  },
};

function testDatabase(label: string): KanjiPainDatabase {
  const name = `kanjipain-test-${label}-${crypto.randomUUID()}`;
  databaseNames.add(name);
  const database = createDatabase(name);
  openDatabases.push(database);
  return database;
}

function card(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: 'k-6e56:production',
    kanjiId: 'k-6e56',
    skill: 'production',
    introducedAt: 1_800_000_000_000,
    introducedLocalDay: '2027-01-15',
    introducedInSessionId: 'session-1',
    dueAt: 1_800_000_001_000,
    schedulerState,
    scheduledReviewCount: 1,
    suspended: false,
    version: 1,
    ...overrides,
  };
}

function event(): ReviewEvent {
  return {
    id: 'attempt-1',
    sessionId: 'session-1',
    cardId: 'k-6e56:production',
    itemId: 'item-1',
    kind: 'scheduled',
    isFirstLearningCheck: false,
    grade: 'got',
    assisted: false,
    hintKeysUsed: [],
    inputMode: 'drawing',
    occurredAt: 1_800_000_001_000,
    durationMs: 2_000,
    beforeVersion: 0,
    afterVersion: 1,
    schedulerLog,
    datasetVersion,
  };
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
  databaseNames.clear();
});

describe('database initialization', () => {
  it('persists data after closing and reopening a named database', async () => {
    const first = testDatabase('persistence');
    await initializeDatabase(first);
    await first.cards.add(card());
    const name = first.name;
    first.close();

    const reopened = createDatabase(name);
    openDatabases.push(reopened);
    await initializeDatabase(reopened);
    const repository = createStorageRepositories(reopened);

    await expect(repository.getCard('k-6e56:production')).resolves.toMatchObject({
      kanjiId: 'k-6e56',
    });
  });

  it('seeds settings once without creating cards', async () => {
    const database = testDatabase('defaults');
    await initializeDatabase(database);

    await expect(database.settings.get('user')).resolves.toMatchObject({
      dailyNewLimit: 5,
      inputMode: 'drawing',
    });
    await expect(database.cards.count()).resolves.toBe(0);
  });

  it('does not overwrite existing settings during another initialization', async () => {
    const database = testDatabase('idempotent-settings');
    await initializeDatabase(database);
    const customSettings: SettingsRecord = {
      id: 'user',
      dailyNewLimit: 0,
      inputMode: 'paper',
      onboardingCompleted: true,
      activeDeckId: 'standard',
    };
    await database.settings.put(customSettings);

    await initializeDatabase(database);

    await expect(database.settings.get('user')).resolves.toEqual(customSettings);
  });
});

describe('storage repositories', () => {
  it('includes cards due exactly now and excludes future or suspended cards', async () => {
    const database = testDatabase('due-cards');
    await initializeDatabase(database);
    const now = 1_800_000_010_000;
    await database.cards.bulkAdd([
      card({ id: 'past', kanjiId: 'k-4e00', dueAt: now - 1 }),
      card({ id: 'equal', kanjiId: 'k-6e56', dueAt: now }),
      card({ id: 'future', kanjiId: 'k-98df', dueAt: now + 1 }),
      card({ id: 'suspended', kanjiId: 'k-4e09', dueAt: now - 2, suspended: true }),
    ]);
    const repository = createStorageRepositories(database);

    await expect(repository.getDueCards(now)).resolves.toMatchObject([
      { id: 'past' },
      { id: 'equal' },
    ]);
  });

  it('returns introductions for one local calendar day', async () => {
    const database = testDatabase('introductions');
    await initializeDatabase(database);
    await database.cards.bulkAdd([
      card({ id: 'today-2', introducedAt: 200, introducedLocalDay: '2027-01-15' }),
      card({ id: 'today-1', introducedAt: 100, introducedLocalDay: '2027-01-15' }),
      card({ id: 'tomorrow', introducedAt: 300, introducedLocalDay: '2027-01-16' }),
    ]);
    const repository = createStorageRepositories(database);

    await expect(repository.getIntroductionsForDay('2027-01-15')).resolves.toMatchObject([
      { id: 'today-1' },
      { id: 'today-2' },
    ]);
  });

  it('rejects invalid persisted records at the repository boundary', async () => {
    const database = testDatabase('invalid');
    await initializeDatabase(database);
    await database.settings.put({
      id: 'user',
      dailyNewLimit: 99,
      inputMode: 'drawing',
      onboardingCompleted: false,
      activeDeckId: 'standard',
    });
    const repository = createStorageRepositories(database);

    await expect(repository.getSettings()).rejects.toBeInstanceOf(InvalidPersistedDataError);
  });
});

describe('transactions', () => {
  it('rolls back every table after a forced multi-table failure', async () => {
    const database = testDatabase('rollback');
    await initializeDatabase(database);

    await expect(
      database.transaction('rw', database.cards, database.events, async () => {
        await database.cards.add(card());
        await database.events.add(event());
        throw new Error('forced failure');
      }),
    ).rejects.toThrow('forced failure');

    await expect(database.cards.count()).resolves.toBe(0);
    await expect(database.events.count()).resolves.toBe(0);
  });

  it('migrates a version 1 database with all progress intact', async () => {
    const name = `kanjipain-storage-migration-${crypto.randomUUID()}`;
    databaseNames.add(name);
    // The schema exactly as version 0.1.0 created it, before decks existed.
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      cards: 'id,dueAt,kanjiId,introducedLocalDay',
      events: 'id,sessionId,cardId,occurredAt,[cardId+occurredAt]',
      sessions: 'id,status,startedAt',
      settings: 'id',
      contentIssues: 'id,cardId,createdAt',
      meta: 'key',
    });
    const legacyCard = card();
    await legacy.table('settings').put({
      id: 'user',
      dailyNewLimit: 3,
      inputMode: 'paper',
      onboardingCompleted: true,
    });
    await legacy.table('cards').put(legacyCard);
    legacy.close();

    const migrated = createDatabase(name);
    openDatabases.push(migrated);
    await initializeDatabase(migrated);

    await expect(migrated.settings.get('user')).resolves.toEqual({
      id: 'user',
      dailyNewLimit: 3,
      inputMode: 'paper',
      onboardingCompleted: true,
      activeDeckId: 'standard',
    });
    await expect(migrated.cards.toArray()).resolves.toEqual([legacyCard]);
    await expect(migrated.decks.count()).resolves.toBe(0);
    await expect(migrated.deckEntries.count()).resolves.toBe(0);
  });
});
