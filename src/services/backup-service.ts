import type { Clock } from '../domain/clock';
import { MAX_DECK_ENTRIES, MAX_DECKS } from '../domain/deck-import';
import { STANDARD_DECK_ID, type SettingsRecord, type UnixMs } from '../domain/types';
import type { CatalogRepository } from './catalog';
import type { KanjiPainDatabase } from '../storage/database';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupEnvelopeSchema,
  backupEnvelopeV1Schema,
  countBackupRecords,
  type BackupCounts,
  type BackupEnvelope,
} from '../storage/backup-schema';
import { InvalidPersistedDataError, mapStorageError } from '../storage/errors';

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
/** Scheduled reviews after the last backup before the Dojo suggests exporting another. */
export const BACKUP_REMINDER_REVIEWS = 50;
const LAST_EXPORT_KEY = 'backup.lastExportAt';
const REMINDER_DISMISSED_KEY = 'backup.reminderDismissedAt';

/**
 * How current the learner's last backup is. Kept on this device only (the `meta` table),
 * never in a backup file.
 */
export interface BackupStatus {
  /** When this device last exported a backup, or restored one; null if never. */
  readonly lastExportAt: UnixMs | null;
  /** Scheduled reviews since then. */
  readonly reviewsSinceExport: number;
  /** Whether to suggest a backup: enough reviews since the last one or the last reminder. */
  readonly reminderDue: boolean;
}

function metaTime(row: { value: unknown } | undefined): UnixMs | null {
  return typeof row?.value === 'number' && Number.isFinite(row.value) ? row.value : null;
}

export class BackupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class BackupValidationError extends BackupError {}

export class BackupTooLargeError extends BackupValidationError {
  constructor() {
    super('This backup is larger than 25 MiB and cannot be imported.');
  }
}

export class BackupActiveSessionError extends BackupError {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super('Finish or resume the active practice session before exporting or importing a backup.');
    this.name = 'BackupActiveSessionError';
    this.sessionId = sessionId;
  }
}

export interface BackupPreview {
  readonly exportedAt: UnixMs;
  readonly datasetVersion: string;
  readonly datasetVersionMatches: boolean;
  readonly counts: BackupCounts;
  readonly settings: SettingsRecord;
  /** The file's format version. Version 1 files hold no custom decks. */
  readonly version: number;
  /** Cards for characters that are in neither the Standard deck nor a deck in the backup. */
  readonly cardsOutsideDecks: number;
}

export interface BackupServiceDependencies {
  readonly database: KanjiPainDatabase;
  readonly catalog: CatalogRepository;
  readonly clock: Clock;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new BackupValidationError(message);
}

function validateDecks(envelope: BackupEnvelope): void {
  if (envelope.decks.length > MAX_DECKS) {
    invalid(`The backup contains more than ${String(MAX_DECKS)} custom decks.`);
  }
  const entryCounts = new Map<string, number>();
  for (const deck of envelope.decks) {
    if (entryCounts.has(deck.id)) {
      invalid(`The backup contains duplicate deck ID ${deck.id}.`);
    }
    entryCounts.set(deck.id, 0);
  }
  const entryIds = new Set<string>();
  for (const entry of envelope.deckEntries) {
    const count = entryCounts.get(entry.deckId);
    if (count === undefined) {
      invalid(`Deck entry ${entry.id} refers to a missing deck.`);
    }
    if (entryIds.has(entry.id)) {
      invalid(`The backup contains duplicate deck entry ID ${entry.id}.`);
    }
    if ([...entry.meanings, ...entry.readingCues].some((cue) => cue.includes(entry.literal))) {
      invalid(`Deck entry ${entry.id} has a cue that contains its own character.`);
    }
    if (count >= MAX_DECK_ENTRIES) {
      invalid(`Deck ${entry.deckId} holds more than ${String(MAX_DECK_ENTRIES)} characters.`);
    }
    entryIds.add(entry.id);
    entryCounts.set(entry.deckId, count + 1);
  }
}

function validateReferences(envelope: BackupEnvelope): void {
  validateDecks(envelope);
  const cards = new Map<string, BackupEnvelope['cards'][number]>();
  for (const card of envelope.cards) {
    if (cards.has(card.id)) {
      invalid(`The backup contains duplicate card ID ${card.id}.`);
    }
    if (card.id !== `${card.kanjiId}:production`) {
      invalid(`Card ${card.id} does not match its kanji ID.`);
    }
    if (String(card.schedulerState.card.cardId) !== card.id) {
      invalid(`Card ${card.id} contains scheduler state for a different card.`);
    }
    if (card.schedulerState.card.dueAt !== card.dueAt) {
      invalid(`Card ${card.id} has conflicting due dates.`);
    }
    cards.set(card.id, card);
  }

  const sessions = new Map<string, BackupEnvelope['sessions'][number]>();
  for (const session of envelope.sessions) {
    if (sessions.has(session.id)) {
      invalid(`The backup contains duplicate session ID ${session.id}.`);
    }
    if (session.status === 'active') {
      invalid('A backup cannot contain an active session.');
    }
    if (session.endedAt !== null && session.endedAt < session.startedAt) {
      invalid(`Session ${session.id} ends before it starts.`);
    }

    const items = [...session.primaryItems, ...session.rematchItems];
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      invalid(`Session ${session.id} contains duplicate item IDs.`);
    }
    if (new Set(session.completedEventIds).size !== session.completedEventIds.length) {
      invalid(`Session ${session.id} contains duplicate completed event IDs.`);
    }

    for (const item of session.primaryItems) {
      const card = cards.get(item.cardId);
      if ((item.origin === 'due' || item.status === 'done') && card === undefined) {
        invalid(`Session ${session.id} refers to missing card ${item.cardId}.`);
      }
      if (card !== undefined && card.kanjiId !== item.kanjiId) {
        invalid(`Session ${session.id} links a card to the wrong kanji.`);
      }
      if (item.origin === 'due' && item.expectedCardVersion === null) {
        invalid(`Due item ${item.id} has no expected card version.`);
      }
    }
    for (const item of session.rematchItems) {
      if (!cards.has(item.cardId)) {
        invalid(`Session ${session.id} refers to missing rematch card ${item.cardId}.`);
      }
      if (item.expectedCardVersion === null) {
        invalid(`Rematch item ${item.id} has no expected card version.`);
      }
    }
    sessions.set(session.id, session);
  }

  const events = new Map<string, BackupEnvelope['events'][number]>();
  for (const event of envelope.events) {
    if (events.has(event.id)) {
      invalid(`The backup contains duplicate review event ID ${event.id}.`);
    }
    const session = sessions.get(event.sessionId);
    if (session === undefined) {
      invalid(`Review event ${event.id} refers to a missing session.`);
    }
    const card = cards.get(event.cardId);
    if (card === undefined) {
      invalid(`Review event ${event.id} refers to a missing card.`);
    }
    const item = [...session.primaryItems, ...session.rematchItems].find(
      (candidate) => candidate.id === event.itemId,
    );
    if (item?.cardId !== event.cardId) {
      invalid(`Review event ${event.id} does not match a session item for its card.`);
    }
    if (!session.completedEventIds.includes(event.id)) {
      invalid(`Review event ${event.id} is missing from its session's completed events.`);
    }
    if (
      (event.kind === 'scheduled' || event.kind === 'ambiguous') &&
      event.afterVersion !== event.beforeVersion + 1
    ) {
      invalid(`Review event ${event.id} must increment the card version once.`);
    }
    if (event.kind === 'rematch' && event.afterVersion !== event.beforeVersion) {
      invalid(`Rematch event ${event.id} must not change the card version.`);
    }
    if (event.schedulerLog !== null && String(event.schedulerLog.revlog.cardId) !== event.cardId) {
      invalid(`Review event ${event.id} contains a scheduler log for another card.`);
    }
    events.set(event.id, event);
  }

  for (const session of sessions.values()) {
    for (const eventId of session.completedEventIds) {
      const event = events.get(eventId);
      if (event?.sessionId !== session.id) {
        invalid(`Session ${session.id} refers to a missing completed event ${eventId}.`);
      }
    }
  }

  for (const card of cards.values()) {
    if (!sessions.has(card.introducedInSessionId)) {
      invalid(`Card ${card.id} refers to a missing introduction session.`);
    }
  }

  const issueIds = new Set<string>();
  const issueEventIds = new Set<string>();
  for (const issue of envelope.contentIssues) {
    if (issueIds.has(issue.id)) {
      invalid(`The backup contains duplicate content issue ID ${issue.id}.`);
    }
    if (issueEventIds.has(issue.eventId)) {
      invalid(`The backup contains more than one issue for event ${issue.eventId}.`);
    }
    const event = events.get(issue.eventId);
    if (event?.kind !== 'ambiguous' || event.cardId !== issue.cardId) {
      invalid(`Content issue ${issue.id} does not match an ambiguity event.`);
    }
    if (issue.createdAt < event.occurredAt) {
      invalid(`Content issue ${issue.id} predates its event.`);
    }
    issueIds.add(issue.id);
    issueEventIds.add(issue.eventId);
  }
  for (const event of events.values()) {
    if (event.kind === 'ambiguous' && !issueEventIds.has(event.id)) {
      invalid(`Ambiguity event ${event.id} has no content issue record.`);
    }
  }
}

function parseBackupText(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new BackupTooLargeError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new BackupValidationError('This file is not valid JSON.', { cause: error });
  }
}

function assertHeader(value: unknown): void {
  if (!isRecord(value)) {
    invalid('This file does not contain a KanjiPain backup object.');
  }
  if (value.format !== BACKUP_FORMAT) {
    invalid('This file is not a KanjiPain backup.');
  }
  if (value.version !== 1 && value.version !== BACKUP_VERSION) {
    invalid(
      `Backup version ${String(value.version)} is not supported. This app can import versions 1 and ${String(BACKUP_VERSION)}.`,
    );
  }
  if (!isRecord(value.scheduler)) {
    invalid('The backup is missing scheduler compatibility metadata.');
  }
  if (
    value.scheduler.adapterVersion !== 1 ||
    value.scheduler.packageVersion !== '6.0.0' ||
    value.scheduler.model !== 'FSRS-7'
  ) {
    invalid(
      'The backup was created with an unsupported scheduler. This app requires adapter 1, ts-fsrs 6.0.0, and FSRS-7.',
    );
  }
}

interface ParsedBackup {
  readonly envelope: BackupEnvelope;
  readonly preview: BackupPreview;
}

export class BackupService {
  readonly #database: KanjiPainDatabase;
  readonly #catalog: CatalogRepository;
  readonly #clock: Clock;

  constructor({ database, catalog, clock }: BackupServiceDependencies) {
    this.#database = database;
    this.#catalog = catalog;
    this.#clock = clock;
  }

  async createExport(): Promise<BackupEnvelope> {
    try {
      return await this.#database.transaction(
        'r',
        [
          this.#database.cards,
          this.#database.events,
          this.#database.sessions,
          this.#database.settings,
          this.#database.contentIssues,
          this.#database.decks,
          this.#database.deckEntries,
        ],
        async () => {
          const active = await this.#database.sessions.where('status').equals('active').first();
          if (active !== undefined) {
            throw new BackupActiveSessionError(active.id);
          }
          const settings = await this.#database.settings.get('user');
          if (settings === undefined) {
            throw new InvalidPersistedDataError('settings');
          }
          const cards = await this.#database.cards.toArray();
          const events = await this.#database.events.toArray();
          const sessions = (await this.#database.sessions.toArray()).filter(
            (session) => session.status !== 'active',
          );
          const contentIssues = await this.#database.contentIssues.toArray();
          const decks = await this.#database.decks.toArray();
          const deckEntries = await this.#database.deckEntries.toArray();

          const result = backupEnvelopeSchema.safeParse({
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            exportedAt: this.#clock.now(),
            datasetVersion: this.#catalog.manifest.datasetVersion,
            scheduler: {
              adapterVersion: 1,
              packageVersion: '6.0.0',
              model: 'FSRS-7',
            },
            cards: [...cards].sort((left, right) => left.id.localeCompare(right.id)),
            events: [...events].sort(
              (left, right) =>
                left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
            ),
            sessions: [...sessions].sort(
              (left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id),
            ),
            settings,
            contentIssues: [...contentIssues].sort(
              (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
            ),
            decks: [...decks].sort((left, right) => left.id.localeCompare(right.id)),
            deckEntries: [...deckEntries].sort(
              (left, right) =>
                left.deckId.localeCompare(right.deckId) ||
                left.position - right.position ||
                left.id.localeCompare(right.id),
            ),
          });
          if (!result.success) {
            throw new InvalidPersistedDataError('backup export', result.error);
          }
          return result.data;
        },
      );
    } catch (error) {
      if (error instanceof BackupError) {
        throw error;
      }
      throw mapStorageError(error, 'exporting a backup');
    }
  }

  /** Exports a backup and records the time, so the Dojo can say how current backups are. */
  async exportJson(): Promise<string> {
    const envelope = await this.createExport();
    try {
      await this.#database.meta.put({
        key: LAST_EXPORT_KEY,
        version: 1,
        value: envelope.exportedAt,
      });
    } catch {
      // The export itself succeeded; only the reminder bookkeeping is lost.
    }
    return JSON.stringify(envelope, null, 2);
  }

  async getStatus(): Promise<BackupStatus> {
    try {
      return await this.#database.transaction(
        'r',
        this.#database.meta,
        this.#database.events,
        async () => {
          const lastExportAt = metaTime(await this.#database.meta.get(LAST_EXPORT_KEY));
          const dismissedAt = metaTime(await this.#database.meta.get(REMINDER_DISMISSED_KEY));
          const scheduledSince = (since: number) =>
            this.#database.events
              .where('occurredAt')
              .above(since)
              .filter((event) => event.kind === 'scheduled')
              .count();
          const reviewsSinceExport = await scheduledSince(lastExportAt ?? -1);
          const sinceReminder =
            dismissedAt === null || dismissedAt <= (lastExportAt ?? -1)
              ? reviewsSinceExport
              : await scheduledSince(dismissedAt);
          return {
            lastExportAt,
            reviewsSinceExport,
            reminderDue: sinceReminder >= BACKUP_REMINDER_REVIEWS,
          };
        },
      );
    } catch (error) {
      throw mapStorageError(error, 'reading the backup status');
    }
  }

  /** Hides the backup reminder until another round of reviews has been done. */
  async dismissReminder(): Promise<void> {
    try {
      await this.#database.meta.put({
        key: REMINDER_DISMISSED_KEY,
        version: 1,
        value: this.#clock.now(),
      });
    } catch (error) {
      throw mapStorageError(error, 'dismissing the backup reminder');
    }
  }

  async previewImport(text: string): Promise<BackupPreview> {
    try {
      await this.#assertNoActiveSession();
      return this.#parseAndValidate(text).preview;
    } catch (error) {
      if (error instanceof BackupError) {
        throw error;
      }
      throw mapStorageError(error, 'validating a backup');
    }
  }

  async replaceWithImport(text: string): Promise<BackupPreview> {
    let parsed: ParsedBackup;
    try {
      await this.#assertNoActiveSession();
      parsed = this.#parseAndValidate(text);
    } catch (error) {
      if (error instanceof BackupError) {
        throw error;
      }
      throw mapStorageError(error, 'validating a backup');
    }

    try {
      return await this.#database.transaction(
        'rw',
        [
          this.#database.cards,
          this.#database.events,
          this.#database.sessions,
          this.#database.settings,
          this.#database.contentIssues,
          this.#database.decks,
          this.#database.deckEntries,
          this.#database.meta,
        ],
        async () => {
          const active = await this.#database.sessions.where('status').equals('active').first();
          if (active !== undefined) {
            throw new BackupActiveSessionError(active.id);
          }

          // The restored progress is exactly what the file holds, so it is backed up as of
          // the moment the file was made.
          await this.#database.meta.put({
            key: LAST_EXPORT_KEY,
            version: 1,
            value: parsed.envelope.exportedAt,
          });
          await this.#database.meta.delete(REMINDER_DISMISSED_KEY);

          // Custom decks are replaced along with progress. The Standard deck is not stored,
          // so no backup can change it.
          await this.#database.decks.clear();
          await this.#database.deckEntries.clear();
          await this.#database.cards.clear();
          await this.#database.events.clear();
          await this.#database.sessions.clear();
          await this.#database.settings.clear();
          await this.#database.contentIssues.clear();

          await this.#database.settings.put(parsed.envelope.settings);
          if (parsed.envelope.cards.length > 0) {
            await this.#database.cards.bulkAdd([...parsed.envelope.cards]);
          }
          if (parsed.envelope.events.length > 0) {
            await this.#database.events.bulkAdd([...parsed.envelope.events]);
          }
          if (parsed.envelope.sessions.length > 0) {
            await this.#database.sessions.bulkAdd([...parsed.envelope.sessions]);
          }
          if (parsed.envelope.contentIssues.length > 0) {
            await this.#database.contentIssues.bulkAdd([...parsed.envelope.contentIssues]);
          }
          if (parsed.envelope.decks.length > 0) {
            await this.#database.decks.bulkAdd([...parsed.envelope.decks]);
          }
          if (parsed.envelope.deckEntries.length > 0) {
            await this.#database.deckEntries.bulkAdd([...parsed.envelope.deckEntries]);
          }
          return parsed.preview;
        },
      );
    } catch (error) {
      if (error instanceof BackupError) {
        throw error;
      }
      throw mapStorageError(error, 'restoring a backup');
    }
  }

  async #assertNoActiveSession(): Promise<void> {
    const active = await this.#database.sessions.where('status').equals('active').first();
    if (active !== undefined) {
      throw new BackupActiveSessionError(active.id);
    }
  }

  #parseAndValidate(text: string): ParsedBackup {
    const value = parseBackupText(text);
    assertHeader(value);
    const isVersion1 = isRecord(value) && value.version === 1;
    const result = isVersion1
      ? backupEnvelopeV1Schema.safeParse(value)
      : backupEnvelopeSchema.safeParse(value);
    if (!result.success) {
      const issue = result.error.issues[0];
      const location = issue === undefined ? '' : issue.path.join('.');
      invalid(
        issue === undefined
          ? 'The backup contains invalid records.'
          : `The backup is malformed${location === '' ? '' : ` at ${location}`}: ${issue.message}`,
      );
    }
    // A version 1 backup is a version 2 backup without custom decks.
    const data: BackupEnvelope =
      result.data.version === 1
        ? { ...result.data, version: BACKUP_VERSION, decks: [], deckEntries: [] }
        : result.data;
    validateReferences(data);
    const deckIds = new Set(data.decks.map((deck) => deck.id));
    const deckKanjiIds = new Set(data.deckEntries.map((entry) => entry.kanjiId));
    // An active deck that is not in the backup cannot be restored; practice falls back.
    const settings = deckIds.has(data.settings.activeDeckId)
      ? data.settings
      : { ...data.settings, activeDeckId: STANDARD_DECK_ID };
    const envelope = { ...data, settings };
    return {
      envelope,
      preview: Object.freeze({
        exportedAt: envelope.exportedAt,
        datasetVersion: envelope.datasetVersion,
        datasetVersionMatches: envelope.datasetVersion === this.#catalog.manifest.datasetVersion,
        counts: countBackupRecords(envelope),
        settings: Object.freeze({ ...settings }),
        version: isVersion1 ? 1 : BACKUP_VERSION,
        cardsOutsideDecks: envelope.cards.filter(
          (card) =>
            this.#catalog.byId(card.kanjiId) === undefined && !deckKanjiIds.has(card.kanjiId),
        ).length,
      }),
    };
  }
}

export function createBackupService(dependencies: BackupServiceDependencies): BackupService {
  return new BackupService(dependencies);
}
