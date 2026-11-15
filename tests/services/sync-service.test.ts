import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { systemClock } from '../../src/domain/clock';
import { systemIdSource } from '../../src/domain/ids';
import { initializeFsrsAdapter } from '../../src/scheduler/fsrs-adapter';
import { MemoryRemoteStore } from '../../src/services/sync/memory-remote';
import type { SyncBackend, SyncUser } from '../../src/services/sync/remote-store';
import { createSyncEngine } from '../../src/services/sync/sync-engine';
import { createSyncService, type SyncService } from '../../src/services/sync/sync-service';
import { createDatabase, initializeDatabase } from '../../src/storage/database';

const opened: { readonly name: string; readonly database: Dexie; readonly sync: SyncService }[] =
  [];

afterEach(async () => {
  for (const item of opened.splice(0)) {
    item.sync.stop();
    item.database.close();
    await Dexie.delete(item.name);
  }
});

function fakeBackend(cloud: MemoryRemoteStore, invited = true) {
  let user: SyncUser | null = null;
  const listeners = new Set<(user: SyncUser | null) => void>();
  const setUser = (next: SyncUser | null) => {
    user = next;
    for (const listener of listeners) listener(next);
  };
  const backend: SyncBackend = {
    remote: cloud,
    currentUser: () => Promise.resolve(user),
    onUserChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isInvited: () => Promise.resolve(invited),
    signInWithGoogle: () => Promise.resolve(),
    sendEmailCode: () => Promise.resolve(),
    verifyEmailCode(email) {
      setUser({ id: `user:${email}`, email });
      return Promise.resolve();
    },
    signOut() {
      setUser(null);
      return Promise.resolve();
    },
  };
  return backend;
}

async function startService(cloud: MemoryRemoteStore, backend: SyncBackend | null) {
  const name = `sync-service-${crypto.randomUUID()}`;
  const database = createDatabase(name);
  await initializeDatabase(database);
  const engine = createSyncEngine({
    database,
    scheduler: await initializeFsrsAdapter(),
    clock: systemClock,
    ids: systemIdSource,
  });
  const sync = createSyncService({
    database,
    engine,
    loadBackend: backend === null ? null : () => Promise.resolve(backend),
    debounceMs: 10,
  });
  opened.push({ name, database, sync });
  await sync.start();
  return { database, sync, cloud };
}

describe('sync service', () => {
  it('stays out of the way when no sync server is configured', async () => {
    const { sync } = await startService(new MemoryRemoteStore(), null);
    expect(sync.getStatus()).toEqual({ kind: 'unavailable' });
  });

  it('signs in with an email code, syncs, and uploads later changes by itself', async () => {
    const cloud = new MemoryRemoteStore();
    const { database, sync } = await startService(cloud, fakeBackend(cloud));
    expect(sync.getStatus()).toEqual({ kind: 'signed-out' });

    await sync.verifyEmailCode(' learner@example.com ', '123456');
    await vi.waitFor(() => {
      expect(sync.getStatus()).toMatchObject({
        kind: 'signed-in',
        email: 'learner@example.com',
        activity: 'idle',
      });
      expect(cloud.count('settings')).toBe(1);
    });

    await database.settings.update('user', { dailyNewLimit: 3 });
    await vi.waitFor(async () => {
      const [record] = await cloud.pull({
        generation: (await cloud.getGeneration()) ?? '',
        afterSeq: 0,
        excludeDeviceId: 'nobody',
        limit: 10,
      });
      expect(record?.data).toMatchObject({ dailyNewLimit: 3 });
    });
    await vi.waitFor(() => {
      expect(sync.getStatus()).toMatchObject({ activity: 'idle' });
    });
    expect(sync.getStatus()).not.toHaveProperty('error');
  });

  it('does not sync an account that was not invited', async () => {
    const cloud = new MemoryRemoteStore();
    const { sync } = await startService(cloud, fakeBackend(cloud, false));
    await sync.verifyEmailCode('stranger@example.com', '123456');

    expect(sync.getStatus()).toEqual({ kind: 'not-invited', email: 'stranger@example.com' });
    expect(cloud.count('settings')).toBe(0);
  });

  it('asks before using a device that holds another account’s progress', async () => {
    const cloud = new MemoryRemoteStore();
    const { sync } = await startService(cloud, fakeBackend(cloud));
    await sync.verifyEmailCode('first@example.com', '123456');
    await sync.syncNow();
    await sync.signOut();
    expect(sync.getStatus()).toEqual({ kind: 'signed-out' });

    await sync.verifyEmailCode('second@example.com', '123456');
    expect(sync.getStatus()).toEqual({ kind: 'other-account', email: 'second@example.com' });

    await sync.replaceLocalData();
    expect(sync.getStatus()).toMatchObject({ kind: 'signed-in', email: 'second@example.com' });
  });

  it('deletes the cloud copy and signs out, keeping local data', async () => {
    const cloud = new MemoryRemoteStore();
    const { database, sync } = await startService(cloud, fakeBackend(cloud));
    await sync.verifyEmailCode('learner@example.com', '123456');
    await sync.syncNow();

    await sync.deleteCloudCopy();
    expect(sync.getStatus()).toEqual({ kind: 'signed-out' });
    await expect(cloud.getGeneration()).resolves.toBeNull();
    await expect(database.settings.get('user')).resolves.toBeDefined();
  });

  it('reports a failed sync and recovers on the next one', async () => {
    const cloud = new MemoryRemoteStore();
    const { sync } = await startService(cloud, fakeBackend(cloud));
    const pull = vi.spyOn(cloud, 'pull').mockRejectedValueOnce(new Error('Server is down.'));
    await sync.verifyEmailCode('learner@example.com', '123456');
    await sync.syncNow();
    await vi.waitFor(() => {
      expect(pull).toHaveBeenCalled();
      expect(sync.getStatus()).toMatchObject({ activity: 'idle' });
    });
    await sync.syncNow();
    await vi.waitFor(() => {
      expect(sync.getStatus()).toMatchObject({ kind: 'signed-in', activity: 'idle' });
      expect(sync.getStatus()).not.toHaveProperty('error');
    });
  });
});
