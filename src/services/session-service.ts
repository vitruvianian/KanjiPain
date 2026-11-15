import type { Clock } from '../domain/clock';
import { localDayKey } from '../domain/date';
import type { IdSource } from '../domain/ids';
import { buildPrompt } from '../domain/prompts';
import { chooseNextItem, planSession } from '../domain/queue';
import { InvalidSessionTransitionError, reduceSession } from '../domain/session-reducer';
import type {
  NextItemDecision,
  PrimarySessionItem,
  SessionMode,
  SessionRecord,
} from '../domain/session-types';
import {
  sessionRecordSchema,
  settingsRecordSchema,
  unrevealedAttemptDraftSchema,
} from '../domain/schemas';
import type { InputMode, SettingsRecord, Stroke, UnrevealedAttemptDraft } from '../domain/types';
import type { SchedulerAdapter } from '../scheduler/types';
import type { KanjiPainDatabase } from '../storage/database';
import {
  InvalidPersistedDataError,
  mapStorageError,
  StaleRevisionError,
  StorageError,
} from '../storage/errors';
import type { StorageRepositories } from '../storage/repositories';
import type { CatalogRepository } from './catalog';
import { loadDeckContent, standardDeckContent } from './deck-content';
import { DraftSaveQueue } from './draft-save-queue';

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} does not exist.`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionItemUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionItemUnavailableError';
  }
}

export interface DraftChange {
  readonly strokes?: readonly Stroke[];
  readonly paperAttemptConfirmed?: boolean;
  readonly inputMode?: InputMode;
  readonly practiceStrokes?: readonly Stroke[];
  readonly targetHidden?: boolean;
}

export interface OpenNextItemResult {
  readonly session: SessionRecord;
  readonly decision: NextItemDecision;
}

export interface HintRequestResult {
  readonly session: SessionRecord;
  readonly hintKey: 'mnemonic' | 'component' | 'stroke-count' | 'full-answer';
}

export interface SessionServiceDependencies {
  readonly database: KanjiPainDatabase;
  readonly storage: StorageRepositories;
  readonly catalog: CatalogRepository;
  readonly scheduler: SchedulerAdapter;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly draftQueue?: DraftSaveQueue;
}

function parseSession(value: unknown): SessionRecord {
  const result = sessionRecordSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('session', result.error);
  }
  return result.data;
}

function parseSettings(value: unknown): SettingsRecord {
  const result = settingsRecordSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('settings', result.error);
  }
  return result.data;
}

function preserveServiceError(error: unknown, operation: string): never {
  if (
    error instanceof StorageError ||
    error instanceof SessionNotFoundError ||
    error instanceof SessionItemUnavailableError ||
    error instanceof InvalidSessionTransitionError
  ) {
    throw error;
  }
  throw mapStorageError(error, operation);
}

function assertRevision(session: SessionRecord, expectedRevision: number): void {
  if (session.revision !== expectedRevision) {
    throw new StaleRevisionError(expectedRevision, session.revision);
  }
}

function createDraft(
  itemId: string,
  inputMode: InputMode,
  now: number,
  ids: IdSource,
): UnrevealedAttemptDraft {
  return {
    id: ids.next(),
    itemId,
    startedAt: now,
    inputMode,
    strokes: [],
    paperAttemptConfirmed: false,
    hintKeysUsed: [],
    surrendered: false,
    revealedAt: null,
  };
}

function locatePrimary(session: SessionRecord, itemId: string): PrimarySessionItem | undefined {
  return session.primaryItems.find((item) => item.id === itemId);
}

function cloneStrokes(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map((stroke) => stroke.map((point) => ({ ...point })));
}

export class SessionService {
  readonly #database: KanjiPainDatabase;
  readonly #storage: StorageRepositories;
  readonly #catalog: CatalogRepository;
  readonly #scheduler: SchedulerAdapter;
  readonly #clock: Clock;
  readonly #ids: IdSource;
  readonly #draftQueue: DraftSaveQueue;

  constructor({
    database,
    storage,
    catalog,
    scheduler,
    clock,
    ids,
    draftQueue = new DraftSaveQueue(),
  }: SessionServiceDependencies) {
    this.#database = database;
    this.#storage = storage;
    this.#catalog = catalog;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#ids = ids;
    this.#draftQueue = draftQueue;
  }

  get draftQueue(): DraftSaveQueue {
    return this.#draftQueue;
  }

  getSession(sessionId: string): Promise<SessionRecord | undefined> {
    return this.#storage.getSession(sessionId);
  }

  /**
   * Resumes the active session, or starts one in `mode`. An active session always wins, so
   * asking for an extra session while one is open resumes that one instead.
   */
  async startOrResumeSession(mode: SessionMode = 'regular'): Promise<SessionRecord> {
    const now = this.#clock.now();
    try {
      return await this.#database.transaction(
        'rw',
        this.#database.sessions,
        this.#database.cards,
        this.#database.settings,
        this.#database.decks,
        this.#database.deckEntries,
        async () => {
          const activeRows = await this.#database.sessions
            .where('status')
            .equals('active')
            .toArray();
          if (activeRows.length > 1) {
            throw new InvalidPersistedDataError('sessions');
          }

          const activeRow = activeRows[0];
          if (activeRow !== undefined) {
            const active = parseSession(activeRow);
            // A session keeps the deck it started with, even if another deck is active now.
            const deckExists =
              (await loadDeckContent(this.#database, this.#catalog, active.deckId)) !== undefined;
            if (active.datasetVersion === this.#catalog.manifest.datasetVersion && deckExists) {
              return active;
            }
            const obsolete = reduceSession(active, {
              type: 'finish',
              endedAt: Math.max(now, active.startedAt),
            });
            await this.#database.sessions.put(obsolete);
          }

          const settings = parseSettings(await this.#database.settings.get('user'));
          const content =
            (await loadDeckContent(this.#database, this.#catalog, settings.activeDeckId)) ??
            standardDeckContent(this.#catalog);
          const cards = await this.#database.cards.toArray();
          const day = localDayKey(now);
          const introducedToday = await this.#database.cards
            .where('introducedLocalDay')
            .equals(day)
            .count();
          const plan = planSession({
            cards,
            catalog: content.practicable,
            settings,
            introducedToday,
            now,
            mode,
            lookalikes: (id) => this.#catalog.lookalikes(id),
          });
          let created: SessionRecord = {
            id: this.#ids.next(),
            status: 'active',
            revision: 0,
            startedAt: now,
            endedAt: null,
            startedLocalDay: day,
            datasetVersion: this.#catalog.manifest.datasetVersion,
            primaryLimit: 20,
            primaryItems: plan.primaryItems.map((item) => ({ ...item })),
            rematchItems: [],
            phase: { kind: 'selecting' },
            completedEventIds: [],
            ...(mode === 'regular' ? {} : { mode }),
            ...(content.deck.kind === 'standard'
              ? {}
              : { deckId: content.deck.id, deckRevision: content.deck.revision }),
          };
          if (created.primaryItems.length === 0) {
            created = reduceSession(created, { type: 'complete', endedAt: now });
          }
          const validated = sessionRecordSchema.parse(created);
          await this.#database.sessions.add(validated);
          return validated;
        },
      );
    } catch (error) {
      return preserveServiceError(error, 'starting a practice session');
    }
  }

  async openNextItem(
    sessionId: string,
    expectedRevision: number,
    acceptShortRematch = false,
  ): Promise<OpenNextItemResult> {
    await this.#draftQueue.flush(sessionId);
    const now = this.#clock.now();

    try {
      return await this.#database.transaction(
        'rw',
        this.#database.sessions,
        this.#database.cards,
        this.#database.settings,
        async () => {
          const row = await this.#database.sessions.get(sessionId);
          if (row === undefined) {
            throw new SessionNotFoundError(sessionId);
          }
          let session = parseSession(row);
          assertRevision(session, expectedRevision);
          const settings = await this.#database.settings.get('user');
          if (settings === undefined) {
            throw new InvalidPersistedDataError('settings');
          }

          for (;;) {
            const decision = chooseNextItem(session);
            if (decision.kind === 'complete') {
              session = reduceSession(session, { type: 'complete', endedAt: now });
              await this.#database.sessions.put(session);
              return { session, decision };
            }
            if (decision.kind === 'short-rematch-offer' && !acceptShortRematch) {
              return { session, decision };
            }

            const itemId = decision.itemId;
            const primary = locatePrimary(session, itemId);
            const cardId =
              primary?.cardId ?? session.rematchItems.find((item) => item.id === itemId)?.cardId;
            if (cardId === undefined) {
              throw new SessionItemUnavailableError(`Session item ${itemId} is unavailable.`);
            }
            let card = await this.#database.cards.get(cardId);

            if (primary?.origin === 'new' && card === undefined) {
              const day = localDayKey(now);
              const introductionCount = await this.#database.cards
                .where('introducedLocalDay')
                .equals(day)
                .count();
              // Extra sessions exist to go past the daily limit.
              if (session.mode !== 'extra-new' && introductionCount >= settings.dailyNewLimit) {
                session = reduceSession(session, { type: 'skip-item', itemId });
                continue;
              }

              const scheduled = this.#scheduler.create({ cardId, now });
              card = {
                id: cardId,
                kanjiId: primary.kanjiId,
                skill: 'production',
                introducedAt: now,
                introducedLocalDay: day,
                introducedInSessionId: session.id,
                dueAt: scheduled.dueAt,
                schedulerState: scheduled.card,
                scheduledReviewCount: 0,
                suspended: false,
                version: 0,
              };
              await this.#database.cards.add(card);
            }

            if (card === undefined) {
              throw new SessionItemUnavailableError(`Card ${cardId} is unavailable.`);
            }
            if (
              primary?.expectedCardVersion !== null &&
              primary?.expectedCardVersion !== undefined &&
              card.version !== primary.expectedCardVersion
            ) {
              throw new StaleRevisionError(primary.expectedCardVersion, card.version);
            }
            if (card.suspended) {
              throw new SessionItemUnavailableError(`Card ${cardId} is paused.`);
            }

            const selection =
              decision.kind === 'short-rematch-offer' ? 'short-rematch' : 'automatic';
            if (primary !== undefined && card.scheduledReviewCount === 0) {
              session = reduceSession(session, {
                type: 'open-item',
                itemId,
                selection,
                target: { kind: 'introduction' },
              });
            } else {
              session = reduceSession(session, {
                type: 'open-item',
                itemId,
                selection,
                target: {
                  kind: 'prompt',
                  expectedCardVersion: card.version,
                  draft: createDraft(itemId, settings.inputMode, now, this.#ids),
                },
              });
            }
            await this.#database.sessions.put(session);
            return { session, decision };
          }
        },
      );
    } catch (error) {
      return preserveServiceError(error, 'opening the next practice item');
    }
  }

  async hideIntroduction(sessionId: string, expectedRevision: number): Promise<SessionRecord> {
    await this.#draftQueue.flush(sessionId);
    const now = this.#clock.now();
    try {
      return await this.#database.transaction(
        'rw',
        this.#database.sessions,
        this.#database.cards,
        this.#database.settings,
        async () => {
          const row = await this.#database.sessions.get(sessionId);
          if (row === undefined) {
            throw new SessionNotFoundError(sessionId);
          }
          const session = parseSession(row);
          assertRevision(session, expectedRevision);
          if (session.phase.kind !== 'introduction') {
            throw new InvalidSessionTransitionError('No introduction is currently open.');
          }
          const card = await this.#database.cards.get(session.phase.cardId);
          const settings = await this.#database.settings.get('user');
          if (card === undefined || settings === undefined) {
            throw new InvalidPersistedDataError('introduction');
          }
          const updated = reduceSession(session, {
            type: 'hide-introduction',
            expectedCardVersion: card.version,
            draft: createDraft(session.phase.itemId, settings.inputMode, now, this.#ids),
          });
          await this.#database.sessions.put(updated);
          return updated;
        },
      );
    } catch (error) {
      return preserveServiceError(error, 'hiding a character introduction');
    }
  }

  saveDraft(
    sessionId: string,
    expectedRevision: number,
    draftChange: DraftChange,
  ): Promise<SessionRecord> {
    return this.#draftQueue.enqueue(sessionId, async () => {
      try {
        return await this.#database.transaction('rw', this.#database.sessions, async () => {
          const row = await this.#database.sessions.get(sessionId);
          if (row === undefined) {
            throw new SessionNotFoundError(sessionId);
          }
          const session = parseSession(row);
          assertRevision(session, expectedRevision);
          if (session.phase.kind === 'repair') {
            if (
              draftChange.strokes !== undefined ||
              draftChange.paperAttemptConfirmed !== undefined ||
              draftChange.inputMode !== undefined
            ) {
              throw new InvalidSessionTransitionError(
                'Attempt fields cannot be edited during repair practice.',
              );
            }
            const updated = reduceSession(session, {
              type: 'update-repair',
              targetHidden: draftChange.targetHidden ?? session.phase.targetHidden,
              practiceStrokes: draftChange.practiceStrokes ?? session.phase.practiceStrokes,
            });
            await this.#database.sessions.put(updated);
            return updated;
          }
          if (session.phase.kind !== 'prompt') {
            throw new InvalidSessionTransitionError(
              'Only an active prompt or repair has an editable draft.',
            );
          }
          if (draftChange.practiceStrokes !== undefined || draftChange.targetHidden !== undefined) {
            throw new InvalidSessionTransitionError(
              'Repair fields cannot be edited during a recall attempt.',
            );
          }
          const merged = unrevealedAttemptDraftSchema.parse({
            ...session.phase.draft,
            ...(draftChange.strokes === undefined
              ? {}
              : { strokes: cloneStrokes(draftChange.strokes) }),
            ...(draftChange.paperAttemptConfirmed === undefined
              ? {}
              : { paperAttemptConfirmed: draftChange.paperAttemptConfirmed }),
            ...(draftChange.inputMode === undefined ? {} : { inputMode: draftChange.inputMode }),
          });
          const updated = reduceSession(session, { type: 'save-draft', draft: merged });
          await this.#database.sessions.put(updated);
          return updated;
        });
      } catch (error) {
        return preserveServiceError(error, 'saving an attempt draft');
      }
    });
  }

  requestHint(sessionId: string, expectedRevision: number): Promise<HintRequestResult> {
    return this.#draftQueue.enqueue(sessionId, async () => {
      const now = this.#clock.now();
      try {
        return await this.#database.transaction(
          'rw',
          this.#database.sessions,
          this.#database.cards,
          this.#database.decks,
          this.#database.deckEntries,
          async () => {
            const row = await this.#database.sessions.get(sessionId);
            if (row === undefined) {
              throw new SessionNotFoundError(sessionId);
            }
            let session = parseSession(row);
            assertRevision(session, expectedRevision);
            if (session.phase.kind !== 'prompt') {
              throw new InvalidSessionTransitionError('Hints require an active prompt.');
            }
            const promptPhase = session.phase;
            const card = await this.#database.cards.get(promptPhase.cardId);
            const content = await loadDeckContent(this.#database, this.#catalog, session.deckId);
            const entry = card === undefined ? undefined : content?.byId(card.kanjiId);
            if (card === undefined || content === undefined || entry === undefined) {
              throw new InvalidPersistedDataError('prompt card');
            }
            const prompt = buildPrompt(entry, content.noteFor(entry.id));
            const available = [...prompt.hints.map((hint) => hint.key), 'full-answer' as const];
            const hintKey = available.find(
              (candidate) => !promptPhase.draft.hintKeysUsed.includes(candidate),
            );
            if (hintKey === undefined) {
              throw new InvalidSessionTransitionError('No further hint is available.');
            }
            const draft = unrevealedAttemptDraftSchema.parse({
              ...promptPhase.draft,
              hintKeysUsed: [...promptPhase.draft.hintKeysUsed, hintKey],
            });
            session = reduceSession(session, { type: 'save-draft', draft });
            if (hintKey === 'full-answer') {
              session = reduceSession(session, {
                type: 'reveal',
                reason: 'surrender',
                revealedAt: now,
              });
            }
            await this.#database.sessions.put(session);
            return { session, hintKey };
          },
        );
      } catch (error) {
        return preserveServiceError(error, 'saving a requested hint');
      }
    });
  }

  async revealAnswer(
    sessionId: string,
    expectedRevision: number,
    reason: 'compare' | 'surrender',
  ): Promise<SessionRecord> {
    await this.#draftQueue.flush(sessionId);
    const now = this.#clock.now();
    try {
      return await this.#database.transaction('rw', this.#database.sessions, async () => {
        const row = await this.#database.sessions.get(sessionId);
        if (row === undefined) {
          throw new SessionNotFoundError(sessionId);
        }
        const session = parseSession(row);
        assertRevision(session, expectedRevision);
        const updated = reduceSession(session, { type: 'reveal', reason, revealedAt: now });
        await this.#database.sessions.put(updated);
        return updated;
      });
    } catch (error) {
      return preserveServiceError(error, 'revealing an answer');
    }
  }

  async finishRepair(sessionId: string, expectedRevision: number): Promise<SessionRecord> {
    await this.#draftQueue.flush(sessionId);
    try {
      return await this.#database.transaction('rw', this.#database.sessions, async () => {
        const row = await this.#database.sessions.get(sessionId);
        if (row === undefined) {
          throw new SessionNotFoundError(sessionId);
        }
        const session = parseSession(row);
        assertRevision(session, expectedRevision);
        const updated = reduceSession(session, { type: 'complete-repair' });
        await this.#database.sessions.put(updated);
        return updated;
      });
    } catch (error) {
      return preserveServiceError(error, 'finishing repair practice');
    }
  }

  async finishSession(sessionId: string, expectedRevision: number): Promise<SessionRecord> {
    await this.#draftQueue.flush(sessionId);
    const now = this.#clock.now();
    try {
      return await this.#database.transaction('rw', this.#database.sessions, async () => {
        const row = await this.#database.sessions.get(sessionId);
        if (row === undefined) {
          throw new SessionNotFoundError(sessionId);
        }
        const session = parseSession(row);
        assertRevision(session, expectedRevision);
        const updated = reduceSession(session, {
          type: 'finish',
          endedAt: Math.max(now, session.startedAt),
        });
        await this.#database.sessions.put(updated);
        return updated;
      });
    } catch (error) {
      return preserveServiceError(error, 'finishing a practice session');
    }
  }
}

export function createSessionService(dependencies: SessionServiceDependencies): SessionService {
  return new SessionService(dependencies);
}
