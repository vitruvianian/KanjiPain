import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { KANJIDIC_DOWNLOAD_URL, stableJson } from './catalog-pipeline';

const defaultOutputPath = resolve('data/raw/kanjidic2.xml.gz');

async function writeAtomically(path: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${String(process.pid)}`;

  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function fetchKanjidic(outputPath = defaultOutputPath): Promise<void> {
  const response = await fetch(KANJIDIC_DOWNLOAD_URL, {
    headers: { 'user-agent': 'KanjiPain catalog maintenance' },
  });
  if (!response.ok) {
    throw new Error(
      `Could not download KANJIDIC2: ${String(response.status)} ${response.statusText}.`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const retrievedAt = Date.now();
  const metadataPath = outputPath.replace(/\.xml\.gz$/, '.metadata.json');
  const metadata = {
    sourceUrl: KANJIDIC_DOWNLOAD_URL,
    retrievedAt,
    lastModified: response.headers.get('last-modified'),
    etag: response.headers.get('etag'),
    contentLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };

  await writeAtomically(outputPath, bytes);
  await writeAtomically(metadataPath, stableJson(metadata));
  console.log(`Downloaded KANJIDIC2 to ${outputPath} (${String(bytes.byteLength)} bytes).`);
}

const commandPath = process.argv[1];
if (commandPath !== undefined && import.meta.url === pathToFileURL(commandPath).href) {
  fetchKanjidic(process.argv[2] === undefined ? defaultOutputPath : resolve(process.argv[2])).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
