import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { catalogManifestSchema, teachingNotesSchema } from '../src/domain/schemas';
import type { KanjiEntry } from '../src/domain/types';
import {
  datasetVersion,
  EXPECTED_JOYO_COUNT,
  sha256,
  validateProductionCatalog,
} from './catalog-pipeline';

const strokesManifestSchema = z.looseObject({
  entryCount: z.literal(EXPECTED_JOYO_COUNT),
  strokeTotal: z.number().int().positive(),
  strokesSha256: z.string().regex(/^[0-9a-f]{64}$/),
  componentHints: z.strictObject({
    entryCount: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  lookalikes: z.strictObject({
    entryCount: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  strokeCountDifferences: z.array(
    z.strictObject({
      id: z.string(),
      literal: z.string(),
      catalog: z.number().int().positive(),
      kanjivg: z.number().int().positive(),
    }),
  ),
});

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
}

export async function validateGeneratedCatalog(): Promise<void> {
  const catalogPath = resolve('src/data/kanji.generated.json');
  const manifestPath = resolve('src/data/catalog-manifest.json');
  const teachingNotesPath = resolve('src/data/teaching-notes.json');
  const [catalogBytes, manifestBytes, teachingNotesBytes] = await Promise.all([
    readFile(catalogPath),
    readFile(manifestPath),
    readFile(teachingNotesPath),
  ]);

  const catalogInput = parseJson(catalogBytes.toString('utf8'), catalogPath);
  const teachingNotes = teachingNotesSchema.parse(
    parseJson(teachingNotesBytes.toString('utf8'), teachingNotesPath),
  );
  const manifest = catalogManifestSchema.parse(
    parseJson(manifestBytes.toString('utf8'), manifestPath),
  );
  const catalog = validateProductionCatalog(catalogInput, teachingNotes);
  const catalogSha256 = sha256(catalogBytes);
  const teachingNotesSha256 = sha256(teachingNotesBytes);
  const expectedDatasetVersion = datasetVersion(catalogSha256, teachingNotesSha256);

  if (manifest.entryCount !== catalog.length || catalog.length !== EXPECTED_JOYO_COUNT) {
    throw new Error('Catalog count does not match its manifest or the Jōyō count.');
  }
  if (manifest.catalogSha256 !== catalogSha256) {
    throw new Error('Catalog SHA-256 does not match its manifest.');
  }
  if (manifest.teachingNotesSha256 !== teachingNotesSha256) {
    throw new Error('Teaching-notes SHA-256 does not match its manifest.');
  }
  if (manifest.datasetVersion !== expectedDatasetVersion) {
    throw new Error('Dataset version does not match the documented hash formula.');
  }

  const strokesBytes = await readFile(resolve('src/data/strokes.generated.json'));
  const strokesManifest = strokesManifestSchema.parse(
    parseJson(
      await readFile(resolve('src/data/strokes-manifest.json'), 'utf8'),
      'strokes manifest',
    ),
  );
  const strokes = z
    .record(z.string(), z.array(z.string().regex(/^(?:[0-9a-f]{4}){2,}$/)).min(1))
    .parse(parseJson(strokesBytes.toString('utf8'), 'reference strokes'));
  if (strokesManifest.strokesSha256 !== sha256(strokesBytes)) {
    throw new Error('Reference strokes SHA-256 does not match its manifest.');
  }
  const missingStrokes = catalog.filter((entry) => strokes[entry.id] === undefined);
  if (missingStrokes.length > 0 || Object.keys(strokes).length !== catalog.length) {
    throw new Error('Reference strokes do not cover exactly the catalog characters.');
  }
  const expectedDifferences = new Map(
    strokesManifest.strokeCountDifferences.map((difference) => [difference.id, difference.kanjivg]),
  );
  for (const entry of catalog) {
    const count = strokes[entry.id]?.length;
    if (count !== (expectedDifferences.get(entry.id) ?? entry.strokeCount)) {
      throw new Error(`Unreviewed stroke-count difference for ${entry.literal}.`);
    }
  }

  validateDerivedTeachingData(
    catalog,
    strokesManifest,
    await readFile(resolve('src/data/component-hints.generated.json')),
    await readFile(resolve('src/data/lookalikes.generated.json')),
  );

  console.log(
    `Validated ${String(catalog.length)} unique Jōyō kanji (dataset ${manifest.datasetVersion}) ` +
      `and their ${String(strokesManifest.strokeTotal)} reference strokes.`,
  );
}

/** Component hints and look-alikes: hashes, catalog membership, no leaks, symmetry. */
function validateDerivedTeachingData(
  catalog: readonly KanjiEntry[],
  manifest: z.output<typeof strokesManifestSchema>,
  hintsBytes: Buffer,
  lookalikesBytes: Buffer,
): void {
  if (manifest.componentHints.sha256 !== sha256(hintsBytes)) {
    throw new Error('Component hints SHA-256 does not match the strokes manifest.');
  }
  if (manifest.lookalikes.sha256 !== sha256(lookalikesBytes)) {
    throw new Error('Look-alikes SHA-256 does not match the strokes manifest.');
  }
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const hints = z
    .record(z.string(), z.string().min(1))
    .parse(parseJson(hintsBytes.toString('utf8'), 'component hints'));
  for (const [id, hint] of Object.entries(hints)) {
    const entry = byId.get(id);
    if (entry === undefined) throw new Error(`Component hint for unknown character ${id}.`);
    if (hint.includes(entry.literal)) throw new Error(`Component hint leaks ${entry.literal}.`);
  }
  const lookalikes = z
    .record(z.string(), z.array(z.string()).min(1))
    .parse(parseJson(lookalikesBytes.toString('utf8'), 'look-alikes'));
  for (const [id, others] of Object.entries(lookalikes)) {
    if (!byId.has(id)) throw new Error(`Look-alikes for unknown character ${id}.`);
    for (const other of others) {
      if (!byId.has(other) || other === id) {
        throw new Error(`Look-alike ${other} of ${id} is not another catalog character.`);
      }
    }
  }
}

const commandPath = process.argv[1];
if (commandPath !== undefined && import.meta.url === pathToFileURL(commandPath).href) {
  validateGeneratedCatalog().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
