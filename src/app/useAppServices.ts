import { useLiveQuery } from 'dexie-react-hooks';
import { useContext } from 'react';

import type { SessionRecord, SessionStatus } from '../domain/session-types';
import type {
  CardRecord,
  ContentIssue,
  ReviewEvent,
  SettingsRecord,
  UnixMs,
} from '../domain/types';
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
