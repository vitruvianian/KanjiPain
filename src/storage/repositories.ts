import {
  cardRecordSchema,
  contentIssueSchema,
  reviewEventSchema,
  sessionRecordSchema,
  settingsRecordSchema,
} from '../domain/schemas';
import type { SessionRecord, SessionStatus } from '../domain/session-types';
import type {
  CardRecord,
  ContentIssue,
  ReviewEvent,
  SettingsRecord,
  UnixMs,
} from '../domain/types';
import type { KanjiPainDatabase } from './database';
import { InvalidPersistedDataError, mapStorageError } from './errors';

export interface StorageRepositories {
  getSettings(): Promise<SettingsRecord>;
  getAllCards(): Promise<CardRecord[]>;
  getAllEvents(): Promise<ReviewEvent[]>;
  getCard(id: string): Promise<CardRecord | undefined>;
  getDueCards(now: UnixMs): Promise<CardRecord[]>;
  getCardHistory(cardId: string, limit?: number): Promise<ReviewEvent[]>;
  getSession(id: string): Promise<SessionRecord | undefined>;
  getSessions(status?: SessionStatus): Promise<SessionRecord[]>;
  getSessionEvents(sessionId: string): Promise<ReviewEvent[]>;
  getSessionIntroducedCards(sessionId: string): Promise<CardRecord[]>;
  getActiveSession(): Promise<SessionRecord | undefined>;
  getContentIssues(cardId?: string): Promise<ContentIssue[]>;
  getIntroductionsForDay(localDay: string): Promise<CardRecord[]>;
}

function parseSettings(value: unknown): SettingsRecord {
  const result = settingsRecordSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('settings', result.error);
  }
  return result.data;
}

function parseCard(value: unknown): CardRecord {
  const result = cardRecordSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('card', result.error);
  }
  return result.data;
}

function parseEvent(value: unknown): ReviewEvent {
  const result = reviewEventSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('review event', result.error);
  }
  return result.data;
}

function parseSession(value: unknown): SessionRecord {
  const result = sessionRecordSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('session', result.error);
  }
  return result.data;
}

function parseContentIssue(value: unknown): ContentIssue {
  const result = contentIssueSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('content issue', result.error);
  }
  return result.data;
}

async function readStorage<T>(operation: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw mapStorageError(error, operation);
  }
}

class DexieStorageRepositories implements StorageRepositories {
  readonly #database: KanjiPainDatabase;

  constructor(database: KanjiPainDatabase) {
    this.#database = database;
  }

  async getSettings(): Promise<SettingsRecord> {
    return readStorage('reading settings', async () => {
      const settings = await this.#database.settings.get('user');
      if (settings === undefined) {
        throw new InvalidPersistedDataError('settings');
      }
      return parseSettings(settings);
    });
  }

  async getCard(id: string): Promise<CardRecord | undefined> {
    return readStorage('reading a card', async () => {
      const card = await this.#database.cards.get(id);
      return card === undefined ? undefined : parseCard(card);
    });
  }

  async getAllCards(): Promise<CardRecord[]> {
    return readStorage('reading all cards', async () => {
      const cards = await this.#database.cards.toArray();
      return cards.map(parseCard).sort((left, right) => left.id.localeCompare(right.id));
    });
  }

  async getAllEvents(): Promise<ReviewEvent[]> {
    return readStorage('reading review history', async () => {
      const events = await this.#database.events.toArray();
      return events
        .map(parseEvent)
        .sort(
          (left, right) => left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
        );
    });
  }

  async getDueCards(now: UnixMs): Promise<CardRecord[]> {
    return readStorage('reading due cards', async () => {
      const cards = await this.#database.cards.where('dueAt').belowOrEqual(now).sortBy('dueAt');
      return cards.map(parseCard).filter((card) => !card.suspended);
    });
  }

  async getCardHistory(cardId: string, limit = 20): Promise<ReviewEvent[]> {
    return readStorage('reading card history', async () => {
      const events = await this.#database.events.where('cardId').equals(cardId).toArray();
      return events
        .map(parseEvent)
        .sort((left, right) => right.occurredAt - left.occurredAt)
        .slice(0, limit);
    });
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    return readStorage('reading a session', async () => {
      const session = await this.#database.sessions.get(id);
      return session === undefined ? undefined : parseSession(session);
    });
  }

  async getSessions(status?: SessionStatus): Promise<SessionRecord[]> {
    return readStorage('reading sessions', async () => {
      const sessions =
        status === undefined
          ? await this.#database.sessions.orderBy('startedAt').reverse().toArray()
          : await this.#database.sessions.where('status').equals(status).toArray();
      return sessions.map(parseSession).sort((left, right) => right.startedAt - left.startedAt);
    });
  }

  async getSessionEvents(sessionId: string): Promise<ReviewEvent[]> {
    return readStorage('reading session reviews', async () => {
      const events = await this.#database.events.where('sessionId').equals(sessionId).toArray();
      return events.map(parseEvent).sort((left, right) => left.occurredAt - right.occurredAt);
    });
  }

  async getSessionIntroducedCards(sessionId: string): Promise<CardRecord[]> {
    return readStorage('reading introduced characters', async () => {
      const cards = await this.#database.cards
        .filter((card) => card.introducedInSessionId === sessionId)
        .toArray();
      return cards.map(parseCard).sort((left, right) => left.introducedAt - right.introducedAt);
    });
  }

  async getActiveSession(): Promise<SessionRecord | undefined> {
    const activeSessions = await this.getSessions('active');
    if (activeSessions.length > 1) {
      throw new InvalidPersistedDataError('sessions');
    }
    return activeSessions[0];
  }

  async getContentIssues(cardId?: string): Promise<ContentIssue[]> {
    return readStorage('reading content issues', async () => {
      const issues =
        cardId === undefined
          ? await this.#database.contentIssues.orderBy('createdAt').reverse().toArray()
          : await this.#database.contentIssues.where('cardId').equals(cardId).toArray();
      return issues.map(parseContentIssue).sort((left, right) => right.createdAt - left.createdAt);
    });
  }

  async getIntroductionsForDay(localDay: string): Promise<CardRecord[]> {
    return readStorage('reading daily introductions', async () => {
      const cards = await this.#database.cards
        .where('introducedLocalDay')
        .equals(localDay)
        .toArray();
      return cards.map(parseCard).sort((left, right) => left.introducedAt - right.introducedAt);
    });
  }
}

export function createStorageRepositories(database: KanjiPainDatabase): StorageRepositories {
  return new DexieStorageRepositories(database);
}
