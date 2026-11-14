import Dexie, { type EntityTable } from 'dexie';

import { settingsRecordSchema } from '../domain/schemas';
import type { SessionRecord } from '../domain/session-types';
import type {
  CardRecord,
  ContentIssue,
  MetaRecord,
  ReviewEvent,
  SettingsRecord,
} from '../domain/types';
import { InvalidPersistedDataError, mapStorageError } from './errors';

export const DEFAULT_DATABASE_NAME = 'kanjipain';

export const DEFAULT_SETTINGS: Readonly<SettingsRecord> = Object.freeze({
  id: 'user',
  dailyNewLimit: 5,
  inputMode: 'drawing',
  onboardingCompleted: false,
});

export class KanjiPainDatabase extends Dexie {
  cards!: EntityTable<CardRecord, 'id'>;
  events!: EntityTable<ReviewEvent, 'id'>;
  sessions!: EntityTable<SessionRecord, 'id'>;
  settings!: EntityTable<SettingsRecord, 'id'>;
  contentIssues!: EntityTable<ContentIssue, 'id'>;
  meta!: EntityTable<MetaRecord, 'key'>;

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
    });
  } catch (error) {
    throw mapStorageError(error, 'initializing KanjiPain');
  }
}
