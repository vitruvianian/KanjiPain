import { z } from 'zod';

import type { IdSource } from '../../domain/ids';
import type { KanjiPainDatabase } from '../../storage/database';

export const SYNC_STATE_KEY = 'sync';

const syncStateSchema = z.strictObject({
  /** The account this device's data belongs to; kept after signing out. */
  userId: z.string().min(1).nullable(),
  /** True while that account is signed in on this device. */
  linked: z.boolean(),
  generation: z.string().min(1).nullable(),
  /** How far into the account's change log this device has read. */
  cursor: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
  /** A backup was restored here; the cloud copy has to be replaced, not merged. */
  resetPending: z.boolean(),
  lastSyncedAt: z.number().int().nonnegative().nullable(),
});

export type SyncState = z.infer<typeof syncStateSchema>;

export function initialSyncState(ids: IdSource): SyncState {
  return {
    userId: null,
    linked: false,
    generation: null,
    cursor: 0,
    deviceId: ids.next(),
    resetPending: false,
    lastSyncedAt: null,
  };
}

/** Must run inside a transaction that includes `meta`, or outside any transaction. */
export async function readSyncState(
  database: KanjiPainDatabase,
  ids: IdSource,
): Promise<SyncState> {
  const row = await database.meta.get(SYNC_STATE_KEY);
  const parsed = syncStateSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : initialSyncState(ids);
}

export async function writeSyncState(database: KanjiPainDatabase, state: SyncState): Promise<void> {
  await database.meta.put({ key: SYNC_STATE_KEY, version: 1, value: state });
}

/**
 * Called when a restored backup has replaced all progress. While signed in, the cloud copy is
 * replaced too on the next sync. While signed out, the device forgets what the cloud held, so
 * a later sign-in merges the restored progress instead of treating it as edits.
 *
 * Must run inside a transaction that includes `meta` and `syncShadow`.
 */
export async function noteProgressReplaced(
  database: KanjiPainDatabase,
  ids: IdSource,
): Promise<void> {
  const row = await database.meta.get(SYNC_STATE_KEY);
  if (row === undefined) {
    return;
  }
  const state = await readSyncState(database, ids);
  await database.syncShadow.clear();
  await writeSyncState(
    database,
    state.linked
      ? { ...state, resetPending: true }
      : { ...state, generation: null, cursor: 0, deviceId: ids.next() },
  );
}
