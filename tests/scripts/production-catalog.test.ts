import { describe, expect, it } from 'vitest';

import catalog from '../../src/data/kanji.generated.json';
import manifest from '../../src/data/catalog-manifest.json';
import teachingNotes from '../../src/data/teaching-notes.json';
import {
  validateDistinctMeaningCues,
  validateProductionCatalog,
} from '../../scripts/catalog-pipeline';
import { buildPrompt } from '../../src/domain/prompts';
import { createCatalogRepository, loadBundledCatalog } from '../../src/services/catalog';

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

  it('gives every character a distinct meaning cue', () => {
    expect(() => {
      validateDistinctMeaningCues(catalog, teachingNotes);
    }).not.toThrow();
    // Without the reviewed overrides, 砂 and 沙 would both be "sand".
    expect(() => {
      validateDistinctMeaningCues(catalog, {});
    }).toThrow(/砂\/沙 \("sand"\)/);
  });

  it('loads the bundled catalog with generated component hints and look-alikes', async () => {
    const repository = await loadBundledCatalog();
    expect(repository.all).toHaveLength(2_136);
    // 海: water on the left, 毎 ("every") on the right.
    expect(repository.teachingNotes['k-6d77']?.componentHint).toBe('Left: water · Right: every');
    expect(repository.lookalikes('k-672a')).toContain('k-672b');
    expect(repository.lookalikes('k-672b')).toContain('k-672a');
    // A reviewed override keeps its prompt and gains the generated hint.
    const sand = repository.teachingNotes['k-7802'];
    expect(sand?.promptOverride?.meaningCue).toBe('sand, grit');
    const entry = repository.byId('k-7802');
    if (entry === undefined) throw new Error('砂 is missing.');
    expect(buildPrompt(entry, sand).hints.map((hint) => hint.key)).toEqual(
      sand?.componentHint === undefined ? ['stroke-count'] : ['stroke-count', 'component'],
    );
  });

  it('prefers a reviewed component hint and drops look-alikes outside the catalog', () => {
    const repository = createCatalogRepository(
      catalog,
      manifest,
      { 'k-6e56': { componentHint: 'Reviewed hint.', source: 'test', reviewer: 'test' } },
      {
        componentHints: { 'k-6e56': 'Generated hint.', 'k-6d77': 'Generated 海 hint.' },
        lookalikes: { 'k-672a': ['k-672b', 'k-0041'] },
      },
    );
    expect(repository.teachingNotes['k-6e56']?.componentHint).toBe('Reviewed hint.');
    expect(repository.teachingNotes['k-6d77']?.componentHint).toBe('Generated 海 hint.');
    expect(repository.lookalikes('k-672a')).toEqual(['k-672b']);
    expect(repository.lookalikes('k-6e56')).toEqual([]);
  });
});
