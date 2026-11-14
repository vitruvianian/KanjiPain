import type { Clock } from '../domain/clock';
import type { SettingsRecord, UnixMs } from '../domain/types';
import type { CatalogRepository } from './catalog';
import type { KanjiPainDatabase } from '../storage/database';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupEnvelopeSchema,
  countBackupRecords,
  type BackupCounts,
  type BackupEnvelopeV1,
} from '../storage/backup-schema';
import { InvalidPersistedDataError, mapStorageError } from '../storage/errors';

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

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

function validateReferences(envelope: BackupEnvelopeV1, catalog: CatalogRepository): void {
  const cards = new Map<string, BackupEnvelopeV1['cards'][number]>();
  for (const card of envelope.cards) {
    if (cards.has(card.id)) {
      invalid(`The backup contains duplicate card ID ${card.id}.`);
    }
    if (card.id !== `${card.kanjiId}:production`) {
      invalid(`Card ${card.id} does not match its kanji ID.`);
    }
    if (catalog.byId(card.kanjiId) === undefined) {
      invalid(`Card ${card.id} refers to a character outside the current catalog.`);
    }
    if (String(card.schedulerState.card.cardId) !== card.id) {
      invalid(`Card ${card.id} contains scheduler state for a different card.`);
    }
    if (card.schedulerState.card.dueAt !== card.dueAt) {
      invalid(`Card ${card.id} has conflicting due dates.`);
    }
    cards.set(card.id, card);
  }

  const sessions = new Map<string, BackupEnvelopeV1['sessions'][number]>();
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

  const events = new Map<string, BackupEnvelopeV1['events'][number]>();
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
  if (value.version !== BACKUP_VERSION) {
    invalid(
      `Backup version ${String(value.version)} is not supported. This app can import version 1 only.`,
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
  readonly envelope: BackupEnvelopeV1;
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

  async createExport(): Promise<BackupEnvelopeV1> {
    try {
      return await this.#database.transaction(
        'r',
        this.#database.cards,
        this.#database.events,
        this.#database.sessions,
        this.#database.settings,
        this.#database.contentIssues,
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

  async exportJson(): Promise<string> {
    return JSON.stringify(await this.createExport(), null, 2);
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
        this.#database.cards,
        this.#database.events,
        this.#database.sessions,
        this.#database.settings,
        this.#database.contentIssues,
        async () => {
          const active = await this.#database.sessions.where('status').equals('active').first();
          if (active !== undefined) {
            throw new BackupActiveSessionError(active.id);
          }

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
    const result = backupEnvelopeSchema.safeParse(value);
    if (!result.success) {
      const issue = result.error.issues[0];
      const location = issue === undefined ? '' : issue.path.join('.');
      invalid(
        issue === undefined
          ? 'The backup contains invalid records.'
          : `The backup is malformed${location === '' ? '' : ` at ${location}`}: ${issue.message}`,
      );
    }
    validateReferences(result.data, this.#catalog);
    return {
      envelope: result.data,
      preview: Object.freeze({
        exportedAt: result.data.exportedAt,
        datasetVersion: result.data.datasetVersion,
        datasetVersionMatches: result.data.datasetVersion === this.#catalog.manifest.datasetVersion,
        counts: countBackupRecords(result.data),
        settings: Object.freeze({ ...result.data.settings }),
      }),
    };
  }
}

export function createBackupService(dependencies: BackupServiceDependencies): BackupService {
  return new BackupService(dependencies);
}
