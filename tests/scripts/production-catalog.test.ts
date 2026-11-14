import { describe, expect, it } from 'vitest';

import catalog from '../../src/data/kanji.generated.json';
import manifest from '../../src/data/catalog-manifest.json';
import teachingNotes from '../../src/data/teaching-notes.json';
import { validateProductionCatalog } from '../../scripts/catalog-pipeline';
import { createCatalogRepository } from '../../src/services/catalog';

describe('generated production catalog', () => {
  it('contains exactly 2,136 validated Jōyō entries', () => {
    expect(validateProductionCatalog(catalog, teachingNotes)).toHaveLength(2_136);
  });

  it('contains 湖 under its stable ID', () => {
    const repository = createCatalogRepository(catalog, manifest);
    const lake = repository.byId('k-6e56');

    expect(lake?.literal).toBe('湖');
    expect(lake?.meanings).toContain('lake');
  });

  it('preserves KANJIDIC reading punctuation', () => {
    const repository = createCatalogRepository(catalog, manifest);
    const food = repository.byId('k-98df');

    expect(food?.kunReadings).toContain('た.べる');
  });

  it('exposes immutable ordered catalog views', () => {
    const repository = createCatalogRepository(catalog, manifest);

    expect(repository.all).toHaveLength(2_136);
    expect(repository.orderedIds).toHaveLength(2_136);
    expect(Object.isFrozen(repository.all)).toBe(true);
    expect(Object.isFrozen(repository.byId('k-6e56'))).toBe(true);
  });
});
