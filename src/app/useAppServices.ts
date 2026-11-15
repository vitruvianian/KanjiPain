import { useLiveQuery } from 'dexie-react-hooks';
import { useContext, useSyncExternalStore } from 'react';

import type { SessionRecord, SessionStatus } from '../domain/session-types';
import type {
  CardRecord,
  ContentIssue,
  DeckEntryRecord,
  DeckRecord,
  KanjiId,
  ReviewEvent,
  SettingsRecord,
  UnixMs,
} from '../domain/types';
import type { BackupStatus } from '../services/backup-service';
import type { DeckContent } from '../services/deck-content';
import type { DeckListItem } from '../services/deck-service';
import type { SyncStatus } from '../services/sync/sync-service';
import { AppServicesContext, type AppServices } from './app-services-context';

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (services === null) {
    throw new Error('KanjiPain services must be used inside AppProviders.');
  }
  return services;
}

function useStorageQuery<T>(query: () => Promise<T>, dependencies: unknown[]): T | undefined {
  return useLiveQuery(query, dependencies);
}

export function useSettings(): SettingsRecord | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getSettings(), [storage]);
}

export function useCard(id: string): CardRecord | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getCard(id), [storage, id]);
}

/** Like `useCard`, but tells "still loading" (`undefined`) from "no such card" (`null`). */
export function useCardState(id: string): CardRecord | null | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(async () => (await storage.getCard(id)) ?? null, [storage, id]);
}

export function useAllCards(): CardRecord[] | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getAllCards(), [storage]);
}

export function useAllEvents(): ReviewEvent[] | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getAllEvents(), [storage]);
}

export function useDueCards(now: UnixMs): CardRecord[] | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getDueCards(now), [storage, now]);
}

export function useCardHistory(cardId: string, limit = 20): ReviewEvent[] | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getCardHistory(cardId, limit), [storage, cardId, limit]);
}

export function useSession(id: string): SessionRecord | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getSession(id), [storage, id]);
}

export function useSessions(status?: SessionStatus): SessionRecord[] | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getSessions(status), [storage, status]);
}

export function useSessionEvents(sessionId: string): ReviewEvent[] | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getSessionEvents(sessionId), [storage, sessionId]);
}

export function useSessionIntroducedCards(sessionId: string): CardRecord[] | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getSessionIntroducedCards(sessionId), [storage, sessionId]);
}

export function useContentIssues(cardId?: string): ContentIssue[] | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getContentIssues(cardId), [storage, cardId]);
}

export function useIntroductionsForDay(localDay: string): CardRecord[] | undefined {
  const { storage } = useAppServices();
  return useStorageQuery(() => storage.getIntroductionsForDay(localDay), [storage, localDay]);
}

export function useDecks(): DeckListItem[] | undefined {
  const { decks } = useAppServices();
  return useStorageQuery(() => decks.listDecks(), [decks]);
}

/** The deck practice currently uses; the Standard deck if the chosen one has gone. */
export function useActiveDeck(): DeckContent | undefined {
  const { decks } = useAppServices();
  return useStorageQuery(() => decks.getActiveContent(), [decks]);
}

/**
 * One deck's content; `null` when a custom deck no longer exists. An absent ID means the
 * Standard deck, as it does on sessions.
 */
export function useDeckContent(deckId: string | undefined): DeckContent | null | undefined {
  const { decks } = useAppServices();
  return useStorageQuery(
    async () => (await decks.getContent(deckId ?? 'standard')) ?? null,
    [decks, deckId],
  );
}

export function useDeck(deckId: string): DeckRecord | null | undefined {
  const { decks } = useAppServices();
  return useStorageQuery(async () => (await decks.getDeck(deckId)) ?? null, [decks, deckId]);
}

export function useDeckEntries(deckId: string): DeckEntryRecord[] | undefined {
  const { decks } = useAppServices();
  return useStorageQuery(() => decks.getEntries(deckId), [decks, deckId]);
}

export function useDeckEntriesForKanji(kanjiId: KanjiId): DeckEntryRecord[] | undefined {
  const { decks } = useAppServices();
  return useStorageQuery(() => decks.getEntriesForKanji(kanjiId), [decks, kanjiId]);
}

export function useCustomKanjiIds(): Set<KanjiId> | undefined {
  const { decks } = useAppServices();
  return useStorageQuery(() => decks.getCustomKanjiIds(), [decks]);
}

export function useBackupStatus(): BackupStatus | undefined {
  const { backup } = useAppServices();
  return useStorageQuery(() => backup.getStatus(), [backup]);
}

/** Whether an account is signed in on this device and how its sync is going. */
export function useSyncStatus(): SyncStatus {
  const { sync } = useAppServices();
  return useSyncExternalStore(sync.subscribe, sync.getStatus);
}
