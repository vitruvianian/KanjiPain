import { useCallback, useEffect, useState } from 'react';

/**
 * Persistent storage asks the browser not to evict this site's IndexedDB under storage
 * pressure. Browsers decide on their own: some grant it silently, some ask, some refuse.
 */
export type PersistenceState = 'persisted' | 'not-persisted' | 'unsupported';

function storageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

export async function readPersistence(): Promise<PersistenceState> {
  const storage = storageManager();
  if (typeof storage?.persisted !== 'function') return 'unsupported';
  try {
    return (await storage.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

export async function requestPersistence(): Promise<PersistenceState> {
  const storage = storageManager();
  if (typeof storage?.persist !== 'function') return 'unsupported';
  try {
    return (await storage.persist()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'not-persisted';
  }
}

export function usePersistence(): {
  readonly state: PersistenceState | undefined;
  readonly request: () => Promise<PersistenceState>;
} {
  const [state, setState] = useState<PersistenceState | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void readPersistence().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);
  const request = useCallback(async () => {
    const next = await requestPersistence();
    setState(next);
    return next;
  }, []);
  return { state, request };
}
