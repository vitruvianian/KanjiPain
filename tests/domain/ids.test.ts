import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/domain/clock';
import type { IdSource } from '../../src/domain/ids';
import { cardId, kanjiIdFromLiteral, randomUuid } from '../../src/domain/ids';

describe('random record IDs', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('falls back to getRandomValues outside a secure context', () => {
    // Over plain http on a local network address, browsers leave randomUUID undefined.
    const insecure = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const ids = new Set(Array.from({ length: 200 }, () => randomUuid(insecure)));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('uses randomUUID when the browser provides it', () => {
    expect(randomUuid()).toMatch(UUID_V4);
  });
});

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
