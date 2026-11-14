import type { KanjiId } from '../domain/types';
import { ReferenceStrokes, strokeShardKey, type ReferenceStrokeData } from './reference-data';

let pending: Promise<ReferenceStrokes> | null = null;

/**
 * Loads the reference stroke data once, as its own chunk. A failed load is not cached, so a
 * later call tries again.
 */
export function loadReferenceStrokes(): Promise<ReferenceStrokes> {
  pending ??= import('../data/strokes.generated.json')
    .then((module) => new ReferenceStrokes(module.default))
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}

const shardLoaders = import.meta.glob<ReferenceStrokeData>('../data/stroke-shards/*.json', {
  import: 'default',
});
const shards = new Map<string, Promise<ReferenceStrokeData>>();

function loadShard(key: string): Promise<ReferenceStrokeData> {
  const cached = shards.get(key);
  if (cached !== undefined) return cached;
  const loader = shardLoaders[`../data/stroke-shards/${key}.json`];
  const loading = (loader === undefined ? Promise.resolve({}) : loader()).catch(
    (error: unknown) => {
      shards.delete(key);
      throw error;
    },
  );
  shards.set(key, loading);
  return loading;
}

/**
 * Stroke data for the given characters from the full KanjiVG set, fetching only the shard
 * files they are in. Characters KanjiVG does not cover are simply absent from the result.
 */
export async function loadStrokeData(ids: Iterable<KanjiId>): Promise<ReferenceStrokeData> {
  const wanted = [...new Set(ids)];
  const keys = [...new Set(wanted.map(strokeShardKey))];
  const loaded = new Map(
    await Promise.all(keys.map(async (key) => [key, await loadShard(key)] as const)),
  );
  const data: Record<string, readonly string[]> = {};
  for (const id of wanted) {
    const strokes = loaded.get(strokeShardKey(id))?.[id];
    if (strokes !== undefined) data[id] = strokes;
  }
  return data;
}

/** Answers which characters have stroke data, and how many strokes each has. */
export type StrokeLookup = (ids: readonly KanjiId[]) => Promise<ReadonlyMap<KanjiId, number>>;

export const lookupStrokeCounts: StrokeLookup = async (ids) => {
  const data = await loadStrokeData(ids);
  return new Map(Object.entries(data).map(([id, strokes]) => [id, strokes.length]));
};

let extended: { key: string; references: Promise<ReferenceStrokes> } | null = null;

/**
 * The bundled references plus any of `extraIds` they lack, for characters in custom decks.
 * The latest combination is kept, so one deck's screens share one decoded set.
 */
export async function loadReferenceStrokesWith(
  extraIds: readonly KanjiId[],
): Promise<ReferenceStrokes> {
  const base = await loadReferenceStrokes();
  const missing = [...new Set(extraIds.filter((id) => !base.has(id)))].sort();
  if (missing.length === 0) return base;
  const key = missing.join(',');
  if (extended?.key !== key) {
    const references = loadStrokeData(missing).then((data) => base.extendedWith(data));
    extended = { key, references };
    references.catch(() => {
      if (extended?.key === key) extended = null;
    });
  }
  return extended.references;
}
