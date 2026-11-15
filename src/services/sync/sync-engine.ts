import { z } from 'zod';

import type { Clock } from '../../domain/clock';
import { MAX_DECK_ENTRIES } from '../../domain/deck-import';
import type { IdSource } from '../../domain/ids';
import {
  cardRecordSchema,
  contentIssueSchema,
  deckEntryRecordSchema,
  deckRecordSchema,
  reviewEventSchema,
  sessionRecordSchema,
  settingsRecordSchema,
  unixMsSchema,
} from '../../domain/schemas';
import { reduceSession } from '../../domain/session-reducer';
import type { SessionRecord } from '../../domain/session-types';
import {
  fingerprint,
  mergeCard,
  reconcileActiveSession,
  sessionSnapshot,
} from '../../domain/sync-merge';
import {
  REVIEW_PACES,
  STANDARD_DECK_ID,
  type CardRecord,
  type ContentIssue,
  type DeckEntryRecord,
  type DeckRecord,
  type ReviewEvent,
  type SettingsRecord,
  type SyncShadowRecord,
  type UnixMs,
} from '../../domain/types';
import type { SchedulerAdapter } from '../../scheduler/types';
import type { KanjiPainDatabase } from '../../storage/database';
import {
  RemoteError,
  SYNC_COLLECTIONS,
  type OutgoingRecord,
  type RemoteRecord,
  type RemoteStore,
  type SyncCollection,
} from './remote-store';
import { initialSyncState, readSyncState, writeSyncState, type SyncState } from './sync-state';

const PULL_PAGE = 1000;
const PUSH_BATCH = 200;
const DECK_PUSH_BATCH = 5;
/** Shadow fingerprints for records that never change once written. */
const UNCHANGING = '1';
const SESSION_FINAL = 'final';
/** Shadow fingerprint meaning "the cloud says this deck was deleted". */
const DELETED = 'deleted';

/** The cloud copy was deleted from another device; this one keeps its data and signs out. */
export class CloudCopyDeletedError extends Error {
  constructor() {
    super('The cloud copy of this account was deleted.');
    this.name = 'CloudCopyDeletedError';
  }
}

/** The cloud holds a record this version of the app cannot read. */
export class RemoteDataError extends Error {
  constructor(collection: string, id: string, options?: ErrorOptions) {
    super(
      `The cloud copy holds a ${collection} record (${id}) this version of KanjiPain cannot read. Update the app on every device and try again.`,
      options,
    );
    this.name = 'RemoteDataError';
  }
}

export interface SyncResult {
  readonly pulled: number;
  readonly pushed: number;
  /** True when this device's data was replaced because a backup was restored elsewhere. */
  readonly replaced: boolean;
}

export interface SyncEngineDependencies {
  readonly database: KanjiPainDatabase;
  readonly scheduler: SchedulerAdapter;
  readonly clock: Clock;
  readonly ids: IdSource;
}

interface DeckBundle {
  readonly deck: DeckRecord;
  readonly entries: DeckEntryRecord[];
}

const deckBundleSchema = z
  .strictObject({
    deck: deckRecordSchema,
    entries: z.array(deckEntryRecordSchema).max(MAX_DECK_ENTRIES),
  })
  .refine((bundle) => bundle.entries.every((entry) => entry.deckId === bundle.deck.id), {
    message: 'Deck entries belong to another deck.',
  });
const tombstoneSchema = z.strictObject({ deletedAt: unixMsSchema });
const syncedSettingsSchema = settingsRecordSchema
  .pick({
    dailyNewLimit: true,
    onboardingCompleted: true,
    activeDeckId: true,
  })
  // Absent when written by a version of the app from before the pace could be chosen; this
  // device then keeps its own pace instead of falling back to the old one.
  .extend({ reviewPace: z.enum(REVIEW_PACES).optional() });
type SyncedSettings = z.infer<typeof syncedSettingsSchema>;

type RemoteDeck =
  | { readonly id: string; readonly deleted: true; readonly deletedAt: UnixMs }
  | { readonly id: string; readonly deleted: false; readonly bundle: DeckBundle };

interface ParsedPull {
  readonly count: number;
  readonly cursor: number;
  readonly sessions: SessionRecord[];
  readonly events: ReviewEvent[];
  readonly issues: ContentIssue[];
  readonly cards: CardRecord[];
  readonly decks: RemoteDeck[];
  readonly settings: SyncedSettings | undefined;
}

interface PendingUpload {
  readonly record: OutgoingRecord;
  /** What the shadow becomes once the upload succeeds; null removes the shadow entry. */
  readonly shadow: string | null;
}

function shadowKey(collection: SyncCollection, id: string): string {
  return `${collection}/${id}`;
}

function sortedBundle(deck: DeckRecord, entries: readonly DeckEntryRecord[]): DeckBundle {
  return { deck, entries: [...entries].sort((left, right) => left.id.localeCompare(right.id)) };
}

function syncedSettings(settings: SettingsRecord): SyncedSettings {
  return {
    dailyNewLimit: settings.dailyNewLimit,
    onboardingCompleted: settings.onboardingCompleted,
    activeDeckId: settings.activeDeckId,
    reviewPace: settings.reviewPace,
  };
}

function parseRecord<T>(schema: z.ZodType<T>, record: RemoteRecord, withId = true): T {
  const result = schema.safeParse(record.data);
  if (
    !result.success ||
    (withId && (result.data as { id?: unknown }).id !== record.id) ||
    record.deleted
  ) {
    throw new RemoteDataError(record.collection, record.id, {
      cause: result.success ? undefined : result.error,
    });
  }
  return result.data;
}

function parsePull(records: readonly RemoteRecord[], cursor: number): ParsedPull {
  // A record changed while the pages were being read shows up twice; the later one counts.
  const latest = new Map<string, RemoteRecord>();
  for (const record of records) {
    latest.set(shadowKey(record.collection, record.id), record);
  }
  const pull = {
    count: latest.size,
    cursor: records.reduce((highest, record) => Math.max(highest, record.seq), cursor),
    sessions: [] as SessionRecord[],
    events: [] as ReviewEvent[],
    issues: [] as ContentIssue[],
    cards: [] as CardRecord[],
    decks: [] as RemoteDeck[],
    settings: undefined as SyncedSettings | undefined,
  };
  for (const record of latest.values()) {
    switch (record.collection) {
      case 'sessions': {
        const session = parseRecord(sessionRecordSchema, record);
        if (session.status === 'active') {
          throw new RemoteDataError(record.collection, record.id);
        }
        pull.sessions.push(session);
        break;
      }
      case 'events':
        pull.events.push(parseRecord(reviewEventSchema, record));
        break;
      case 'issues':
        pull.issues.push(parseRecord(contentIssueSchema, record));
        break;
      case 'cards':
        pull.cards.push(parseRecord(cardRecordSchema, record));
        break;
      case 'decks':
        if (record.deleted) {
          const tombstone = tombstoneSchema.safeParse(record.data);
          if (!tombstone.success) {
            throw new RemoteDataError(record.collection, record.id, { cause: tombstone.error });
          }
          pull.decks.push({ id: record.id, deleted: true, deletedAt: tombstone.data.deletedAt });
        } else {
          const bundle = parseRecord(deckBundleSchema, record, false);
          if (bundle.deck.id !== record.id) {
            throw new RemoteDataError(record.collection, record.id);
          }
          pull.decks.push({
            id: record.id,
            deleted: false,
            bundle: sortedBundle(bundle.deck, bundle.entries),
          });
        }
        break;
      case 'settings':
        pull.settings = parseRecord(syncedSettingsSchema, record, false);
        break;
      default:
        // A kind of record added by a newer version of the app.
        throw new RemoteDataError(String(record.collection), record.id);
    }
  }
  return pull;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

/**
 * Keeps this device's database and an account's cloud copy in step. The database stays the
 * source of truth for the app: practice never waits for this, and it runs whenever there is
 * a connection.
 *
 * One round reads everything other devices have changed, merges it in one transaction, and
 * then uploads whatever differs from what the cloud is known to hold.
 */
export class SyncEngine {
  readonly #database: KanjiPainDatabase;
  readonly #scheduler: SchedulerAdapter;
  readonly #clock: Clock;
  readonly #ids: IdSource;

  constructor({ database, scheduler, clock, ids }: SyncEngineDependencies) {
    this.#database = database;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#ids = ids;
  }

  get #syncedTables() {
    const database = this.#database;
    return [
      database.cards,
      database.events,
      database.sessions,
      database.settings,
      database.contentIssues,
      database.decks,
      database.deckEntries,
      database.syncShadow,
      database.meta,
    ];
  }

  readState(): Promise<SyncState> {
    return readSyncState(this.#database, this.#ids);
  }

  async #updateState(change: (state: SyncState) => SyncState): Promise<SyncState> {
    return this.#database.transaction('rw', this.#database.meta, async () => {
      const next = change(await this.readState());
      await writeSyncState(this.#database, next);
      return next;
    });
  }

  /**
   * Attaches this device to a signed-in account. Returns false, changing nothing, when the
   * device already holds another account's data; `replaceLocalData` resolves that.
   */
  async link(userId: string): Promise<boolean> {
    return this.#database.transaction('rw', this.#database.meta, async () => {
      const state = await this.readState();
      if (state.userId !== null && state.userId !== userId) {
        return false;
      }
      await writeSyncState(this.#database, { ...state, userId, linked: true });
      return true;
    });
  }

  /** Signing out: the data stays on the device and stops being uploaded. */
  async unlink(): Promise<void> {
    await this.#updateState((state) => ({ ...state, linked: false }));
  }

  /** Forgets the account altogether, so the data on this device belongs to nobody. */
  async forgetAccount(): Promise<void> {
    await this.#database.transaction(
      'rw',
      this.#database.meta,
      this.#database.syncShadow,
      async () => {
        await this.#database.syncShadow.clear();
        await writeSyncState(this.#database, initialSyncState(this.#ids));
      },
    );
  }

  /** Discards this device's progress and decks and attaches it to `userId` instead. */
  async replaceLocalData(userId: string): Promise<void> {
    await this.#database.transaction('rw', this.#syncedTables, async () => {
      await this.#wipe();
      await writeSyncState(this.#database, {
        ...initialSyncState(this.#ids),
        userId,
        linked: true,
      });
    });
  }

  /** Must run inside a transaction over the synced tables. */
  async #wipe(): Promise<void> {
    const database = this.#database;
    await Promise.all([
      database.cards.clear(),
      database.events.clear(),
      database.sessions.clear(),
      database.contentIssues.clear(),
      database.decks.clear(),
      database.deckEntries.clear(),
      database.syncShadow.clear(),
    ]);
    const settings = await database.settings.get('user');
    if (settings !== undefined && settings.activeDeckId !== STANDARD_DECK_ID) {
      await database.settings.put({ ...settings, activeDeckId: STANDARD_DECK_ID });
    }
  }

  /** One full round against the signed-in account's cloud copy. */
  async sync(remote: RemoteStore): Promise<SyncResult> {
    let state = await this.readState();
    if (!state.linked) {
      throw new Error('Sync requires a signed-in account.');
    }
    let replaced = false;
    let pulled = 0;

    if (state.resetPending) {
      // A backup was restored here: the cloud copy becomes exactly what this device holds.
      const generation = this.#ids.next();
      await remote.reset(generation);
      state = await this.#database.transaction(
        'rw',
        this.#database.meta,
        this.#database.syncShadow,
        async () => {
          await this.#database.syncShadow.clear();
          const next: SyncState = {
            ...(await this.readState()),
            generation,
            cursor: 0,
            deviceId: this.#ids.next(),
            resetPending: false,
          };
          await writeSyncState(this.#database, next);
          return next;
        },
      );
    } else {
      const remoteGeneration = await remote.getGeneration();
      if (remoteGeneration === null) {
        if (state.generation !== null) {
          throw new CloudCopyDeletedError();
        }
        const generation = await remote.ensureGeneration(this.#ids.next());
        state = await this.#updateState((current) => ({ ...current, generation }));
      } else if (state.generation === null) {
        // First sync on this device: whatever it already holds is merged into the account.
        state = await this.#updateState((current) => ({
          ...current,
          generation: remoteGeneration,
          cursor: 0,
        }));
      } else if (state.generation !== remoteGeneration) {
        // A backup was restored on another device. That replaces progress everywhere.
        state = await this.#database.transaction('rw', this.#syncedTables, async () => {
          await this.#wipe();
          const next: SyncState = {
            ...(await this.readState()),
            generation: remoteGeneration,
            cursor: 0,
            deviceId: this.#ids.next(),
          };
          await writeSyncState(this.#database, next);
          return next;
        });
        replaced = true;
      }

      const generation = state.generation;
      if (generation === null) {
        throw new RemoteError('The account has no cloud copy to read.');
      }
      const records: RemoteRecord[] = [];
      let afterSeq = state.cursor;
      for (;;) {
        const page = await remote.pull({
          generation,
          afterSeq,
          excludeDeviceId: state.deviceId,
          limit: PULL_PAGE,
        });
        records.push(...page);
        afterSeq = page.reduce((highest, record) => Math.max(highest, record.seq), afterSeq);
        if (page.length < PULL_PAGE) {
          break;
        }
      }
      const pull = parsePull(records, state.cursor);
      pulled = pull.count;
      if (pull.count > 0) {
        await this.#apply(pull);
      }
    }

    const generation = state.generation;
    if (generation === null) {
      throw new RemoteError('The account has no cloud copy to write.');
    }
    const pending = await this.#pendingUploads();
    for (const collection of SYNC_COLLECTIONS) {
      const uploads = pending.filter((upload) => upload.record.collection === collection);
      const size = collection === 'decks' ? DECK_PUSH_BATCH : PUSH_BATCH;
      for (const batch of chunks(uploads, size)) {
        await remote.push({
          generation,
          deviceId: state.deviceId,
          records: batch.map((upload) => upload.record),
        });
        await this.#recordUploaded(batch);
      }
    }

    await this.#updateState((current) => ({ ...current, lastSyncedAt: this.#clock.now() }));
    return { pulled, pushed: pending.length, replaced };
  }

  async #recordUploaded(batch: readonly PendingUpload[]): Promise<void> {
    const puts: SyncShadowRecord[] = [];
    const deletes: string[] = [];
    for (const { record, shadow } of batch) {
      const key = shadowKey(record.collection, record.id);
      if (shadow === null) {
        deletes.push(key);
      } else {
        puts.push({ key, fingerprint: shadow });
      }
    }
    await this.#database.transaction('rw', this.#database.syncShadow, async () => {
      await this.#database.syncShadow.bulkPut(puts);
      await this.#database.syncShadow.bulkDelete(deletes);
    });
  }

  /** Everything on this device that differs from what the cloud is known to hold. */
  async #pendingUploads(): Promise<PendingUpload[]> {
    const database = this.#database;
    const now = this.#clock.now();
    return database.transaction('r', this.#syncedTables, async () => {
      const shadow = new Map(
        (await database.syncShadow.toArray()).map((row) => [row.key, row.fingerprint]),
      );
      const uploads: PendingUpload[] = [];
      const add = (collection: SyncCollection, id: string, data: unknown, mark: string) => {
        uploads.push({ record: { collection, id, data, deleted: false }, shadow: mark });
      };

      const sessionIds = (await database.sessions.toCollection().primaryKeys()).filter(
        (id) => shadow.get(shadowKey('sessions', id)) !== SESSION_FINAL,
      );
      for (const session of await database.sessions.bulkGet(sessionIds)) {
        if (session === undefined) continue;
        const mark =
          session.status === 'active' ? `active:${String(session.revision)}` : SESSION_FINAL;
        if (shadow.get(shadowKey('sessions', session.id)) !== mark) {
          add('sessions', session.id, sessionSnapshot(session, now), mark);
        }
      }

      const eventIds = (await database.events.toCollection().primaryKeys()).filter(
        (id) => !shadow.has(shadowKey('events', id)),
      );
      for (const event of await database.events.bulkGet(eventIds)) {
        if (event !== undefined) add('events', event.id, event, UNCHANGING);
      }

      const issueIds = (await database.contentIssues.toCollection().primaryKeys()).filter(
        (id) => !shadow.has(shadowKey('issues', id)),
      );
      for (const issue of await database.contentIssues.bulkGet(issueIds)) {
        if (issue !== undefined) add('issues', issue.id, issue, UNCHANGING);
      }

      for (const card of await database.cards.toArray()) {
        const mark = fingerprint(card);
        if (shadow.get(shadowKey('cards', card.id)) !== mark) {
          add('cards', card.id, card, mark);
        }
      }

      const decks = await database.decks.toArray();
      const entriesByDeck = new Map<string, DeckEntryRecord[]>();
      for (const entry of await database.deckEntries.toArray()) {
        const list = entriesByDeck.get(entry.deckId);
        if (list === undefined) {
          entriesByDeck.set(entry.deckId, [entry]);
        } else {
          list.push(entry);
        }
      }
      const deckIds = new Set<string>();
      for (const deck of decks) {
        deckIds.add(deck.id);
        const bundle = sortedBundle(deck, entriesByDeck.get(deck.id) ?? []);
        const mark = fingerprint(bundle);
        if (shadow.get(shadowKey('decks', deck.id)) !== mark) {
          add('decks', deck.id, bundle, mark);
        }
      }
      // A deck the cloud holds and this device no longer has was deleted here.
      const deckPrefix = shadowKey('decks', '');
      for (const [key, mark] of shadow) {
        const id = key.slice(deckPrefix.length);
        if (key.startsWith(deckPrefix) && !deckIds.has(id)) {
          if (mark === DELETED) {
            continue;
          }
          uploads.push({
            record: { collection: 'decks', id, data: { deletedAt: now }, deleted: true },
            shadow: DELETED,
          });
        }
      }

      const settings = await database.settings.get('user');
      if (settings !== undefined) {
        const data = syncedSettings(settings);
        const mark = fingerprint(data);
        if (shadow.get(shadowKey('settings', 'user')) !== mark) {
          add('settings', 'user', data, mark);
        }
      }
      return uploads;
    });
  }

  /** Merges other devices' changes into this one, all or nothing. */
  async #apply(pull: ParsedPull): Promise<void> {
    const database = this.#database;
    const now = this.#clock.now();
    await database.transaction('rw', this.#syncedTables, async () => {
      const shadowPuts = new Map<string, string>();
      const shadowDeletes: string[] = [];

      // Sessions, reviews and issues are only ever added; a session's later revision
      // replaces the earlier one.
      const localSessions = await database.sessions.bulkGet(pull.sessions.map(({ id }) => id));
      const sessionPuts: SessionRecord[] = [];
      pull.sessions.forEach((remote, index) => {
        const local = localSessions[index];
        if (local?.status === 'active') {
          return;
        }
        if (local === undefined || remote.revision > local.revision) {
          sessionPuts.push(remote);
        }
        if (local === undefined || remote.revision >= local.revision) {
          shadowPuts.set(shadowKey('sessions', remote.id), SESSION_FINAL);
        }
      });
      await database.sessions.bulkPut(sessionPuts);

      const knownEvents = await database.events.bulkGet(pull.events.map(({ id }) => id));
      await database.events.bulkPut(
        pull.events.filter((_, index) => knownEvents[index] === undefined),
      );
      for (const event of pull.events) {
        shadowPuts.set(shadowKey('events', event.id), UNCHANGING);
      }

      const knownIssues = await database.contentIssues.bulkGet(pull.issues.map(({ id }) => id));
      await database.contentIssues.bulkPut(
        pull.issues.filter((_, index) => knownIssues[index] === undefined),
      );
      for (const issue of pull.issues) {
        shadowPuts.set(shadowKey('issues', issue.id), UNCHANGING);
      }

      // Cards: every card another device changed, and every card that gained a review.
      const remoteCards = new Map(pull.cards.map((card) => [card.id, card]));
      const affected = new Set(remoteCards.keys());
      for (const event of pull.events) {
        if (event.kind === 'scheduled') {
          affected.add(event.cardId);
        }
      }
      const affectedIds = [...affected];
      const localCards = await database.cards.bulkGet(affectedIds);
      const cardShadows = await database.syncShadow.bulkGet(
        affectedIds.map((id) => shadowKey('cards', id)),
      );
      const reviewsByCard = new Map<string, ReviewEvent[]>();
      if (affectedIds.length > 0) {
        for (const event of await database.events.where('cardId').anyOf(affectedIds).toArray()) {
          const list = reviewsByCard.get(event.cardId);
          if (list === undefined) {
            reviewsByCard.set(event.cardId, [event]);
          } else {
            list.push(event);
          }
        }
      }
      const pace = pull.settings?.reviewPace ?? (await database.settings.get('user'))?.reviewPace;
      const changedCards = new Map<string, CardRecord>();
      affectedIds.forEach((id, index) => {
        const local = localCards[index];
        const remote = remoteCards.get(id);
        const localMark = local === undefined ? undefined : fingerprint(local);
        const merged = mergeCard({
          local,
          remote,
          localChanged: local !== undefined && cardShadows[index]?.fingerprint !== localMark,
          events: reviewsByCard.get(id) ?? [],
          scheduler: this.#scheduler,
          pace,
        });
        if (remote !== undefined) {
          shadowPuts.set(shadowKey('cards', id), fingerprint(remote));
        }
        if (merged !== undefined && fingerprint(merged) !== localMark) {
          changedCards.set(id, merged);
        }
      });
      await database.cards.bulkPut([...changedCards.values()]);

      // Decks: a deck and its characters travel together, and the later change wins.
      const touchedDecks = new Set<string>();
      for (const remote of pull.decks) {
        const key = shadowKey('decks', remote.id);
        const local = await database.decks.get(remote.id);
        const localEntries =
          local === undefined
            ? []
            : await database.deckEntries.where('deckId').equals(remote.id).toArray();
        const localMark =
          local === undefined ? undefined : fingerprint(sortedBundle(local, localEntries));
        const known = (await database.syncShadow.get(key))?.fingerprint;
        const localChanged = local !== undefined && known !== localMark;

        if (remote.deleted) {
          if (local === undefined) {
            shadowDeletes.push(key);
          } else if (!localChanged || remote.deletedAt >= local.updatedAt) {
            await database.deckEntries.where('deckId').equals(remote.id).delete();
            await database.decks.delete(remote.id);
            shadowDeletes.push(key);
            touchedDecks.add(remote.id);
          } else {
            shadowPuts.set(key, DELETED);
          }
          continue;
        }

        const remoteMark = fingerprint(remote.bundle);
        shadowPuts.set(key, remoteMark);
        if (
          local === undefined ||
          (localMark !== remoteMark &&
            (!localChanged || remote.bundle.deck.updatedAt >= local.updatedAt))
        ) {
          await database.deckEntries.where('deckId').equals(remote.id).delete();
          await database.decks.put(remote.bundle.deck);
          await database.deckEntries.bulkPut(remote.bundle.entries);
          touchedDecks.add(remote.id);
        }
      }

      // Settings: the account's choice replaces this device's.
      const settings = await database.settings.get('user');
      if (settings !== undefined) {
        let next: SettingsRecord = settings;
        if (pull.settings !== undefined) {
          shadowPuts.set(shadowKey('settings', 'user'), fingerprint(pull.settings));
          next = {
            ...settings,
            ...pull.settings,
            reviewPace: pull.settings.reviewPace ?? settings.reviewPace,
          };
        }
        if (
          next.activeDeckId !== STANDARD_DECK_ID &&
          (await database.decks.get(next.activeDeckId)) === undefined
        ) {
          next = { ...next, activeDeckId: STANDARD_DECK_ID };
        }
        if (fingerprint(next) !== fingerprint(settings)) {
          await database.settings.put(next);
        }
      }

      // A session open on this device carries on, minus the work another device already did.
      const active = await database.sessions.where('status').equals('active').first();
      if (active !== undefined) {
        const next =
          active.deckId !== undefined && touchedDecks.has(active.deckId)
            ? reduceSession(active, { type: 'finish', endedAt: Math.max(now, active.startedAt) })
            : reconcileActiveSession(active, changedCards, now);
        if (next !== active) {
          await database.sessions.put(next);
        }
      }

      await database.syncShadow.bulkPut(
        [...shadowPuts].map(([key, mark]) => ({ key, fingerprint: mark })),
      );
      await database.syncShadow.bulkDelete(shadowDeletes);
      const state = await this.readState();
      await writeSyncState(database, { ...state, cursor: Math.max(state.cursor, pull.cursor) });
    });
  }
}

export function createSyncEngine(dependencies: SyncEngineDependencies): SyncEngine {
  return new SyncEngine(dependencies);
}
