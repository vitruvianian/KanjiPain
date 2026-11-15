import Dexie, { type EntityTable } from 'dexie';

import { settingsRecordSchema } from '../domain/schemas';
import type { SessionRecord } from '../domain/session-types';
import {
  DEFAULT_REVIEW_PACE,
  STANDARD_DECK_ID,
  type CardRecord,
  type ContentIssue,
  type DeckEntryRecord,
  type DeckRecord,
  type MetaRecord,
  type ReviewEvent,
  type SettingsRecord,
  type SyncShadowRecord,
} from '../domain/types';
import { InvalidPersistedDataError, mapStorageError } from './errors';

export const DEFAULT_DATABASE_NAME = 'kanjipain';

export const DEFAULT_SETTINGS: Readonly<SettingsRecord> = Object.freeze({
  id: 'user',
  dailyNewLimit: 5,
  inputMode: 'drawing',
  onboardingCompleted: false,
  activeDeckId: STANDARD_DECK_ID,
  reviewPace: DEFAULT_REVIEW_PACE,
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
  syncShadow!: EntityTable<SyncShadowRecord, 'key'>;

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

    // Account sync: what the cloud copy is known to hold, one fingerprint per record.
    this.version(3).stores({
      syncShadow: 'key',
    });
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
      // Fields added since these settings were saved get their defaults written back.
      if (
        currentSettings.activeDeckId !== validation.data.activeDeckId ||
        currentSettings.reviewPace !== validation.data.reviewPace
      ) {
        await database.settings.put(validation.data);
      }
    });
  } catch (error) {
    throw mapStorageError(error, 'initializing KanjiPain');
  }
}
