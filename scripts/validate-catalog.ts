import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { catalogManifestSchema, teachingNotesSchema } from '../src/domain/schemas';
import {
  datasetVersion,
  EXPECTED_JOYO_COUNT,
  sha256,
  validateProductionCatalog,
} from './catalog-pipeline';

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

  console.log(
    `Validated ${String(catalog.length)} unique Jōyō kanji (dataset ${manifest.datasetVersion}).`,
  );
}

const commandPath = process.argv[1];
if (commandPath !== undefined && import.meta.url === pathToFileURL(commandPath).href) {
  validateGeneratedCatalog().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
