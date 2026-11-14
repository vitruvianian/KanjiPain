import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/domain/clock';
import type { IdSource } from '../../src/domain/ids';
import { cardId, kanjiIdFromLiteral } from '../../src/domain/ids';

describe('kanji IDs', () => {
  it('uses a lowercase, padded Unicode code point', () => {
    expect(kanjiIdFromLiteral('一')).toBe('k-4e00');
    expect(kanjiIdFromLiteral('湖')).toBe('k-6e56');
  });

  it('rejects empty and multi-code-point literals', () => {
    expect(() => kanjiIdFromLiteral('')).toThrow(/exactly one Unicode code point/i);
    expect(() => kanjiIdFromLiteral('日本')).toThrow(/exactly one Unicode code point/i);
  });

  it('creates the production card ID deterministically', () => {
    expect(cardId('k-6e56')).toBe('k-6e56:production');
  });
});

describe('injectable environment sources', () => {
  it('supports deterministic clocks and ID sources in tests', () => {
    const fixedClock: Clock = { now: () => 1_800_000_000_000 };
    const fixedIds: IdSource = { next: () => 'fixed-id' };

    expect(fixedClock.now()).toBe(1_800_000_000_000);
    expect(fixedIds.next()).toBe('fixed-id');
  });
});
