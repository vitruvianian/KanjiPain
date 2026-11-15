import type {
  NextItemDecision,
  PlanSessionInput,
  PrimarySessionItem,
  SessionPlan,
  SessionRecord,
} from './session-types';
import type { CardRecord, KanjiId, StudyEntry } from './types';

export const PRIMARY_SESSION_LIMIT = 20;
export const REMATCH_GAP_SIZE = 3;
/** New characters in one extra "learn more" session. */
export const EXTRA_NEW_COUNT = 5;

function cardIdFor(entry: StudyEntry): string {
  return `${entry.id}:production`;
}

function primaryItemId(cardId: string): string {
  return `primary:${cardId}`;
}

function freezePrimary(item: PrimarySessionItem): Readonly<PrimarySessionItem> {
  return Object.freeze(item);
}

/**
 * Pairs of learned look-alikes in the deck for a contrast drill, the pair that is soonest
 * fully due first. Each character is in at most one pair.
 */
export function planContrastPairs(
  cards: readonly CardRecord[],
  catalog: readonly StudyEntry[],
  lookalikes: (id: KanjiId) => readonly KanjiId[],
  limit = PRIMARY_SESSION_LIMIT / 2,
): (readonly [CardRecord, CardRecord])[] {
  const inDeck = new Set(catalog.map((entry) => entry.id));
  const learned = new Map(
    cards
      .filter((card) => !card.suspended && inDeck.has(card.kanjiId))
      .map((card) => [card.kanjiId, card]),
  );
  const candidates: (readonly [CardRecord, CardRecord])[] = [];
  for (const card of learned.values()) {
    for (const other of lookalikes(card.kanjiId)) {
      const partner = learned.get(other);
      if (partner !== undefined && card.kanjiId < other) candidates.push([card, partner]);
    }
  }
  const due = ([left, right]: readonly [CardRecord, CardRecord]) =>
    Math.max(left.dueAt, right.dueAt);
  const firstDue = ([left, right]: readonly [CardRecord, CardRecord]) =>
    Math.min(left.dueAt, right.dueAt);
  candidates.sort(
    (left, right) =>
      due(left) - due(right) ||
      firstDue(left) - firstDue(right) ||
      left[0].id.localeCompare(right[0].id) ||
      left[1].id.localeCompare(right[1].id),
  );
  const used = new Set<KanjiId>();
  const pairs: (readonly [CardRecord, CardRecord])[] = [];
  for (const pair of candidates) {
    if (pairs.length >= limit) break;
    if (used.has(pair[0].kanjiId) || used.has(pair[1].kanjiId)) continue;
    used.add(pair[0].kanjiId);
    used.add(pair[1].kanjiId);
    pairs.push(pair);
  }
  return pairs;
}

export function planSession({
  cards,
  catalog,
  settings,
  introducedToday,
  now,
  mode = 'regular',
  lookalikes = () => [],
}: PlanSessionInput): SessionPlan {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const cardByKanjiId = new Map(cards.map((card) => [card.kanjiId, card]));

  // A contrast drill reviews learned look-alikes, each pair back to back, due or not.
  if (mode === 'contrast') {
    const primaryItems = Object.freeze(
      planContrastPairs(cards, catalog, lookalikes)
        .flat()
        .map((card): Readonly<PrimarySessionItem> =>
          freezePrimary({
            id: primaryItemId(card.id),
            cardId: card.id,
            kanjiId: card.kanjiId,
            origin: 'due',
            status: 'pending',
            expectedCardVersion: card.version,
          }),
        ),
    );
    return Object.freeze({ primaryItems, dueCount: primaryItems.length, newCount: 0 });
  }

  // Extra "learn more" sessions only introduce characters; due reviews stay due for the next
  // regular session. "Review ahead" takes learned characters soonest-due first, due or not.
  const reviewable = (card: CardRecord) =>
    !card.suspended && (mode === 'review-ahead' || card.dueAt <= now);
  const dueCards = (mode === 'extra-new' ? [] : cards)
    .filter(reviewable)
    // A card outside the active deck is not shown. It stays due for a deck that has it.
    .flatMap((card): (readonly [CardRecord, StudyEntry])[] => {
      const entry = catalogById.get(card.kanjiId);
      return entry === undefined ? [] : [[card, entry]];
    })
    .sort(
      ([leftCard, leftEntry], [rightCard, rightEntry]) =>
        leftCard.dueAt - rightCard.dueAt ||
        leftEntry.curriculumOrder - rightEntry.curriculumOrder ||
        leftCard.id.localeCompare(rightCard.id),
    )
    .slice(0, PRIMARY_SESSION_LIMIT);

  const remainingSlots = PRIMARY_SESSION_LIMIT - dueCards.length;
  const remainingDailyIntroductions = Math.max(0, settings.dailyNewLimit - introducedToday);
  const newCount =
    mode === 'regular'
      ? Math.min(remainingSlots, remainingDailyIntroductions)
      : mode === 'extra-new'
        ? EXTRA_NEW_COUNT
        : 0;
  const newEntries = catalog
    .filter((entry) => !cardByKanjiId.has(entry.id))
    .sort(
      (left, right) =>
        left.curriculumOrder - right.curriculumOrder || left.id.localeCompare(right.id),
    )
    .slice(0, newCount);

  const dueItems = dueCards.map(([card]): Readonly<PrimarySessionItem> =>
    freezePrimary({
      id: primaryItemId(card.id),
      cardId: card.id,
      kanjiId: card.kanjiId,
      origin: 'due',
      status: 'pending',
      expectedCardVersion: card.version,
    }),
  );
  const newItems = newEntries.map((entry): Readonly<PrimarySessionItem> => {
    const cardId = cardIdFor(entry);
    return freezePrimary({
      id: primaryItemId(cardId),
      cardId,
      kanjiId: entry.id,
      origin: 'new',
      status: 'pending',
      expectedCardVersion: null,
    });
  });
  const primaryItems = Object.freeze([...dueItems, ...newItems]);

  return Object.freeze({
    primaryItems,
    dueCount: dueItems.length,
    newCount: newItems.length,
  });
}

function distinctGapCards(session: SessionRecord, itemId: string): number {
  const item = session.rematchItems.find((candidate) => candidate.id === itemId);
  return item === undefined
    ? 0
    : new Set(item.afterOtherCompletions.map((completion) => completion.cardId)).size;
}

export function chooseNextItem(session: SessionRecord): NextItemDecision {
  if (session.status !== 'active' || session.phase.kind !== 'selecting') {
    throw new Error('The next item can only be chosen while an active session is selecting.');
  }

  const eligibleRematch = session.rematchItems.find(
    (item) => item.status === 'pending' && distinctGapCards(session, item.id) >= REMATCH_GAP_SIZE,
  );
  if (eligibleRematch !== undefined) {
    return Object.freeze({
      kind: 'item',
      itemType: 'rematch',
      itemId: eligibleRematch.id,
    });
  }

  const primary = session.primaryItems.find((item) => item.status === 'pending');
  if (primary !== undefined) {
    return Object.freeze({ kind: 'item', itemType: 'primary', itemId: primary.id });
  }

  const shortRematch = session.rematchItems.find((item) => item.status === 'pending');
  if (shortRematch !== undefined) {
    return Object.freeze({
      kind: 'short-rematch-offer',
      itemId: shortRematch.id,
      cardId: shortRematch.cardId,
    });
  }

  return Object.freeze({ kind: 'complete' });
}
