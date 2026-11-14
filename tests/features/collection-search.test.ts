import { describe, expect, it } from 'vitest';

import { normalizeKana, searchEntries } from '../../src/features/collection/search';
import { loadBundledCatalog } from '../../src/services/catalog';

const catalog = loadBundledCatalog();

describe('collection search', () => {
  it('normalizes katakana to hiragana for comparison', () => {
    expect(normalizeKana('ミズウミ')).toBe('みずうみ');
    expect(normalizeKana('コウ')).toBe('こう');
    expect(normalizeKana('ヴ')).toBe('ゔ');
    expect(normalizeKana('ABC')).toBe('ABC');
  });

  it('finds 湖 by literal, English meaning, hiragana, and katakana reading', () => {
    const lake = catalog.all.find((entry) => entry.literal === '湖');
    expect(lake).toBeDefined();

    for (const query of ['湖', 'lake', 'みずうみ', 'ミズウミ']) {
      expect(searchEntries(catalog.all, query)).toContainEqual(lake);
    }
  });

  it('searches the whole catalog rather than a page of results', () => {
    const results = searchEntries(catalog.all, 'eat');
    expect(results.length).toBeGreaterThan(1);
    expect(results.map((entry) => entry.literal)).toContain('食');
  });

  it('returns every entry for a blank query without changing source readings', () => {
    expect(searchEntries(catalog.all, '   ')).toHaveLength(catalog.all.length);
    const food = catalog.all.find((entry) => entry.literal === '食');
    expect(food?.kunReadings).toContain('た.べる');
  });
});
