import type {
  NextItemDecision,
  PlanSessionInput,
  PrimarySessionItem,
  SessionPlan,
  SessionRecord,
} from './session-types';
import type { CardRecord, KanjiEntry } from './types';

export const PRIMARY_SESSION_LIMIT = 20;
export const REMATCH_GAP_SIZE = 3;

function cardIdFor(entry: KanjiEntry): string {
  return `${entry.id}:production`;
}

function primaryItemId(cardId: string): string {
  return `primary:${cardId}`;
}

function freezePrimary(item: PrimarySessionItem): Readonly<PrimarySessionItem> {
  return Object.freeze(item);
}

export function planSession({
  cards,
  catalog,
  settings,
  introducedToday,
  now,
}: PlanSessionInput): SessionPlan {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const cardByKanjiId = new Map(cards.map((card) => [card.kanjiId, card]));

  const dueCards = cards
    .filter((card) => !card.suspended && card.dueAt <= now)
    .map((card): readonly [CardRecord, KanjiEntry] => {
      const entry = catalogById.get(card.kanjiId);
      if (entry === undefined) {
        throw new Error(`Card ${card.id} references missing catalog entry ${card.kanjiId}.`);
      }
      return [card, entry];
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
  const newCount = Math.min(remainingSlots, remainingDailyIntroductions);
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
