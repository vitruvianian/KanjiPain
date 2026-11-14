import { kanjiIdFromLiteral } from '../src/domain/ids';
import type { KanjiEntry } from '../src/domain/types';
import {
  REFERENCE_GRID,
  strokeShardKey,
  type ReferenceStrokeData,
} from '../src/recognition/reference-data';

export const KANJIVG_RELEASE = 'r20260714';
export const KANJIVG_DOWNLOAD_URL = `https://github.com/KanjiVG/kanjivg/releases/download/${KANJIVG_RELEASE}/kanjivg-20260714.xml.gz`;
export const KANJIVG_PROJECT_URL = 'https://kanjivg.tagaini.net';
export const KANJIVG_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/3.0/';

/** KanjiVG draws every character in a square of this many units. */
const SOURCE_SIZE = 109;
const CURVE_SEGMENTS = 16;
/** Simplification tolerance in source units: about half a percent of the character box. */
const SIMPLIFY_TOLERANCE = 0.5;

type Vec = readonly [number, number];

function cubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

const ARGUMENT_COUNTS: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  Z: 0,
};

/** Converts SVG path data into one polyline. KanjiVG strokes are single subpaths. */
export function flattenSvgPath(data: string): Vec[] {
  const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const points: Vec[] = [];
  let position: Vec = [0, 0];
  let start: Vec = [0, 0];
  let previousControl: Vec | null = null;
  let previousCommand = '';
  let index = 0;
  let command = '';

  const read = (): number => {
    const token = tokens[index];
    index += 1;
    const value = Number(token);
    if (token === undefined || Number.isNaN(value)) {
      throw new Error(`Malformed SVG path data: ${data}`);
    }
    return value;
  };

  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (/[a-zA-Z]/.test(token)) {
      command = token;
      index += 1;
    } else if (command === 'M') {
      command = 'L';
    } else if (command === 'm') {
      command = 'l';
    }
    const kind = command.toUpperCase();
    const count = ARGUMENT_COUNTS[kind];
    if (count === undefined) {
      throw new Error(`Unsupported SVG path command "${command}" in: ${data}`);
    }
    const relative = command !== kind;
    const args = Array.from({ length: count }, read);
    const at = (offset: number): Vec => [
      (args[offset] ?? 0) + (relative ? position[0] : 0),
      (args[offset + 1] ?? 0) + (relative ? position[1] : 0),
    ];
    const curveTo = (c1: Vec, c2: Vec, end: Vec) => {
      const from = position;
      for (let step = 1; step <= CURVE_SEGMENTS; step += 1) {
        points.push(cubic(from, c1, c2, end, step / CURVE_SEGMENTS));
      }
      previousControl = c2;
      position = end;
    };
    const reflected = (kinds: string): Vec =>
      previousControl !== null && kinds.includes(previousCommand.toUpperCase())
        ? [2 * position[0] - previousControl[0], 2 * position[1] - previousControl[1]]
        : position;

    switch (kind) {
      case 'M':
        if (points.length > 0) {
          throw new Error(`Stroke has more than one subpath: ${data}`);
        }
        position = at(0);
        start = position;
        points.push(position);
        break;
      case 'L':
        position = at(0);
        points.push(position);
        break;
      case 'H':
        position = [(args[0] ?? 0) + (relative ? position[0] : 0), position[1]];
        points.push(position);
        break;
      case 'V':
        position = [position[0], (args[0] ?? 0) + (relative ? position[1] : 0)];
        points.push(position);
        break;
      case 'C':
        curveTo(at(0), at(2), at(4));
        break;
      case 'S':
        curveTo(reflected('CS'), at(0), at(2));
        break;
      case 'Q': {
        const control = at(0);
        const end = at(2);
        const from = position;
        // Exact conversion of a quadratic curve to a cubic one.
        curveTo(
          [from[0] + (2 / 3) * (control[0] - from[0]), from[1] + (2 / 3) * (control[1] - from[1])],
          [end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1])],
          end,
        );
        previousControl = control;
        break;
      }
      case 'T': {
        const control = reflected('QT');
        const end = at(0);
        const from = position;
        curveTo(
          [from[0] + (2 / 3) * (control[0] - from[0]), from[1] + (2 / 3) * (control[1] - from[1])],
          [end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1])],
          end,
        );
        previousControl = control;
        break;
      }
      default:
        position = start;
        points.push(position);
    }
    if (kind !== 'C' && kind !== 'S' && kind !== 'Q' && kind !== 'T') previousControl = null;
    previousCommand = command;
  }

  if (points.length === 0) throw new Error(`Empty SVG path data: ${data}`);
  return points;
}

function segmentDistance(point: Vec, from: Vec, to: Vec): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared),
        );
  return Math.hypot(point[0] - (from[0] + t * dx), point[1] - (from[1] + t * dy));
}

/** Ramer–Douglas–Peucker: drops points that stay within `tolerance` of the simplified line. */
export function simplifyPolyline(points: readonly Vec[], tolerance: number): Vec[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || points.length < 3) return [...points];
  let farthest = 0;
  let farthestDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = segmentDistance(points[index] ?? first, first, last);
    if (distance > farthestDistance) {
      farthest = index;
      farthestDistance = distance;
    }
  }
  if (farthestDistance <= tolerance) return [first, last];
  const head = simplifyPolyline(points.slice(0, farthest + 1), tolerance);
  const tail = simplifyPolyline(points.slice(farthest), tolerance);
  return [...head.slice(0, -1), ...tail];
}

function hexByte(value: number): string {
  const scaled = Math.round(
    (Math.max(0, Math.min(SOURCE_SIZE, value)) / SOURCE_SIZE) * REFERENCE_GRID,
  );
  return scaled.toString(16).padStart(2, '0');
}

/** One stroke as a hex string: two digits per coordinate, x then y, on a 0–255 grid. */
export function encodeStroke(pathData: string): string {
  return simplifyPolyline(flattenSvgPath(pathData), SIMPLIFY_TOLERANCE)
    .map(([x, y]) => `${hexByte(x)}${hexByte(y)}`)
    .join('');
}

/** Reads every character's stroke paths, in stroke order, keyed by lowercase hex code point. */
export function parseKanjivgXml(xml: string): Map<string, string[]> {
  const characters = new Map<string, string[]>();
  for (const block of xml.matchAll(/<kanji id="kvg:kanji_([0-9a-f]+)">([\s\S]*?)<\/kanji>/g)) {
    const [, codePoint = '', body = ''] = block;
    const strokes = [...body.matchAll(/<path\b[^>]*>/g)]
      .map(([tag]) => ({
        order: Number(/\bid="kvg:[0-9a-f]+-s(\d+)"/.exec(tag)?.[1]),
        data: /\sd="([^"]*)"/.exec(tag)?.[1],
      }))
      .sort((a, b) => a.order - b.order);
    strokes.forEach((stroke, position) => {
      if (stroke.data === undefined || stroke.order !== position + 1) {
        throw new Error(`KanjiVG character ${codePoint} has an unreadable stroke sequence.`);
      }
    });
    characters.set(
      codePoint.replace(/^0+/, ''),
      strokes.map((stroke) => stroke.data ?? ''),
    );
  }
  return characters;
}

export interface StrokeCountDifference {
  readonly id: string;
  readonly literal: string;
  readonly catalog: number;
  readonly kanjivg: number;
}

export interface ReferenceStrokeBuild {
  readonly data: ReferenceStrokeData;
  readonly strokeTotal: number;
  readonly strokeCountDifferences: StrokeCountDifference[];
}

/** Builds reference strokes for exactly the catalog's characters; fails if any is missing. */
export function buildReferenceStrokes(
  xml: string,
  catalog: readonly KanjiEntry[],
): ReferenceStrokeBuild {
  const source = parseKanjivgXml(xml);
  const data: Record<string, string[]> = {};
  const strokeCountDifferences: StrokeCountDifference[] = [];
  const missing: string[] = [];
  let strokeTotal = 0;

  for (const entry of catalog) {
    const codePoint = entry.literal.codePointAt(0)?.toString(16) ?? '';
    const paths = source.get(codePoint);
    if (paths === undefined || paths.length === 0) {
      missing.push(entry.literal);
      continue;
    }
    const id = kanjiIdFromLiteral(entry.literal);
    data[id] = paths.map(encodeStroke);
    strokeTotal += paths.length;
    if (paths.length !== entry.strokeCount) {
      strokeCountDifferences.push({
        id,
        literal: entry.literal,
        catalog: entry.strokeCount,
        kanjivg: paths.length,
      });
    }
  }

  if (missing.length > 0) {
    throw new Error(`KanjiVG has no stroke data for: ${missing.join(' ')}`);
  }
  return { data, strokeTotal, strokeCountDifferences };
}

export interface StrokeShardBuild {
  /** Shard key to that shard's characters, both in sorted order. */
  readonly shards: ReadonlyMap<string, ReferenceStrokeData>;
  readonly entryCount: number;
  readonly strokeTotal: number;
}

/**
 * Builds reference strokes for every character in KanjiVG, split into shard files so custom
 * decks can fetch stroke order for characters outside the bundled catalog.
 */
export function buildStrokeShards(xml: string): StrokeShardBuild {
  const grouped = new Map<string, [string, string[]][]>();
  let entryCount = 0;
  let strokeTotal = 0;

  for (const [codePoint, paths] of parseKanjivgXml(xml)) {
    if (paths.length === 0) continue;
    const id = kanjiIdFromLiteral(String.fromCodePoint(Number.parseInt(codePoint, 16)));
    const key = strokeShardKey(id);
    const group = grouped.get(key) ?? [];
    group.push([id, paths.map(encodeStroke)]);
    grouped.set(key, group);
    entryCount += 1;
    strokeTotal += paths.length;
  }

  const shards = new Map(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, group]) => [
        key,
        Object.fromEntries(group.sort(([left], [right]) => left.localeCompare(right))),
      ]),
  );
  return { shards, entryCount, strokeTotal };
}
