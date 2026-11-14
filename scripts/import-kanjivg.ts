import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { z } from 'zod';

import { kanjiEntrySchema } from '../src/domain/schemas';
import { sha256, stableJson } from './catalog-pipeline';
import {
  buildReferenceStrokes,
  KANJIVG_DOWNLOAD_URL,
  KANJIVG_LICENSE_URL,
  KANJIVG_PROJECT_URL,
  KANJIVG_RELEASE,
} from './kanjivg-pipeline';

const defaultInputPath = resolve('data/raw/kanjivg.xml.gz');
const catalogPath = resolve('src/data/kanji.generated.json');
const strokesOutputPath = resolve('src/data/strokes.generated.json');
const manifestOutputPath = resolve('src/data/strokes-manifest.json');

const fetchMetadataSchema = z.looseObject({
  retrievedAt: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

async function writeAtomically(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${String(process.pid)}`;

  try {
    await writeFile(temporaryPath, text, 'utf8');
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function importKanjivg(inputPath = defaultInputPath): Promise<void> {
  const [inputBytes, catalogText, metadataText] = await Promise.all([
    readFile(inputPath),
    readFile(catalogPath, 'utf8'),
    readFile(inputPath.replace(/\.xml\.gz$/, '.metadata.json'), 'utf8').catch(() => null),
  ]);
  const inputSha256 = sha256(inputBytes);
  const metadata =
    metadataText === null ? null : fetchMetadataSchema.parse(JSON.parse(metadataText) as unknown);
  if (metadata !== null && metadata.sha256 !== inputSha256) {
    throw new Error('KanjiVG download does not match its recorded SHA-256.');
  }

  const catalog = kanjiEntrySchema.array().parse(JSON.parse(catalogText) as unknown);
  const build = buildReferenceStrokes(gunzipSync(inputBytes).toString('utf8'), catalog);
  // One character per line keeps the file compact and its diffs reviewable.
  const strokesText = `{\n${Object.entries(build.data)
    .map(([id, strokes]) => `${JSON.stringify(id)}:${JSON.stringify(strokes)}`)
    .join(',\n')}\n}\n`;

  const manifest = {
    schemaVersion: 1,
    entryCount: Object.keys(build.data).length,
    strokeTotal: build.strokeTotal,
    strokesSha256: sha256(strokesText),
    strokeCountDifferences: build.strokeCountDifferences,
    source: {
      name: 'KanjiVG',
      release: KANJIVG_RELEASE,
      downloadUrl: KANJIVG_DOWNLOAD_URL,
      projectUrl: KANJIVG_PROJECT_URL,
      licenseUrl: KANJIVG_LICENSE_URL,
      license: 'CC BY-SA 3.0',
      retrievedAt: metadata?.retrievedAt ?? null,
      inputSha256,
    },
  };

  await writeAtomically(strokesOutputPath, strokesText);
  await writeAtomically(manifestOutputPath, stableJson(manifest));
  console.log(
    `Imported ${String(manifest.entryCount)} characters (${String(build.strokeTotal)} strokes); ` +
      `${String(build.strokeCountDifferences.length)} differ from the catalog stroke count.`,
  );
}

const commandPath = process.argv[1];
if (commandPath !== undefined && import.meta.url === pathToFileURL(commandPath).href) {
  importKanjivg(process.argv[2] === undefined ? defaultInputPath : resolve(process.argv[2])).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
