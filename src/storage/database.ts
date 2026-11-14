import Dexie, { type EntityTable } from 'dexie';

import { settingsRecordSchema } from '../domain/schemas';
import type { SessionRecord } from '../domain/session-types';
import {
  STANDARD_DECK_ID,
  type CardRecord,
  type ContentIssue,
  type DeckEntryRecord,
  type DeckRecord,
  type MetaRecord,
  type ReviewEvent,
  type SettingsRecord,
} from '../domain/types';
import { InvalidPersistedDataError, mapStorageError } from './errors';

export const DEFAULT_DATABASE_NAME = 'kanjipain';

export const DEFAULT_SETTINGS: Readonly<SettingsRecord> = Object.freeze({
  id: 'user',
  dailyNewLimit: 5,
  inputMode: 'drawing',
  onboardingCompleted: false,
  activeDeckId: STANDARD_DECK_ID,
});

export class KanjiPainDatabase extends Dexie {
  cards!: EntityTable<CardRecord, 'id'>;
  events!: EntityTable<ReviewEvent, 'id'>;
  sessions!: EntityTable<SessionRecord, 'id'>;
  settings!: EntityTable<SettingsRecord, 'id'>;
  contentIssues!: EntityTable<ContentIssue, 'id'>;
  meta!: EntityTable<MetaRecord, 'key'>;
  decks!: EntityTable<DeckRecord, 'id'>;
  deckEntries!: EntityTable<DeckEntryRecord, 'id'>;

  constructor(name = DEFAULT_DATABASE_NAME) {
    super(name);

    this.version(1).stores({
      cards: 'id,dueAt,kanjiId,introducedLocalDay',
      events: 'id,sessionId,cardId,occurredAt,[cardId+occurredAt]',
      sessions: 'id,status,startedAt',
      settings: 'id',
      contentIssues: 'id,cardId,createdAt',
      meta: 'key',
    });

    // Custom decks. Existing progress is untouched: cards stay one per character.
    this.version(2)
      .stores({
        decks: 'id',
        deckEntries: 'id,deckId,kanjiId',
      })
      .upgrade((transaction) =>
        transaction
          .table<SettingsRecord>('settings')
          .toCollection()
          .modify((settings: Partial<SettingsRecord>) => {
            settings.activeDeckId ??= STANDARD_DECK_ID;
          }),
      );
  }
}

export function createDatabase(name = DEFAULT_DATABASE_NAME): KanjiPainDatabase {
  return new KanjiPainDatabase(name);
}

export async function initializeDatabase(database: KanjiPainDatabase): Promise<void> {
  try {
    await database.open();
    await database.transaction('rw', database.settings, async () => {
      const currentSettings = await database.settings.get('user');
      if (currentSettings === undefined) {
        await database.settings.add({ ...DEFAULT_SETTINGS });
        return;
      }

      const validation = settingsRecordSchema.safeParse(currentSettings);
      if (!validation.success) {
        throw new InvalidPersistedDataError('settings', validation.error);
      }
      if (currentSettings.activeDeckId !== validation.data.activeDeckId) {
        await database.settings.put(validation.data);
      }
    });
  } catch (error) {
    throw mapStorageError(error, 'initializing KanjiPain');
  }
}
