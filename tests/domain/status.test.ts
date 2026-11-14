import { describe, expect, it } from 'vitest';

import { deriveCharacterStatus } from '../../src/domain/status';
import type { ReviewEvent } from '../../src/domain/types';
import { BASE_TIME, card, entry, reviewEvent } from './domain-fixtures';

const DAY_MS = 86_400_000;

function historyEvent(id: string, cardId: string, occurredAt: number): ReviewEvent {
  return {
    ...reviewEvent({ id, itemId: id, cardId, grade: 'got' }),
    occurredAt,
  };
}

describe('deriveCharacterStatus', () => {
  it('distinguishes unseen, introduced, and developing characters', () => {
    const catalogEntry = entry(0);
    const introduced = card(catalogEntry, { scheduledReviewCount: 0 });
    const developing = card(catalogEntry, { scheduledReviewCount: 1 });

    expect(deriveCharacterStatus(undefined, [], BASE_TIME).learning).toBe('unseen');
    expect(deriveCharacterStatus(introduced, [], BASE_TIME).learning).toBe('introduced');
    expect(
      deriveCharacterStatus(developing, [historyEvent('one', developing.id, BASE_TIME)], BASE_TIME)
        .learning,
    ).toBe('developing');
  });

  it('requires three latest unassisted passes, a fourteen-day span, and a seven-day interval', () => {
    const catalogEntry = entry(1);
    const firstAt = BASE_TIME - 20 * DAY_MS;
    const latestAt = firstAt + 14 * DAY_MS;
    const reliableCard = card(catalogEntry, {
      scheduledReviewCount: 3,
      dueAt: latestAt + 7 * DAY_MS,
    });
    const history = [
      historyEvent('one', reliableCard.id, firstAt),
      historyEvent('two', reliableCard.id, firstAt + 7 * DAY_MS),
      historyEvent('three', reliableCard.id, latestAt),
    ];
    const [firstReview, secondReview, thirdReview] = history;
    if (firstReview === undefined || secondReview === undefined || thirdReview === undefined) {
      throw new Error('Reliable history fixture is incomplete.');
    }

    expect(deriveCharacterStatus(reliableCard, history, latestAt).learning).toBe('reliable');
    expect(
      deriveCharacterStatus(
        reliableCard,
        [{ ...firstReview, occurredAt: firstAt + 1 }, secondReview, thirdReview],
        latestAt,
      ).learning,
    ).toBe('developing');
    expect(
      deriveCharacterStatus(
        { ...reliableCard, dueAt: latestAt + 7 * DAY_MS - 1 },
        history,
        latestAt,
      ).learning,
    ).toBe('developing');
  });

  it('rejects an assisted or missed review among the latest three', () => {
    const developingCard = card(entry(2), {
      scheduledReviewCount: 4,
      dueAt: BASE_TIME + 7 * DAY_MS,
    });
    const history = [
      historyEvent('old', developingCard.id, BASE_TIME - 30 * DAY_MS),
      historyEvent('one', developingCard.id, BASE_TIME - 14 * DAY_MS),
      { ...historyEvent('two', developingCard.id, BASE_TIME - 7 * DAY_MS), assisted: true },
      historyEvent('three', developingCard.id, BASE_TIME),
    ];

    expect(deriveCharacterStatus(developingCard, history, BASE_TIME).learning).toBe('developing');
  });

  it('derives due and paused as independent badges', () => {
    const dueCard = card(entry(3), { dueAt: BASE_TIME, suspended: false });
    const pausedCard = { ...dueCard, suspended: true };

    expect(deriveCharacterStatus(dueCard, [], BASE_TIME)).toMatchObject({
      due: true,
      paused: false,
    });
    expect(deriveCharacterStatus(pausedCard, [], BASE_TIME)).toMatchObject({
      due: false,
      paused: true,
    });
  });
});
