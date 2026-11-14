import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  normalizeKanjidicXml,
  sha256,
  stableJson,
  validateProductionCatalog,
} from '../../scripts/catalog-pipeline';

async function readFixture(): Promise<string> {
  return readFile(resolve('tests/fixtures/kanjidic-small.xml'), 'utf8');
}

describe('KANJIDIC2 normalization', () => {
  it('filters grades and preserves the selected source fields', async () => {
    const catalog = normalizeKanjidicXml(await readFixture());

    expect(catalog).toHaveLength(3);
    expect(catalog.map((entry) => entry.literal)).toEqual(['一', '食', '亜']);
    expect(catalog.map((entry) => entry.curriculumOrder)).toEqual([0, 1, 2]);

    const food = catalog[1];
    expect(food).toMatchObject({
      id: 'k-98df',
      meanings: ['eat', 'food'],
      onReadings: ['ショク'],
      kunReadings: ['た.べる'],
    });
    expect(food?.meanings).not.toContain('nourriture');

    const asia = catalog[2];
    expect(asia?.strokeCount).toBe(7);
    expect(asia?.onReadings).toEqual(['ア']);
    expect(asia?.onReadings).not.toContain('ya4');
  });

  it('produces the same catalog hash from the same gzipped source bytes', async () => {
    const gzipBytes = gzipSync(await readFixture());
    const first = normalizeKanjidicXml(gunzipSync(gzipBytes).toString('utf8'));
    const second = normalizeKanjidicXml(gunzipSync(gzipBytes).toString('utf8'));

    expect(sha256(stableJson(first))).toBe(sha256(stableJson(second)));
  });

  it('keeps the production count gate separate from fixture normalization', async () => {
    const fixtureCatalog = normalizeKanjidicXml(await readFixture());

    expect(() => validateProductionCatalog(fixtureCatalog, {})).toThrow(/2136|array/i);
  });

  it('rejects duplicate selected literals instead of silently deduplicating', async () => {
    const xml = await readFixture();
    const firstCharacter = /<character>[\s\S]*?<\/character>/u.exec(xml)?.[0] ?? '';
    const duplicate = xml.replace('</kanjidic2>', `${firstCharacter}</kanjidic2>`);

    expect(() => normalizeKanjidicXml(duplicate)).toThrow(/duplicate selected literal/i);
  });
});
