import type { KanjiId } from '../domain/types';

/** Reference coordinates are stored on a 0–255 grid, two hex digits each. */
export const REFERENCE_GRID = 255;

/** Reference strokes per kanji ID, in stroke order, each encoded as `xxyyxxyy…` hex. */
export type ReferenceStrokeData = Readonly<Record<string, readonly string[]>>;

export interface ReferencePoint {
  readonly x: number;
  readonly y: number;
}

export type ReferenceStroke = readonly ReferencePoint[];

export function decodeStroke(encoded: string): ReferenceStroke {
  const points: ReferencePoint[] = [];
  for (let index = 0; index + 4 <= encoded.length; index += 4) {
    points.push({
      x: Number.parseInt(encoded.slice(index, index + 2), 16) / REFERENCE_GRID,
      y: Number.parseInt(encoded.slice(index + 2, index + 4), 16) / REFERENCE_GRID,
    });
  }
  return points;
}

/** Decoded reference strokes with lookup by character and by stroke count. */
export class ReferenceStrokes {
  readonly #data: ReferenceStrokeData;
  readonly #decoded = new Map<string, readonly ReferenceStroke[]>();
  readonly #byCount = new Map<number, KanjiId[]>();

  constructor(data: ReferenceStrokeData) {
    this.#data = data;
    for (const [id, strokes] of Object.entries(data)) {
      const group = this.#byCount.get(strokes.length);
      if (group === undefined) this.#byCount.set(strokes.length, [id]);
      else group.push(id);
    }
  }

  get size(): number {
    return Object.keys(this.#data).length;
  }

  strokesFor(id: KanjiId): readonly ReferenceStroke[] | undefined {
    const cached = this.#decoded.get(id);
    if (cached !== undefined) return cached;
    const encoded = this.#data[id];
    if (encoded === undefined) return undefined;
    const decoded = encoded.map(decodeStroke);
    this.#decoded.set(id, decoded);
    return decoded;
  }

  /** IDs of every character written with exactly this many strokes. */
  idsWithStrokeCount(count: number): readonly KanjiId[] {
    return this.#byCount.get(count) ?? [];
  }
}
