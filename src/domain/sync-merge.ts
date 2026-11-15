import type { SessionRecord } from './session-types';
import type { CardRecord, ReviewEvent, ReviewPace, UnixMs } from './types';
import type { SchedulerCreateResult } from '../scheduler/types';
import type { SchedulerAdapter } from '../scheduler/types';

/**
 * JSON with object keys in sorted order and absent values left out, so the same record gives
 * the same text however a database or a server happens to order its fields.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return value === undefined ? 'null' : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item !== undefined) {
      parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
    }
  }
  return `{${parts.join(',')}}`;
}

/** A short digest of a record's content. It detects change; it is not a security measure. */
export function fingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b) + index;
  }
  const hex = (part: number) => (part >>> 0).toString(16).padStart(8, '0');
  return `${hex(first)}${hex(second)}${text.length.toString(16)}`;
}

function lastReviewAt(card: CardRecord): UnixMs {
  return card.schedulerState.card.lastReviewAt ?? card.introducedAt;
}

/** The scheduled reviews of one card, oldest first. */
export function scheduledReviews(
  cardId: string,
  events: readonly ReviewEvent[],
): (ReviewEvent & { grade: NonNullable<ReviewEvent['grade']> })[] {
  return events
    .filter(
      (event): event is ReviewEvent & { grade: NonNullable<ReviewEvent['grade']> } =>
        event.cardId === cardId && event.kind === 'scheduled' && event.grade !== null,
    )
    .sort((left, right) => left.occurredAt - right.occurredAt || left.id.localeCompare(right.id));
}

/**
 * A card's schedule worked out from scratch: introduced at `introducedAt`, then every review
 * in order. The memory state depends only on the reviews; the pace decides the final due date.
 */
export function replayReviews(
  cardId: string,
  introducedAt: UnixMs,
  reviews: readonly (ReviewEvent & { grade: NonNullable<ReviewEvent['grade']> })[],
  scheduler: SchedulerAdapter,
  pace: ReviewPace | undefined,
): SchedulerCreateResult {
  const created = scheduler.create({ cardId, now: introducedAt });
  let state = created.card;
  let dueAt = created.dueAt;
  let previous = introducedAt;
  for (const review of reviews) {
    // Two devices' clocks can disagree; a review never counts as earlier than the one before.
    previous = Math.max(previous, review.occurredAt);
    const result = scheduler.review({ card: state, grade: review.grade, now: previous, pace });
    state = result.card;
    dueAt = result.dueAt;
  }
  return { card: state, dueAt };
}

/**
 * The same card with its next review moved to where `pace` puts it, or the card unchanged
 * when it has not been reviewed, is paused, or its history cannot reproduce its schedule.
 * Reviews already done are not reinterpreted: only the date of the next one moves.
 */
export function rescheduleCard(
  card: CardRecord,
  events: readonly ReviewEvent[],
  scheduler: SchedulerAdapter,
  pace: ReviewPace,
): CardRecord {
  const reviews = scheduledReviews(card.id, events);
  if (reviews.length === 0 || reviews.length !== card.scheduledReviewCount) {
    return card;
  }
  const replayed = replayReviews(card.id, card.introducedAt, reviews, scheduler, pace);
  const before = card.schedulerState.card;
  const after = replayed.card.card;
  const sameMemory =
    Math.abs(after.stability - before.stability) <= 1e-9 * Math.max(1, before.stability) &&
    Math.abs(after.difficulty - before.difficulty) <= 1e-9 &&
    after.lastReviewAt === before.lastReviewAt;
  if (!sameMemory || replayed.dueAt === card.dueAt) {
    return card;
  }
  return {
    ...card,
    dueAt: replayed.dueAt,
    schedulerState: replayed.card,
    version: card.version + 1,
  };
}

export interface MergeCardInput {
  /** This device's card; absent when only the other copy exists. */
  readonly local?: CardRecord | undefined;
  /** The other device's card, as the cloud holds it. */
  readonly remote?: CardRecord | undefined;
  /** True when the local card has changed since this device last agreed with the cloud. */
  readonly localChanged: boolean;
  /** Every review of this card known after merging both histories. */
  readonly events: readonly ReviewEvent[];
  readonly scheduler: SchedulerAdapter;
  /** The learner's review pace, which decides the due date a replay ends on. */
  readonly pace?: ReviewPace | undefined;
}

/**
 * Decides what a card is after two devices have both worked on it.
 *
 * Reviews are never lost: they are separate records and both sets are kept. The card's
 * schedule is the part that can disagree. When one copy already reflects every scheduled
 * review, it is used as it is. Otherwise the schedule is worked out again by replaying all
 * scheduled reviews in the order they happened, which gives every device the same answer.
 */
export function mergeCard({
  local,
  remote,
  localChanged,
  events,
  scheduler,
  pace,
}: MergeCardInput): CardRecord | undefined {
  const base = local === undefined || (remote !== undefined && !localChanged) ? remote : local;
  if (base === undefined) {
    return undefined;
  }
  const other = base === local ? remote : local;
  const conflict = local !== undefined && remote !== undefined && localChanged;
  const reviews = scheduledReviews(base.id, events);
  const known = Math.max(local?.scheduledReviewCount ?? 0, remote?.scheduledReviewCount ?? 0);

  if (!conflict && reviews.length <= base.scheduledReviewCount) {
    return base;
  }
  if (reviews.length < known) {
    // Part of the history is missing, so a replay would forget reviews. Keep the copy that
    // was reviewed last.
    const latest = other !== undefined && lastReviewAt(other) > lastReviewAt(base) ? other : base;
    return conflict
      ? { ...latest, suspended: base.suspended || (other?.suspended ?? false) }
      : latest;
  }

  const origin = other !== undefined && other.introducedAt < base.introducedAt ? other : base;
  const scheduled = replayReviews(base.id, origin.introducedAt, reviews, scheduler, pace);

  return {
    id: base.id,
    kanjiId: base.kanjiId,
    skill: base.skill,
    introducedAt: origin.introducedAt,
    introducedLocalDay: origin.introducedLocalDay,
    introducedInSessionId: origin.introducedInSessionId,
    dueAt: scheduled.dueAt,
    schedulerState: scheduled.card,
    scheduledReviewCount: reviews.length,
    // A prompt flagged as ambiguous on either device stays paused until it is resumed.
    suspended: base.suspended || (other?.suspended ?? false),
    version: Math.max(base.version, other?.version ?? 0) + 1,
  };
}

/**
 * How an unfinished session looks to other devices: ended at this point, with the work not
 * yet done left out. The session itself stays open on the device that is running it, and its
 * later revisions replace this one.
 */
export function sessionSnapshot(session: SessionRecord, now: UnixMs): SessionRecord {
  if (session.status !== 'active') {
    return session;
  }
  return {
    ...session,
    status: 'ended',
    endedAt: Math.max(now, session.startedAt),
    primaryItems: session.primaryItems.map((item) =>
      item.status === 'pending' ? { ...item, status: 'skipped' } : item,
    ),
    rematchItems: session.rematchItems.map((item) =>
      item.status === 'pending' ? { ...item, status: 'skipped' } : item,
    ),
    phase: { kind: 'summary' },
  };
}

/**
 * Brings this device's open session in line with cards another device has changed. Planned
 * reviews that are no longer due, or whose prompt is now paused, are dropped; the rest keep
 * going against the card's new version. Returns the same object when nothing applies.
 */
export function reconcileActiveSession(
  session: SessionRecord,
  changedCards: ReadonlyMap<string, CardRecord>,
  now: UnixMs,
): SessionRecord {
  if (session.status !== 'active' || changedCards.size === 0) {
    return session;
  }
  const activeItemId = 'itemId' in session.phase ? session.phase.itemId : undefined;
  const followsSchedule = session.mode === undefined;
  let changed = false;

  const primaryItems = session.primaryItems.map((item) => {
    const card = changedCards.get(item.cardId);
    if (card === undefined || item.status !== 'pending' || item.id === activeItemId) {
      return item;
    }
    changed = true;
    if (card.suspended || (followsSchedule && item.origin === 'due' && card.dueAt > now)) {
      return { ...item, status: 'skipped' as const };
    }
    return {
      ...item,
      expectedCardVersion: item.expectedCardVersion === null ? null : card.version,
    };
  });
  const rematchItems = session.rematchItems.map((item) => {
    const card = changedCards.get(item.cardId);
    if (card === undefined || item.status !== 'pending' || item.id === activeItemId) {
      return item;
    }
    changed = true;
    if (card.suspended) {
      return { ...item, status: 'skipped' as const };
    }
    return {
      ...item,
      expectedCardVersion: item.expectedCardVersion === null ? null : card.version,
    };
  });

  let phase = session.phase;
  if (phase.kind === 'prompt' || phase.kind === 'feedback') {
    const card = changedCards.get(phase.cardId);
    if (card !== undefined && card.version !== phase.expectedCardVersion) {
      changed = true;
      phase = { ...phase, expectedCardVersion: card.version };
    }
  }

  return changed
    ? { ...session, primaryItems, rematchItems, phase, revision: session.revision + 1 }
    : session;
}
