import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { stableJson } from './catalog-pipeline';
import { KANJIVG_DOWNLOAD_URL, KANJIVG_RELEASE } from './kanjivg-pipeline';

const defaultOutputPath = resolve('data/raw/kanjivg.xml.gz');

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

export async function fetchKanjivg(outputPath = defaultOutputPath): Promise<void> {
  const response = await fetch(KANJIVG_DOWNLOAD_URL, {
    headers: { 'user-agent': 'KanjiPain catalog maintenance' },
  });
  if (!response.ok) {
    throw new Error(
      `Could not download KanjiVG: ${String(response.status)} ${response.statusText}.`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const metadata = {
    sourceUrl: KANJIVG_DOWNLOAD_URL,
    release: KANJIVG_RELEASE,
    retrievedAt: Date.now(),
    contentLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };

  await writeAtomically(outputPath, bytes);
  await writeAtomically(outputPath.replace(/\.xml\.gz$/, '.metadata.json'), stableJson(metadata));
  console.log(`Downloaded KanjiVG to ${outputPath} (${String(bytes.byteLength)} bytes).`);
}

const commandPath = process.argv[1];
if (commandPath !== undefined && import.meta.url === pathToFileURL(commandPath).href) {
  fetchKanjivg(process.argv[2] === undefined ? defaultOutputPath : resolve(process.argv[2])).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
