import Dexie from 'dexie';

import type { KanjiPainDatabase } from '../../storage/database';
import { RemoteError, type SyncBackend, type SyncUser } from './remote-store';
import { CloudCopyDeletedError, type SyncEngine } from './sync-engine';

export type SyncStatus =
  /** This copy of the app was built without a sync server. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed-out'; readonly notice?: string | undefined }
  /** Signed in, but the account is not on the invitation list. */
  | { readonly kind: 'not-invited'; readonly email: string | null }
  /** Signed in, but this device holds another account's progress. */
  | { readonly kind: 'other-account'; readonly email: string | null }
  | {
      readonly kind: 'signed-in';
      readonly email: string | null;
      readonly activity: 'idle' | 'syncing';
      readonly lastSyncedAt: number | null;
      /** Why the last attempt failed; absent after a successful one. */
      readonly error?: string | undefined;
    };

export interface SyncServiceDependencies {
  readonly database: KanjiPainDatabase;
  readonly engine: SyncEngine;
  /** Loads sign-in and the cloud client; null when no sync server is configured. */
  readonly loadBackend: (() => Promise<SyncBackend>) | null;
  /** How long to wait after a local change before uploading it. */
  readonly debounceMs?: number;
}

const LOCAL_ONLY_TABLES = new Set(['meta', 'syncShadow']);

function describeFailure(error: unknown): string {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'You are offline. Changes will sync when the connection returns.';
  }
  if (error instanceof Error && error.message !== '') {
    return error.message;
  }
  return 'Sync failed. It will be tried again.';
}

/**
 * Sign-in and background sync. Practice never calls this and never waits for it: it watches
 * the database and uploads after the fact.
 */
export class SyncService {
  readonly #database: KanjiPainDatabase;
  readonly #engine: SyncEngine;
  readonly #loadBackend: (() => Promise<SyncBackend>) | null;
  readonly #debounceMs: number;
  readonly #listeners = new Set<() => void>();
  readonly #cleanups: (() => void)[] = [];
  #status: SyncStatus;
  #backend: SyncBackend | undefined;
  #user: SyncUser | null = null;
  #running: Promise<void> | undefined;
  #again = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #userQueue: Promise<void> = Promise.resolve();

  constructor({ database, engine, loadBackend, debounceMs = 2_000 }: SyncServiceDependencies) {
    this.#database = database;
    this.#engine = engine;
    this.#loadBackend = loadBackend;
    this.#debounceMs = debounceMs;
    this.#status = loadBackend === null ? { kind: 'unavailable' } : { kind: 'loading' };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getStatus = (): SyncStatus => this.#status;

  #setStatus(status: SyncStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  /** Restores a saved sign-in and starts watching for changes. Safe to call once. */
  async start(): Promise<void> {
    if (this.#started || this.#loadBackend === null) {
      return;
    }
    this.#started = true;
    try {
      const backend = await this.#loadBackend();
      if (this.#stopped()) {
        return;
      }
      this.#backend = backend;
      this.#cleanups.push(
        backend.onUserChange((user) => {
          void this.#userChanged(user);
        }),
      );
      await this.#userChanged(await backend.currentUser());
    } catch (error) {
      this.#setStatus({ kind: 'signed-out', notice: describeFailure(error) });
      return;
    }

    const onMutation = (parts: Record<string, unknown>) => {
      const prefix = `idb://${this.#database.name}/`;
      const relevant = Object.keys(parts).some((part) => {
        if (!part.startsWith(prefix)) return false;
        const table = part.slice(prefix.length).split('/')[0] ?? '';
        return !LOCAL_ONLY_TABLES.has(table);
      });
      if (relevant) {
        this.requestSync();
      }
    };
    Dexie.on('storagemutated', onMutation);
    this.#cleanups.push(() => {
      Dexie.on('storagemutated').unsubscribe(onMutation);
    });

    if (typeof window !== 'undefined') {
      const wake = () => {
        if (document.visibilityState === 'visible') {
          this.requestSync(0);
        }
      };
      window.addEventListener('online', wake);
      document.addEventListener('visibilitychange', wake);
      this.#cleanups.push(() => {
        window.removeEventListener('online', wake);
        document.removeEventListener('visibilitychange', wake);
      });
    }
  }

  /** `stop()` may run while `start()` is still waiting for the backend to load. */
  #stopped(): boolean {
    return !this.#started;
  }

  stop(): void {
    this.#started = false;
    clearTimeout(this.#timer);
    for (const cleanup of this.#cleanups.splice(0)) {
      cleanup();
    }
  }

  /** Sign-in changes arrive from several places; they are handled one at a time, in order. */
  #userChanged(user: SyncUser | null): Promise<void> {
    const run = this.#userQueue.then(() => this.#applyUser(user));
    this.#userQueue = run.catch(() => undefined);
    return run;
  }

  async #applyUser(user: SyncUser | null): Promise<void> {
    const backend = this.#backend;
    if (backend === undefined) {
      return;
    }
    if (user === null) {
      const wasSignedIn = this.#user !== null;
      this.#user = null;
      if (wasSignedIn) {
        await this.#engine.unlink();
      }
      if (this.#status.kind !== 'signed-out') {
        this.#setStatus({ kind: 'signed-out' });
      }
      return;
    }
    if (this.#user?.id === user.id && this.#status.kind !== 'loading') {
      return;
    }
    this.#user = user;
    try {
      if (!(await backend.isInvited())) {
        this.#setStatus({ kind: 'not-invited', email: user.email });
        return;
      }
      if (!(await this.#engine.link(user.id))) {
        this.#setStatus({ kind: 'other-account', email: user.email });
        return;
      }
      const state = await this.#engine.readState();
      this.#setStatus({
        kind: 'signed-in',
        email: user.email,
        activity: 'idle',
        lastSyncedAt: state.lastSyncedAt,
      });
      this.requestSync(0);
    } catch (error) {
      this.#setStatus({
        kind: 'signed-in',
        email: user.email,
        activity: 'idle',
        lastSyncedAt: null,
        error: describeFailure(error),
      });
    }
  }

  /** Asks for a sync soon. Calls close together are folded into one. */
  requestSync(delayMs = this.#debounceMs): void {
    if (this.#status.kind !== 'signed-in') {
      return;
    }
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.syncNow();
    }, delayMs);
  }

  /** Syncs now and resolves when it has finished, whether or not it succeeded. */
  syncNow(): Promise<void> {
    if (this.#running !== undefined) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#runExclusive().finally(() => {
      this.#running = undefined;
      if (this.#again) {
        this.#again = false;
        this.requestSync();
      }
    });
    return this.#running;
  }

  async #runExclusive(): Promise<void> {
    // Two tabs of the app share one database; only one of them syncs at a time.
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      await navigator.locks.request(`kanjipain-sync:${this.#database.name}`, () => this.#run());
      return;
    }
    await this.#run();
  }

  async #run(): Promise<void> {
    const backend = this.#backend;
    const status = this.#status;
    if (backend === undefined || status.kind !== 'signed-in') {
      return;
    }
    this.#setStatus({ ...status, activity: 'syncing' });
    try {
      await this.#engine.sync(backend.remote);
      const state = await this.#engine.readState();
      if (this.#status.kind === 'signed-in') {
        this.#setStatus({
          kind: 'signed-in',
          email: status.email,
          activity: 'idle',
          lastSyncedAt: state.lastSyncedAt,
        });
      }
    } catch (error) {
      if (error instanceof CloudCopyDeletedError) {
        await this.#engine.forgetAccount();
        this.#user = null;
        await backend.signOut().catch(() => undefined);
        this.#setStatus({
          kind: 'signed-out',
          notice:
            'The cloud copy of this account was deleted from another device. Your progress is still on this device.',
        });
        return;
      }
      if (this.#status.kind === 'signed-in') {
        this.#setStatus({
          kind: 'signed-in',
          email: status.email,
          activity: 'idle',
          lastSyncedAt: status.lastSyncedAt,
          error: describeFailure(error),
        });
      }
    }
  }

  #requireBackend(): SyncBackend {
    if (this.#backend === undefined) {
      throw new RemoteError('Sync is not available right now.');
    }
    return this.#backend;
  }

  signInWithGoogle(): Promise<void> {
    return this.#requireBackend().signInWithGoogle();
  }

  sendEmailCode(email: string): Promise<void> {
    return this.#requireBackend().sendEmailCode(email.trim());
  }

  async verifyEmailCode(email: string, code: string): Promise<void> {
    const backend = this.#requireBackend();
    await backend.verifyEmailCode(email.trim(), code.trim());
    await this.#userChanged(await backend.currentUser());
  }

  /** Signs out. Progress stays on this device and is no longer uploaded. */
  async signOut(): Promise<void> {
    const backend = this.#requireBackend();
    clearTimeout(this.#timer);
    await this.#running?.catch(() => undefined);
    await backend.signOut();
    await this.#userChanged(null);
  }

  /**
   * For a device that holds another account's progress: discards it and downloads the
   * signed-in account's instead.
   */
  async replaceLocalData(): Promise<void> {
    const user = this.#user;
    if (user === null || this.#status.kind !== 'other-account') {
      return;
    }
    await this.#engine.replaceLocalData(user.id);
    this.#setStatus({ kind: 'signed-in', email: user.email, activity: 'idle', lastSyncedAt: null });
    await this.syncNow();
  }

  /** Deletes the account's cloud copy and signs out. This device keeps its progress. */
  async deleteCloudCopy(): Promise<void> {
    const backend = this.#requireBackend();
    clearTimeout(this.#timer);
    await this.#running?.catch(() => undefined);
    await backend.remote.deleteAll();
    await this.#engine.forgetAccount();
    this.#user = null;
    await backend.signOut().catch(() => undefined);
    this.#setStatus({ kind: 'signed-out' });
  }
}

export function createSyncService(dependencies: SyncServiceDependencies): SyncService {
  return new SyncService(dependencies);
}
