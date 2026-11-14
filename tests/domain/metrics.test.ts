import { describe, expect, it } from 'vitest';

import { calculateSummary } from '../../src/domain/metrics';
import type { ReviewEvent } from '../../src/domain/types';
import { BASE_TIME, card, DATASET_VERSION, entry, reviewEvent, session } from './domain-fixtures';

describe('calculateSummary', () => {
  it('calculates independent reviews, introductions, recoveries, and unresolved misses', () => {
    const events: ReviewEvent[] = [
      reviewEvent({ id: 'independent', itemId: 'a', cardId: 'a', grade: 'got' }),
      reviewEvent({
        id: 'assisted',
        itemId: 'b',
        cardId: 'b',
        grade: 'got',
        assisted: true,
      }),
      reviewEvent({
        id: 'first-check',
        itemId: 'c',
        cardId: 'c',
        grade: 'got',
        isFirstLearningCheck: true,
      }),
      reviewEvent({ id: 'miss-b', itemId: 'd', cardId: 'miss-b', grade: 'missed' }),
      reviewEvent({
        id: 'recover-b',
        itemId: 'd-r1',
        cardId: 'miss-b',
        grade: 'barely',
        kind: 'rematch',
        beforeVersion: 1,
      }),
      reviewEvent({ id: 'miss-c', itemId: 'e', cardId: 'miss-c', grade: 'missed' }),
    ];
    const current = session({ completedEventIds: events.map((event) => event.id) });
    const introduced = [
      card(entry(0), { introducedInSessionId: current.id }),
      card(entry(1), { introducedInSessionId: current.id }),
      card(entry(2), { introducedInSessionId: 'another-session' }),
    ];

    expect(calculateSummary(current, events, introduced)).toEqual({
      independentReviews: 1,
      newCharactersIntroduced: 2,
      missesRecovered: 1,
      needsAnotherRound: 1,
    });
  });

  it('ignores events that are not referenced as completed by this session', () => {
    const uncommitted: ReviewEvent = {
      ...reviewEvent({ id: 'other', itemId: 'a', cardId: 'a', grade: 'got' }),
      sessionId: 'another-session',
      occurredAt: BASE_TIME,
      datasetVersion: DATASET_VERSION,
    };

    expect(calculateSummary(session(), [uncommitted], [])).toEqual({
      independentReviews: 0,
      newCharactersIntroduced: 0,
      missesRecovered: 0,
      needsAnotherRound: 0,
    });
  });
});
