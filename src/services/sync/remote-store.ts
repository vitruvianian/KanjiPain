/** The kinds of record an account keeps in the cloud, in the order they are uploaded. */
export const SYNC_COLLECTIONS = [
  'sessions',
  'events',
  'issues',
  'cards',
  'decks',
  'settings',
] as const;

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export interface OutgoingRecord {
  readonly collection: SyncCollection;
  readonly id: string;
  readonly data: unknown;
  /** True when the record was deleted; `data` then says when. */
  readonly deleted: boolean;
}

export interface RemoteRecord extends OutgoingRecord {
  /** Position in the account's change log; later changes have higher numbers. */
  readonly seq: number;
}

export interface PullRequest {
  readonly generation: string;
  readonly afterSeq: number;
  /** Changes this device uploaded itself are not sent back to it. */
  readonly excludeDeviceId: string;
  readonly limit: number;
}

export interface PushRequest {
  readonly generation: string;
  readonly deviceId: string;
  readonly records: readonly OutgoingRecord[];
}

/**
 * One account's cloud copy. A "generation" names one continuous history: restoring a backup
 * starts a new one, and devices still on the old one replace their data instead of merging.
 */
export interface RemoteStore {
  getGeneration(): Promise<string | null>;
  /** Sets the generation only if the account has none, and returns the one in force. */
  ensureGeneration(candidate: string): Promise<string>;
  /** Starts a new generation and discards the records of every earlier one. */
  reset(generation: string): Promise<void>;
  /** Changes after `afterSeq`, oldest first, at most `limit` of them. */
  pull(request: PullRequest): Promise<RemoteRecord[]>;
  push(request: PushRequest): Promise<void>;
  /** Removes the account's whole cloud copy. */
  deleteAll(): Promise<void>;
}

export interface SyncUser {
  readonly id: string;
  readonly email: string | null;
}

/** Sign-in plus the signed-in account's cloud copy. */
export interface SyncBackend {
  readonly remote: RemoteStore;
  currentUser(): Promise<SyncUser | null>;
  /** Calls `listener` whenever someone signs in or out. Returns a function that stops it. */
  onUserChange(listener: (user: SyncUser | null) => void): () => void;
  /** Whether this account has been invited to sync. */
  isInvited(): Promise<boolean>;
  signInWithGoogle(): Promise<void>;
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

/** The cloud could not be reached or refused the request. */
export class RemoteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RemoteError';
  }
}
