import { describe, expect, it } from 'vitest';

import { chooseNextItem } from '../../src/domain/queue';
import { InvalidSessionTransitionError, reduceSession } from '../../src/domain/session-reducer';
import type { PrimarySessionItem, SessionRecord } from '../../src/domain/session-types';
import type { Grade, ReviewEvent } from '../../src/domain/types';
import { BASE_TIME, DATASET_VERSION, draft, reviewEvent, session } from './domain-fixtures';

function primary(id: string, cardId = id): PrimarySessionItem {
  return {
    id,
    cardId,
    kanjiId: 'k-4e00',
    origin: 'due',
    status: 'pending',
    expectedCardVersion: 0,
  };
}

function openPrompt(
  current: SessionRecord,
  itemId: string,
  expectedCardVersion = 0,
  selection: 'automatic' | 'short-rematch' = 'automatic',
): SessionRecord {
  return reduceSession(current, {
    type: 'open-item',
    itemId,
    selection,
    target: {
      kind: 'prompt',
      expectedCardVersion,
      draft: draft(itemId),
    },
  });
}

function reveal(current: SessionRecord): SessionRecord {
  return reduceSession(current, {
    type: 'reveal',
    reason: 'compare',
    revealedAt: BASE_TIME + 100,
  });
}

function commit(
  current: SessionRecord,
  itemId: string,
  cardId: string,
  grade: Grade,
  options: {
    readonly kind?: 'scheduled' | 'rematch';
    readonly beforeVersion?: number;
    readonly retryItemId?: string;
  } = {},
): SessionRecord {
  const event = reviewEvent({
    id: `attempt:${itemId}`,
    itemId,
    cardId,
    grade,
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    ...(options.beforeVersion === undefined ? {} : { beforeVersion: options.beforeVersion }),
  });
  return reduceSession(current, {
    type: 'commit-grade',
    reviewEvent: event,
    ...(options.retryItemId === undefined ? {} : { retryItemId: options.retryItemId }),
  });
}

function completeRepair(current: SessionRecord): SessionRecord {
  return reduceSession(current, { type: 'complete-repair' });
}

describe('session reducer queue progression', () => {
  it('makes a missed card eligible after three distinct other completed cards', () => {
    let current = session({
      primaryItems: [primary('a'), primary('b'), primary('c'), primary('d')],
    });

    current = reveal(openPrompt(current, 'a'));
    current = commit(current, 'a', 'a', 'missed', { retryItemId: 'a-r1' });
    current = completeRepair(current);

    for (const itemId of ['b', 'c', 'd']) {
      current = reveal(openPrompt(current, itemId));
      current = commit(current, itemId, itemId, 'got');
    }

    expect(current.rematchItems[0]?.afterOtherCompletions.map((item) => item.cardId)).toEqual([
      'b',
      'c',
      'd',
    ]);
    expect(chooseNextItem(current)).toEqual({
      kind: 'item',
      itemType: 'rematch',
      itemId: 'a-r1',
    });
  });

  it('counts repeated completions of one card only once toward a rematch gap', () => {
    let current = session({
      primaryItems: [primary('b-1', 'b'), primary('b-2', 'b'), primary('c', 'c')],
      rematchItems: [
        {
          id: 'a-r1',
          cardId: 'a',
          ordinal: 1,
          afterOtherCompletions: [],
          status: 'pending',
          expectedCardVersion: 1,
        },
      ],
    });

    for (const [itemId, cardId] of [
      ['b-1', 'b'],
      ['b-2', 'b'],
      ['c', 'c'],
    ] as const) {
      current = reveal(openPrompt(current, itemId));
      current = commit(current, itemId, cardId, 'got');
    }

    expect(current.rematchItems[0]?.afterOtherCompletions.map((item) => item.cardId)).toEqual([
      'b',
      'c',
    ]);
    expect(chooseNextItem(current).kind).toBe('short-rematch-offer');
  });

  it('enqueues at most two rematches after three misses', () => {
    let current = session({ primaryItems: [primary('a')] });

    current = reveal(openPrompt(current, 'a'));
    current = completeRepair(commit(current, 'a', 'a', 'missed', { retryItemId: 'a-r1' }));
    current = reveal(openPrompt(current, 'a-r1', 1, 'short-rematch'));
    current = completeRepair(
      commit(current, 'a-r1', 'a', 'missed', {
        kind: 'rematch',
        beforeVersion: 1,
        retryItemId: 'a-r2',
      }),
    );
    current = reveal(openPrompt(current, 'a-r2', 1, 'short-rematch'));
    current = completeRepair(
      commit(current, 'a-r2', 'a', 'missed', {
        kind: 'rematch',
        beforeVersion: 1,
      }),
    );

    expect(current.rematchItems.map((item) => item.ordinal)).toEqual([1, 2]);
    expect(chooseNextItem(current)).toEqual({ kind: 'complete' });
  });

  it('rejects a duplicate pending retry for the same card', () => {
    let current = session({
      primaryItems: [primary('a')],
      rematchItems: [
        {
          id: 'existing-a-r1',
          cardId: 'a',
          ordinal: 1,
          afterOtherCompletions: [],
          status: 'pending',
          expectedCardVersion: 1,
        },
      ],
    });
    current = reveal(openPrompt(current, 'a'));

    expect(() => commit(current, 'a', 'a', 'missed', { retryItemId: 'duplicate-a-r1' })).toThrow(
      /already has a pending rematch/,
    );
  });

  it('ends retries when a rematch passes without changing card scheduling', () => {
    let current = session({ primaryItems: [primary('a')] });
    current = reveal(openPrompt(current, 'a'));
    current = completeRepair(commit(current, 'a', 'a', 'missed', { retryItemId: 'a-r1' }));
    current = reveal(openPrompt(current, 'a-r1', 1, 'short-rematch'));
    current = commit(current, 'a-r1', 'a', 'got', {
      kind: 'rematch',
      beforeVersion: 1,
    });

    expect(current.rematchItems).toHaveLength(1);
    expect(current.rematchItems[0]?.status).toBe('done');
    expect(chooseNextItem(current)).toEqual({ kind: 'complete' });
  });

  it('supports explicitly finishing instead of taking a short rematch', () => {
    const current = session({
      rematchItems: [
        {
          id: 'a-r1',
          cardId: 'a',
          ordinal: 1,
          afterOtherCompletions: [],
          status: 'pending',
          expectedCardVersion: 1,
        },
      ],
    });

    expect(chooseNextItem(current).kind).toBe('short-rematch-offer');
    const ended = reduceSession(current, { type: 'finish', endedAt: BASE_TIME + 2_000 });

    expect(ended.status).toBe('ended');
    expect(ended.phase).toEqual({ kind: 'summary' });
    expect(ended.rematchItems[0]?.status).toBe('skipped');
  });

  it('does not award gap credit for an ambiguity skip', () => {
    let current = session({
      primaryItems: [primary('b', 'b')],
      rematchItems: [
        {
          id: 'a-r1',
          cardId: 'a',
          ordinal: 1,
          afterOtherCompletions: [],
          status: 'pending',
          expectedCardVersion: 1,
        },
      ],
    });
    current = reveal(openPrompt(current, 'b'));
    const ambiguity: ReviewEvent & { kind: 'ambiguous'; grade: null } = {
      id: 'attempt:b',
      sessionId: current.id,
      cardId: 'b',
      itemId: 'b',
      kind: 'ambiguous',
      isFirstLearningCheck: false,
      grade: null,
      assisted: false,
      hintKeysUsed: [],
      inputMode: 'drawing',
      occurredAt: BASE_TIME + 1_000,
      durationMs: 1_000,
      beforeVersion: 0,
      afterVersion: 0,
      schedulerLog: null,
      datasetVersion: DATASET_VERSION,
    };

    current = reduceSession(current, { type: 'skip-ambiguity', reviewEvent: ambiguity });

    expect(current.primaryItems[0]?.status).toBe('skipped');
    expect(current.rematchItems[0]?.afterOtherCompletions).toEqual([]);
  });
});

describe('session reducer transition guards', () => {
  it('rejects grading before reveal', () => {
    const current = openPrompt(session({ primaryItems: [primary('a')] }), 'a');
    const event = reviewEvent({
      id: 'attempt:a',
      itemId: 'a',
      cardId: 'a',
      grade: 'got',
    });

    expect(() => reduceSession(current, { type: 'commit-grade', reviewEvent: event })).toThrow(
      InvalidSessionTransitionError,
    );
  });

  it('rejects editing an answer after reveal', () => {
    const current = reveal(openPrompt(session({ primaryItems: [primary('a')] }), 'a'));

    expect(() => reduceSession(current, { type: 'save-draft', draft: draft('a') })).toThrow(
      /frozen/,
    );
  });

  it('requires an attempt before compare but permits immediate surrender', () => {
    const emptyDraft = { ...draft('a'), strokes: [] };
    const current = reduceSession(session({ primaryItems: [primary('a')] }), {
      type: 'open-item',
      itemId: 'a',
      selection: 'automatic',
      target: { kind: 'prompt', expectedCardVersion: 0, draft: emptyDraft },
    });

    expect(() =>
      reduceSession(current, {
        type: 'reveal',
        reason: 'compare',
        revealedAt: BASE_TIME + 100,
      }),
    ).toThrow(/drawing or confirmed paper attempt/);
    expect(
      reduceSession(current, {
        type: 'reveal',
        reason: 'surrender',
        revealedAt: BASE_TIME + 100,
      }).phase,
    ).toMatchObject({ kind: 'feedback', draft: { surrendered: true } });
  });

  it('prevents an assisted response from becoming a success', () => {
    let current = openPrompt(session({ primaryItems: [primary('a')] }), 'a');
    current = reduceSession(current, {
      type: 'save-draft',
      draft: { ...draft('a'), hintKeysUsed: ['stroke-count'] },
    });
    current = reveal(current);
    const assistedPass = reviewEvent({
      id: 'attempt:a',
      itemId: 'a',
      cardId: 'a',
      grade: 'got',
      assisted: true,
    });

    expect(() =>
      reduceSession(current, { type: 'commit-grade', reviewEvent: assistedPass }),
    ).toThrow(/must be graded missed/);
  });

  it('introduces planned new items before creating their first prompt', () => {
    const newItem: PrimarySessionItem = {
      ...primary('new'),
      origin: 'new',
      expectedCardVersion: null,
    };
    let current = session({ primaryItems: [newItem] });

    expect(() => openPrompt(current, 'new')).toThrow(/introduced before prompting/);
    current = reduceSession(current, {
      type: 'open-item',
      itemId: 'new',
      selection: 'automatic',
      target: { kind: 'introduction' },
    });
    current = reduceSession(current, {
      type: 'hide-introduction',
      expectedCardVersion: 0,
      draft: draft('new'),
    });

    expect(current.phase).toMatchObject({ kind: 'prompt', expectedCardVersion: 0 });
    expect(current.primaryItems[0]?.expectedCardVersion).toBe(0);
  });
});
