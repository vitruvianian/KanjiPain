import { describe, expect, it } from 'vitest';

import {
  EXTRA_NEW_COUNT,
  chooseNextItem,
  planContrastPairs,
  planSession,
} from '../../src/domain/queue';
import type { SettingsRecord } from '../../src/domain/types';
import { BASE_TIME, card, entry, session } from './domain-fixtures';

const settings: SettingsRecord = {
  id: 'user',
  dailyNewLimit: 5,
  inputMode: 'drawing',
  onboardingCompleted: true,
  activeDeckId: 'standard',
};

describe('contrast drills', () => {
  const catalog = Array.from({ length: 8 }, (_, index) => entry(index));
  const id = (index: number) => catalog[index]?.id ?? '';
  // 0↔1 and 2↔3 are look-alikes, and 1 also looks like 2.
  const table: Record<string, string[]> = {
    [id(0)]: [id(1)],
    [id(1)]: [id(0), id(2)],
    [id(2)]: [id(3), id(1)],
    [id(3)]: [id(2)],
    [id(4)]: [id(5)],
    [id(5)]: [id(4)],
  };
  const lookalikes = (kanjiId: string) => table[kanjiId] ?? [];

  it('pairs learned look-alikes once each, the soonest due pair first', () => {
    const cards = [
      card(catalog[0] ?? entry(0), { dueAt: BASE_TIME + 5_000 }),
      card(catalog[1] ?? entry(1), { dueAt: BASE_TIME + 9_000 }),
      card(catalog[2] ?? entry(2), { dueAt: BASE_TIME + 1_000 }),
      card(catalog[3] ?? entry(3), { dueAt: BASE_TIME + 2_000 }),
      // 4's look-alike 5 is not learned yet; 6 has none.
      card(catalog[4] ?? entry(4)),
      card(catalog[6] ?? entry(6)),
    ];

    const pairs = planContrastPairs(cards, catalog, lookalikes);
    expect(pairs.map(([left, right]) => [left.kanjiId, right.kanjiId])).toEqual([
      [id(2), id(3)],
      [id(0), id(1)],
    ]);

    const plan = planSession({
      cards,
      catalog,
      settings,
      introducedToday: 0,
      now: BASE_TIME,
      mode: 'contrast',
      lookalikes,
    });
    expect(plan.newCount).toBe(0);
    expect(plan.primaryItems.map((item) => item.kanjiId)).toEqual([id(2), id(3), id(0), id(1)]);
    expect(plan.primaryItems.every((item) => item.origin === 'due')).toBe(true);
  });

  it('leaves out paused cards and characters outside the deck', () => {
    const cards = [
      card(catalog[0] ?? entry(0)),
      card(catalog[1] ?? entry(1), { suspended: true }),
      card(catalog[2] ?? entry(2)),
      card(catalog[3] ?? entry(3)),
    ];
    expect(planContrastPairs(cards, catalog.slice(0, 3), lookalikes)).toEqual([]);
  });
});

describe('planSession extra modes', () => {
  it('introduces a fixed batch beyond the daily limit and leaves due reviews alone', () => {
    const catalog = Array.from({ length: 12 }, (_, index) => entry(index));
    const cards = catalog.slice(0, 3).map((item) => card(item));

    const plan = planSession({
      cards,
      catalog,
      settings,
      introducedToday: 5,
      now: BASE_TIME,
      mode: 'extra-new',
    });

    expect(plan.dueCount).toBe(0);
    expect(plan.newCount).toBe(EXTRA_NEW_COUNT);
    expect(plan.primaryItems.map((item) => item.kanjiId)).toEqual(
      catalog.slice(3, 3 + EXTRA_NEW_COUNT).map((item) => item.id),
    );
  });

  it('reviews learned cards soonest-due first, including ones not yet due', () => {
    const catalog = Array.from({ length: 30 }, (_, index) => entry(index));
    const cards = catalog
      .slice(0, 25)
      .map((item, index) =>
        card(item, { dueAt: BASE_TIME + (25 - index) * 60_000, suspended: index === 0 }),
      );

    const plan = planSession({
      cards,
      catalog,
      settings,
      introducedToday: 0,
      now: BASE_TIME,
      mode: 'review-ahead',
    });

    expect(plan.newCount).toBe(0);
    expect(plan.primaryItems).toHaveLength(20);
    expect(plan.primaryItems[0]?.kanjiId).toBe(catalog[24]?.id);
    expect(plan.primaryItems.every((item) => item.origin === 'due')).toBe(true);
    expect(plan.primaryItems.map((item) => item.kanjiId)).not.toContain(catalog[0]?.id);
  });
});

describe('planSession', () => {
  it('selects at most twenty due cards and no new cards when twenty are due', () => {
    const catalog = Array.from({ length: 30 }, (_, index) => entry(index));
    const cards = catalog.slice(0, 25).map((item) => card(item));

    const plan = planSession({ cards, catalog, settings, introducedToday: 0, now: BASE_TIME });

    expect(plan.dueCount).toBe(20);
    expect(plan.newCount).toBe(0);
    expect(plan.primaryItems).toHaveLength(20);
  });

  it('fills remaining primary slots with unseen curriculum entries', () => {
    const catalog = Array.from({ length: 25 }, (_, index) => entry(index));
    const cards = catalog.slice(0, 18).map((item) => card(item));

    const plan = planSession({ cards, catalog, settings, introducedToday: 0, now: BASE_TIME });

    expect(plan.dueCount).toBe(18);
    expect(plan.newCount).toBe(2);
    expect(plan.primaryItems.slice(-2).map((item) => item.kanjiId)).toEqual([
      catalog[18]?.id,
      catalog[19]?.id,
    ]);
  });

  it('subtracts introductions already consumed today', () => {
    const catalog = Array.from({ length: 10 }, (_, index) => entry(index));

    const plan = planSession({
      cards: [],
      catalog,
      settings,
      introducedToday: 3,
      now: BASE_TIME,
    });

    expect(plan.dueCount).toBe(0);
    expect(plan.newCount).toBe(2);
  });

  it('returns an empty plan when the daily limit is zero and nothing is due', () => {
    const plan = planSession({
      cards: [],
      catalog: [entry(0)],
      settings: { ...settings, dailyNewLimit: 0 },
      introducedToday: 0,
      now: BASE_TIME,
    });

    expect(plan.primaryItems).toEqual([]);
  });

  it('sorts equal due times by curriculum order and then card ID', () => {
    const first = entry(0);
    const second = { ...entry(1), curriculumOrder: 0 };
    const third = entry(2);
    const cards = [
      card(third, { dueAt: BASE_TIME - 1 }),
      card(second, { dueAt: BASE_TIME - 2, id: 'z-card' }),
      card(first, { dueAt: BASE_TIME - 2, id: 'a-card' }),
    ];

    const plan = planSession({
      cards,
      catalog: [third, second, first],
      settings: { ...settings, dailyNewLimit: 0 },
      introducedToday: 0,
      now: BASE_TIME,
    });

    expect(plan.primaryItems.map((item) => item.cardId)).toEqual([
      'a-card',
      'z-card',
      cards[0]?.id,
    ]);
  });

  it('excludes suspended due cards and does not treat their characters as unseen', () => {
    const firstEntry = entry(0);
    const secondEntry = entry(1);
    const catalog = [firstEntry, secondEntry];
    const suspended = card(firstEntry, { suspended: true });

    const plan = planSession({
      cards: [suspended],
      catalog,
      settings,
      introducedToday: 0,
      now: BASE_TIME,
    });

    expect(plan.dueCount).toBe(0);
    expect(plan.primaryItems.map((item) => item.kanjiId)).toEqual([secondEntry.id]);
  });
});

describe('chooseNextItem', () => {
  const primary = {
    id: 'primary:a',
    cardId: 'a',
    kanjiId: 'k-4e00',
    origin: 'due' as const,
    status: 'pending' as const,
    expectedCardVersion: 0,
  };
  const rematch = {
    id: 'rematch:a:1',
    cardId: 'a',
    ordinal: 1 as const,
    status: 'pending' as const,
    expectedCardVersion: 1,
    afterOtherCompletions: [],
  };

  it('prefers the oldest rematch with three distinct gap cards', () => {
    const current = session({
      primaryItems: [primary],
      rematchItems: [
        {
          ...rematch,
          afterOtherCompletions: [
            { cardId: 'b', eventId: 'b1' },
            { cardId: 'c', eventId: 'c1' },
            { cardId: 'd', eventId: 'd1' },
          ],
        },
      ],
    });

    expect(chooseNextItem(current)).toEqual({
      kind: 'item',
      itemType: 'rematch',
      itemId: rematch.id,
    });
  });

  it('chooses a primary before an ineligible rematch', () => {
    expect(chooseNextItem(session({ primaryItems: [primary], rematchItems: [rematch] }))).toEqual({
      kind: 'item',
      itemType: 'primary',
      itemId: primary.id,
    });
  });

  it('explicitly offers a short rematch when no primary work remains', () => {
    expect(chooseNextItem(session({ rematchItems: [rematch] }))).toEqual({
      kind: 'short-rematch-offer',
      itemId: rematch.id,
      cardId: rematch.cardId,
    });
  });

  it('explicitly reports completion when no pending work remains', () => {
    expect(chooseNextItem(session())).toEqual({ kind: 'complete' });
  });
});
