import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { z } from 'zod';

import { catalogManifestSchema, teachingNotesSchema } from '../src/domain/schemas';
import {
  datasetVersion,
  KANJIDIC_DOCUMENTATION_URL,
  KANJIDIC_DOWNLOAD_URL,
  KANJIDIC_LICENSE_URL,
  normalizeKanjidicXml,
  sha256,
  stableJson,
  validateProductionCatalog,
} from './catalog-pipeline';

const defaultInputPath = resolve('data/raw/kanjidic2.xml.gz');
const catalogOutputPath = resolve('src/data/kanji.generated.json');
const manifestOutputPath = resolve('src/data/catalog-manifest.json');
const teachingNotesPath = resolve('src/data/teaching-notes.json');

const fetchMetadataSchema = z.strictObject({
  sourceUrl: z.url(),
  retrievedAt: z.number().int().nonnegative(),
  lastModified: z.string().nullable(),
  etag: z.string().nullable(),
  contentLength: z.number().int().positive(),
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

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
}

async function readFetchMetadata(inputPath: string) {
  const metadataPath = inputPath.replace(/\.xml\.gz$/, '.metadata.json');
  try {
    const metadataText = await readFile(metadataPath, 'utf8');
    return fetchMetadataSchema.parse(parseJson(metadataText, metadataPath));
  } catch (error) {
    const inputStats = await stat(inputPath);
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
      throw error;
    }
    return {
      sourceUrl: KANJIDIC_DOWNLOAD_URL,
      retrievedAt: Math.trunc(inputStats.mtimeMs),
      lastModified: null,
      etag: null,
      contentLength: inputStats.size,
      sha256: '',
    };
  }
}

export async function importKanjidic(inputPath = defaultInputPath): Promise<void> {
  const inputBytes = new Uint8Array(await readFile(inputPath));
  const inputSha256 = sha256(inputBytes);
  const metadata = await readFetchMetadata(inputPath);
  if (metadata.sha256 !== '' && metadata.sha256 !== inputSha256) {
    throw new Error('Downloaded KANJIDIC2 bytes do not match their recorded SHA-256 hash.');
  }

  let xml: string;
  try {
    xml = gunzipSync(inputBytes).toString('utf8');
  } catch (error) {
    throw new Error(`Could not decompress KANJIDIC2 input: ${inputPath}.`, { cause: error });
  }

  const catalog = normalizeKanjidicXml(xml);
  const teachingNotesBytes = await readFile(teachingNotesPath);
  const teachingNotesText = teachingNotesBytes.toString('utf8');
  const teachingNotes = teachingNotesSchema.parse(parseJson(teachingNotesText, teachingNotesPath));
  validateProductionCatalog(catalog, teachingNotes);

  const catalogText = stableJson(catalog);
  const catalogSha256 = sha256(catalogText);
  const teachingNotesSha256 = sha256(teachingNotesBytes);
  const manifest = catalogManifestSchema.parse({
    schemaVersion: 1,
    datasetVersion: datasetVersion(catalogSha256, teachingNotesSha256),
    entryCount: catalog.length,
    generatedAt: Date.now(),
    catalogSha256,
    teachingNotesSha256,
    source: {
      name: 'KANJIDIC2',
      downloadUrl: KANJIDIC_DOWNLOAD_URL,
      documentationUrl: KANJIDIC_DOCUMENTATION_URL,
      licenseUrl: KANJIDIC_LICENSE_URL,
      license: 'CC BY-SA 4.0',
      retrievedAt: metadata.retrievedAt,
      upstreamDate: metadata.lastModified,
      inputSha256,
    },
  });

  await writeAtomically(catalogOutputPath, catalogText);
  await writeAtomically(manifestOutputPath, stableJson(manifest));
  console.log(
    `Imported ${String(catalog.length)} Jōyō kanji (dataset ${manifest.datasetVersion}).`,
  );
}

const commandPath = process.argv[1];
if (commandPath !== undefined && import.meta.url === pathToFileURL(commandPath).href) {
  importKanjidic(process.argv[2] === undefined ? defaultInputPath : resolve(process.argv[2])).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
