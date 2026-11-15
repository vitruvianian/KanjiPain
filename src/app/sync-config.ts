import type { SyncBackend } from '../services/sync/remote-store';

const url: unknown = import.meta.env.VITE_SUPABASE_URL;
const anonKey: unknown = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Account sync is on only in builds that were given a sync server (see README, "Accounts
 * and sync"). The client library loads on demand, so builds without one never download it.
 */
export const configuredSyncBackend: (() => Promise<SyncBackend>) | null =
  typeof url === 'string' && url !== '' && typeof anonKey === 'string' && anonKey !== ''
    ? async () => {
        const { createSupabaseBackend } = await import('../services/sync/supabase-backend');
        return createSupabaseBackend({
          url,
          anonKey,
          redirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
        });
      }
    : null;
