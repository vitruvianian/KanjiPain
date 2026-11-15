import type { Clock } from '../domain/clock';
import type { IdSource } from '../domain/ids';
import { InvalidSessionTransitionError, reduceSession } from '../domain/session-reducer';
import type { RematchSessionItem, SessionRecord } from '../domain/session-types';
import {
  cardRecordSchema,
  contentIssueSchema,
  reviewEventSchema,
  sessionRecordSchema,
} from '../domain/schemas';
import type {
  CardRecord,
  CheckerVerdict,
  ContentIssue,
  Grade,
  ReviewEvent,
  UnixMs,
} from '../domain/types';
import type { SchedulerAdapter } from '../scheduler/types';
import type { KanjiPainDatabase } from '../storage/database';
import {
  InvalidPersistedDataError,
  mapStorageError,
  StaleRevisionError,
  StorageError,
} from '../storage/errors';
import { DraftSaveQueue } from './draft-save-queue';
import { SessionNotFoundError } from './session-service';

export class AttemptIdConflictError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ID ${attemptId} is already attached to different review data.`);
    this.name = 'AttemptIdConflictError';
  }
}

export interface CommitGradeInput {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly expectedRevision: number;
  readonly expectedCardVersion: number;
  readonly grade: Grade;
  /** The handwriting checker's verdict, recorded alongside the learner's grade. */
  readonly checkerVerdict?: CheckerVerdict | undefined;
}

export interface FlagAmbiguousInput {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly expectedRevision: number;
  readonly expectedCardVersion: number;
}

export interface CommitGradeResult {
  readonly session: SessionRecord;
  readonly event: ReviewEvent;
}

export interface FlagAmbiguousResult extends CommitGradeResult {
  readonly issue: ContentIssue;
}

/** When a card would next be due after each possible grade, were it graded at `now`. */
export interface GradePreview {
  readonly now: UnixMs;
  readonly dueAt: Readonly<Record<Grade, UnixMs>>;
}

export interface ReviewServiceDependencies {
  readonly database: KanjiPainDatabase;
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

function parseCard(value: unknown): CardRecord {
  const result = cardRecordSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('card', result.error);
  }
  return result.data;
}

function parseEvent(value: unknown): ReviewEvent {
  const result = reviewEventSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidPersistedDataError('review event', result.error);
  }
  return result.data;
}

function preserveReviewError(error: unknown, operation: string): never {
  if (
    error instanceof StorageError ||
    error instanceof SessionNotFoundError ||
    error instanceof AttemptIdConflictError ||
    error instanceof InvalidSessionTransitionError
  ) {
    throw error;
  }
  throw mapStorageError(error, operation);
}

function assertRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new StaleRevisionError(expected, actual);
  }
}

function activeItem(
  session: SessionRecord,
): { readonly type: 'primary' } | { readonly type: 'rematch'; readonly item: RematchSessionItem } {
  if (session.phase.kind !== 'feedback') {
    throw new InvalidSessionTransitionError('A review requires revealed feedback.');
  }
  const itemId = session.phase.itemId;
  if (session.primaryItems.some((item) => item.id === itemId)) {
    return { type: 'primary' };
  }
  const rematch = session.rematchItems.find((item) => item.id === itemId);
  if (rematch !== undefined) {
    return { type: 'rematch', item: rematch };
  }
  throw new InvalidPersistedDataError('active session item');
}

function assertAttempt(session: SessionRecord, attemptId: string): void {
  if (session.phase.kind !== 'feedback' || session.phase.draft.id !== attemptId) {
    throw new InvalidSessionTransitionError('Attempt does not match the revealed feedback.');
  }
}

function assertIdempotentRequest(
  event: ReviewEvent,
  input: CommitGradeInput | FlagAmbiguousInput,
  session: SessionRecord,
  expectedKind: 'graded' | 'ambiguous',
): void {
  const currentAttemptItem =
    session.phase.kind === 'feedback' && session.phase.draft.id === input.attemptId
      ? session.phase.itemId
      : undefined;
  const kindMatches =
    expectedKind === 'graded' ? event.kind !== 'ambiguous' : event.kind === 'ambiguous';
  if (
    event.sessionId !== input.sessionId ||
    event.beforeVersion !== input.expectedCardVersion ||
    !kindMatches ||
    (currentAttemptItem !== undefined && currentAttemptItem !== event.itemId)
  ) {
    throw new AttemptIdConflictError(input.attemptId);
  }
  if (
    expectedKind === 'graded' &&
    'grade' in input &&
    !event.assisted &&
    event.grade !== input.grade
  ) {
    throw new AttemptIdConflictError(input.attemptId);
  }
}

function retryIdNeeded(item: ReturnType<typeof activeItem>, grade: Grade): boolean {
  return grade === 'missed' && (item.type === 'primary' || item.item.ordinal === 1);
}

export class ReviewService {
  readonly #database: KanjiPainDatabase;
  readonly #scheduler: SchedulerAdapter;
  readonly #clock: Clock;
  readonly #ids: IdSource;
  readonly #draftQueue: DraftSaveQueue;

  constructor({
    database,
    scheduler,
    clock,
    ids,
    draftQueue = new DraftSaveQueue(),
  }: ReviewServiceDependencies) {
    this.#database = database;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#ids = ids;
    this.#draftQueue = draftQueue;
  }

  /**
   * What the scheduler would do with each grade right now, without saving anything. Only a
   * scheduled review moves a card; a rematch leaves its due date alone. Returns null when
   * the scheduler cannot review the card at this time (a device clock set back).
   */
  previewGrades(card: CardRecord): GradePreview | null {
    const now = this.#clock.now();
    const dueAfter = (grade: Grade) =>
      this.#scheduler.review({ card: card.schedulerState, grade, now }).dueAt;
    try {
      return {
        now,
        dueAt: { got: dueAfter('got'), barely: dueAfter('barely'), missed: dueAfter('missed') },
      };
    } catch {
      return null;
    }
  }

  async commitGrade(input: CommitGradeInput): Promise<CommitGradeResult> {
    await this.#draftQueue.flush(input.sessionId);
    const now = this.#clock.now();
    try {
      return await this.#database.transaction(
        'rw',
        this.#database.cards,
        this.#database.events,
        this.#database.sessions,
        this.#database.contentIssues,
        async () => {
          const existingRow = await this.#database.events.get(input.attemptId);
          if (existingRow !== undefined) {
            const existing = parseEvent(existingRow);
            const sessionRow = await this.#database.sessions.get(input.sessionId);
            if (sessionRow === undefined) {
              throw new SessionNotFoundError(input.sessionId);
            }
            const session = parseSession(sessionRow);
            assertIdempotentRequest(existing, input, session, 'graded');
            return { session, event: existing };
          }

          const sessionRow = await this.#database.sessions.get(input.sessionId);
          if (sessionRow === undefined) {
            throw new SessionNotFoundError(input.sessionId);
          }
          const session = parseSession(sessionRow);
          assertRevision(session.revision, input.expectedRevision);
          assertAttempt(session, input.attemptId);
          if (session.phase.kind !== 'feedback') {
            throw new InvalidSessionTransitionError('A review requires revealed feedback.');
          }
          const cardRow = await this.#database.cards.get(session.phase.cardId);
          if (cardRow === undefined) {
            throw new InvalidPersistedDataError('review card');
          }
          const card = parseCard(cardRow);
          assertRevision(card.version, input.expectedCardVersion);
          const item = activeItem(session);
          const assisted =
            session.phase.draft.surrendered || session.phase.draft.hintKeysUsed.length > 0;
          const grade: Grade = assisted ? 'missed' : input.grade;
          const kind = item.type === 'primary' ? 'scheduled' : 'rematch';
          const scheduled =
            kind === 'scheduled'
              ? this.#scheduler.review({ card: card.schedulerState, grade, now })
              : undefined;
          const updatedCard: CardRecord =
            scheduled === undefined
              ? card
              : {
                  ...card,
                  dueAt: scheduled.dueAt,
                  schedulerState: scheduled.card,
                  scheduledReviewCount: card.scheduledReviewCount + 1,
                  version: card.version + 1,
                };
          const reviewEvent = reviewEventSchema.parse({
            id: input.attemptId,
            sessionId: session.id,
            cardId: card.id,
            itemId: session.phase.itemId,
            kind,
            isFirstLearningCheck: kind === 'scheduled' && card.scheduledReviewCount === 0,
            grade,
            assisted,
            hintKeysUsed: [...session.phase.draft.hintKeysUsed],
            inputMode: session.phase.draft.inputMode,
            occurredAt: now,
            durationMs: Math.max(0, now - session.phase.draft.startedAt),
            beforeVersion: card.version,
            afterVersion: updatedCard.version,
            schedulerLog: scheduled?.log ?? null,
            datasetVersion: session.datasetVersion,
            ...(input.checkerVerdict === undefined || session.phase.draft.inputMode !== 'drawing'
              ? {}
              : { checkerVerdict: input.checkerVerdict }),
          });
          const retryItemId = retryIdNeeded(item, grade) ? this.#ids.next() : undefined;
          const updatedSession = reduceSession(session, {
            type: 'commit-grade',
            reviewEvent: reviewEvent as ReviewEvent & { grade: Grade },
            ...(retryItemId === undefined ? {} : { retryItemId }),
          });

          if (scheduled !== undefined) {
            await this.#database.cards.put(updatedCard);
          }
          await this.#database.events.add(reviewEvent);
          await this.#database.sessions.put(updatedSession);
          return { session: updatedSession, event: reviewEvent };
        },
      );
    } catch (error) {
      return preserveReviewError(error, 'committing a review grade');
    }
  }

  async flagAmbiguous(input: FlagAmbiguousInput): Promise<FlagAmbiguousResult> {
    await this.#draftQueue.flush(input.sessionId);
    const now = this.#clock.now();
    try {
      return await this.#database.transaction(
        'rw',
        this.#database.cards,
        this.#database.events,
        this.#database.sessions,
        this.#database.contentIssues,
        async () => {
          const existingRow = await this.#database.events.get(input.attemptId);
          if (existingRow !== undefined) {
            const existing = parseEvent(existingRow);
            const sessionRow = await this.#database.sessions.get(input.sessionId);
            if (sessionRow === undefined) {
              throw new SessionNotFoundError(input.sessionId);
            }
            const session = parseSession(sessionRow);
            assertIdempotentRequest(existing, input, session, 'ambiguous');
            const issueRow = await this.#database.contentIssues
              .filter((issue) => issue.eventId === existing.id)
              .first();
            if (issueRow === undefined) {
              throw new InvalidPersistedDataError('content issue');
            }
            return { session, event: existing, issue: contentIssueSchema.parse(issueRow) };
          }

          const sessionRow = await this.#database.sessions.get(input.sessionId);
          if (sessionRow === undefined) {
            throw new SessionNotFoundError(input.sessionId);
          }
          const session = parseSession(sessionRow);
          assertRevision(session.revision, input.expectedRevision);
          assertAttempt(session, input.attemptId);
          if (session.phase.kind !== 'feedback') {
            throw new InvalidSessionTransitionError('Ambiguity requires revealed feedback.');
          }
          const cardRow = await this.#database.cards.get(session.phase.cardId);
          if (cardRow === undefined) {
            throw new InvalidPersistedDataError('review card');
          }
          const card = parseCard(cardRow);
          assertRevision(card.version, input.expectedCardVersion);
          const assisted =
            session.phase.draft.surrendered || session.phase.draft.hintKeysUsed.length > 0;
          const reviewEvent = reviewEventSchema.parse({
            id: input.attemptId,
            sessionId: session.id,
            cardId: card.id,
            itemId: session.phase.itemId,
            kind: 'ambiguous',
            isFirstLearningCheck: card.scheduledReviewCount === 0,
            grade: null,
            assisted,
            hintKeysUsed: [...session.phase.draft.hintKeysUsed],
            inputMode: session.phase.draft.inputMode,
            occurredAt: now,
            durationMs: Math.max(0, now - session.phase.draft.startedAt),
            beforeVersion: card.version,
            afterVersion: card.version + 1,
            schedulerLog: null,
            datasetVersion: session.datasetVersion,
          }) as ReviewEvent & { kind: 'ambiguous'; grade: null };
          const issue = contentIssueSchema.parse({
            id: this.#ids.next(),
            cardId: card.id,
            eventId: reviewEvent.id,
            reason: 'ambiguous-prompt',
            createdAt: now,
            datasetVersion: session.datasetVersion,
          });
          const pausedCard: CardRecord = {
            ...card,
            suspended: true,
            version: card.version + 1,
          };
          const reduced = reduceSession(session, {
            type: 'skip-ambiguity',
            reviewEvent,
          });
          const updatedSession: SessionRecord = {
            ...reduced,
            rematchItems: reduced.rematchItems.map((item) =>
              item.cardId === card.id && item.status === 'pending'
                ? { ...item, status: 'skipped' }
                : item,
            ),
          };

          await this.#database.cards.put(pausedCard);
          await this.#database.events.add(reviewEvent);
          await this.#database.contentIssues.add(issue);
          await this.#database.sessions.put(updatedSession);
          return { session: updatedSession, event: reviewEvent, issue };
        },
      );
    } catch (error) {
      return preserveReviewError(error, 'flagging an ambiguous prompt');
    }
  }
}

export function createReviewService(dependencies: ReviewServiceDependencies): ReviewService {
  return new ReviewService(dependencies);
}
