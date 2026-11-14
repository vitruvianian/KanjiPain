import type { CharacterStatus } from './session-types';
import type { CardRecord, ReviewEvent, UnixMs } from './types';

const DAY_MS = 86_400_000;
const RELIABLE_SPAN_MS = 14 * DAY_MS;
const RELIABLE_INTERVAL_MS = 7 * DAY_MS;

function isReliableReview(event: ReviewEvent): boolean {
  return (
    event.kind === 'scheduled' &&
    !event.assisted &&
    (event.grade === 'got' || event.grade === 'barely')
  );
}

export function deriveCharacterStatus(
  card: CardRecord | undefined,
  scheduledHistory: readonly ReviewEvent[],
  now: UnixMs,
): CharacterStatus {
  if (card === undefined) {
    return Object.freeze({ learning: 'unseen', due: false, paused: false });
  }

  const scheduled = scheduledHistory
    .filter((event) => event.cardId === card.id && event.kind === 'scheduled')
    .sort((left, right) => left.occurredAt - right.occurredAt || left.id.localeCompare(right.id));
  let learning: CharacterStatus['learning'] = 'introduced';

  if (card.scheduledReviewCount > 0 || scheduled.length > 0) {
    learning = 'developing';
    const latestThree = scheduled.slice(-3);
    const first = latestThree[0];
    const latest = latestThree[2];
    if (
      latestThree.length === 3 &&
      first !== undefined &&
      latest !== undefined &&
      latestThree.every(isReliableReview) &&
      latest.occurredAt - first.occurredAt >= RELIABLE_SPAN_MS &&
      card.dueAt - latest.occurredAt >= RELIABLE_INTERVAL_MS
    ) {
      learning = 'reliable';
    }
  }

  return Object.freeze({
    learning,
    due: !card.suspended && card.dueAt <= now,
    paused: card.suspended,
  });
}
