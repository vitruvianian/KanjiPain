import type { SessionRecord, SessionSummary } from './session-types';
import type { CardRecord, ReviewEvent } from './types';

function isPassing(event: ReviewEvent): boolean {
  return !event.assisted && (event.grade === 'got' || event.grade === 'barely');
}

export function calculateSummary(
  session: SessionRecord,
  reviewEvents: readonly ReviewEvent[],
  cards: readonly CardRecord[],
): SessionSummary {
  const completedEventIds = new Set(session.completedEventIds);
  const events = reviewEvents.filter(
    (event) => event.sessionId === session.id && completedEventIds.has(event.id),
  );
  const primaryMissCards = new Set(
    events
      .filter((event) => event.kind === 'scheduled' && event.grade === 'missed')
      .map((event) => event.cardId),
  );
  const recoveredCards = new Set(
    events
      .filter(
        (event) =>
          event.kind === 'rematch' && isPassing(event) && primaryMissCards.has(event.cardId),
      )
      .map((event) => event.cardId),
  );
  const introducedCards = new Set(
    cards.filter((card) => card.introducedInSessionId === session.id).map((card) => card.id),
  );

  return Object.freeze({
    independentReviews: events.filter(
      (event) => event.kind === 'scheduled' && !event.isFirstLearningCheck && isPassing(event),
    ).length,
    newCharactersIntroduced: introducedCards.size,
    missesRecovered: recoveredCards.size,
    needsAnotherRound: [...primaryMissCards].filter((cardId) => !recoveredCards.has(cardId)).length,
  });
}
