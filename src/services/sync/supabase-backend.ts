import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import {
  RemoteError,
  type PullRequest,
  type PushRequest,
  type RemoteRecord,
  type RemoteStore,
  type SyncBackend,
  type SyncCollection,
  type SyncUser,
} from './remote-store';

export interface SupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
  /** Where Google sends the browser back to after sign-in: the app's own address. */
  readonly redirectTo: string;
}

interface RecordRow {
  collection: SyncCollection;
  id: string;
  data: unknown;
  deleted: boolean;
  seq: number;
}

function fail(action: string, error: { message: string }): never {
  throw new RemoteError(`${action}: ${error.message}`);
}

function toUser(user: User | null | undefined): SyncUser | null {
  return user === null || user === undefined ? null : { id: user.id, email: user.email ?? null };
}

/** The account's cloud copy: rows of `sync_records`, guarded on the server per user. */
class SupabaseRemoteStore implements RemoteStore {
  readonly #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  async #userId(): Promise<string> {
    const { data, error } = await this.#client.auth.getSession();
    if (error !== null) fail('Reading the sign-in', error);
    if (data.session === null) {
      throw new RemoteError('You are signed out.');
    }
    return data.session.user.id;
  }

  async getGeneration(): Promise<string | null> {
    const { data, error } = await this.#client
      .from('sync_accounts')
      .select('generation')
      .eq('user_id', await this.#userId())
      .maybeSingle<{ generation: string }>();
    if (error !== null) fail('Reading the cloud copy', error);
    return data?.generation ?? null;
  }

  async ensureGeneration(candidate: string): Promise<string> {
    const { error } = await this.#client
      .from('sync_accounts')
      .upsert(
        { user_id: await this.#userId(), generation: candidate },
        { onConflict: 'user_id', ignoreDuplicates: true },
      );
    if (error !== null) fail('Creating the cloud copy', error);
    const generation = await this.getGeneration();
    if (generation === null) {
      throw new RemoteError('The cloud copy could not be created.');
    }
    return generation;
  }

  async reset(generation: string): Promise<void> {
    const userId = await this.#userId();
    const { error } = await this.#client
      .from('sync_accounts')
      .upsert({ user_id: userId, generation }, { onConflict: 'user_id' });
    if (error !== null) fail('Replacing the cloud copy', error);
    const { error: deleteError } = await this.#client
      .from('sync_records')
      .delete()
      .eq('user_id', userId)
      .neq('generation', generation);
    if (deleteError !== null) fail('Replacing the cloud copy', deleteError);
  }

  async pull({
    generation,
    afterSeq,
    excludeDeviceId,
    limit,
  }: PullRequest): Promise<RemoteRecord[]> {
    const { data, error } = await this.#client
      .from('sync_records')
      .select('collection,id,data,deleted,seq')
      .eq('user_id', await this.#userId())
      .eq('generation', generation)
      .gt('seq', afterSeq)
      .neq('device_id', excludeDeviceId)
      .order('seq', { ascending: true })
      .limit(limit)
      .overrideTypes<RecordRow[], { merge: false }>();
    if (error !== null) fail('Downloading changes', error);
    return data;
  }

  async push({ generation, deviceId, records }: PushRequest): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const userId = await this.#userId();
    const { error } = await this.#client.from('sync_records').upsert(
      records.map((record) => ({
        user_id: userId,
        generation,
        collection: record.collection,
        id: record.id,
        data: record.data,
        deleted: record.deleted,
        device_id: deviceId,
      })),
      { onConflict: 'user_id,generation,collection,id' },
    );
    if (error !== null) fail('Uploading changes', error);
  }

  async deleteAll(): Promise<void> {
    const userId = await this.#userId();
    const { error } = await this.#client.from('sync_records').delete().eq('user_id', userId);
    if (error !== null) fail('Deleting the cloud copy', error);
    const { error: accountError } = await this.#client
      .from('sync_accounts')
      .delete()
      .eq('user_id', userId);
    if (accountError !== null) fail('Deleting the cloud copy', accountError);
  }
}

export function createSupabaseBackend({ url, anonKey, redirectTo }: SupabaseConfig): SyncBackend {
  const client = createClient(url, anonKey, {
    auth: {
      // The sign-in code comes back in the query string, which leaves the hash router alone.
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return {
    remote: new SupabaseRemoteStore(client),

    async currentUser() {
      const { data, error } = await client.auth.getSession();
      if (error !== null) fail('Reading the sign-in', error);
      return toUser(data.session?.user);
    },

    onUserChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        // The library forbids calling back into it from inside this callback.
        setTimeout(() => {
          listener(toUser(session?.user));
        }, 0);
      });
      return () => {
        data.subscription.unsubscribe();
      };
    },

    async isInvited() {
      const response = await client.rpc('sync_allowed');
      if (response.error !== null) fail('Checking the invitation', response.error);
      return (response.data as unknown) === true;
    },

    async signInWithGoogle() {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error !== null) fail('Signing in with Google', error);
    },

    async sendEmailCode(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (error !== null) fail('Sending the sign-in code', error);
    },

    async verifyEmailCode(email, code) {
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error !== null) fail('Checking the sign-in code', error);
    },

    async signOut() {
      // Local scope: other devices stay signed in.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error !== null) fail('Signing out', error);
    },
  };
}
