import { kanjiIdFromLiteral } from '../src/domain/ids';
import type { KanjiEntry, KanjiId } from '../src/domain/types';
import { lookalikeCost } from '../src/recognition/check';
import {
  REFERENCE_GRID,
  strokeShardKey,
  type ReferenceStrokeData,
  type ReferenceStrokes,
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

/** One `<g>` group of a KanjiVG character: a component, with the strokes inside it. */
export interface ComponentNode {
  readonly element: string | undefined;
  readonly original: string | undefined;
  readonly position: string | undefined;
  readonly children: readonly ComponentNode[];
  /** Strokes anywhere inside this group. */
  readonly strokeCount: number;
  /** Strokes directly inside this group, outside any subgroup. */
  readonly ownStrokes: number;
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

/** Reads each character's component tree, keyed by lowercase hex code point. */
export function parseKanjivgComponents(xml: string): Map<string, ComponentNode> {
  const characters = new Map<string, ComponentNode>();
  for (const block of xml.matchAll(/<kanji id="kvg:kanji_([0-9a-f]+)">([\s\S]*?)<\/kanji>/g)) {
    const [, codePoint = '', body = ''] = block;
    interface Building {
      tag: string;
      children: ComponentNode[];
      ownStrokes: number;
    }
    const stack: Building[] = [{ tag: '', children: [], ownStrokes: 0 }];
    for (const [tag] of body.matchAll(/<\/?g\b[^>]*>|<path\b[^>]*>/g)) {
      const top = stack.at(-1);
      if (top === undefined) break;
      if (tag.startsWith('<path')) {
        top.ownStrokes += 1;
      } else if (tag.startsWith('</g')) {
        stack.pop();
        const parent = stack.at(-1);
        const children = top.children;
        parent?.children.push({
          element: attribute(top.tag, 'kvg:element'),
          original: attribute(top.tag, 'kvg:original'),
          position: attribute(top.tag, 'kvg:position'),
          children,
          strokeCount:
            top.ownStrokes + children.reduce((total, child) => total + child.strokeCount, 0),
          ownStrokes: top.ownStrokes,
        });
      } else {
        stack.push({ tag, children: [], ownStrokes: 0 });
      }
    }
    const root = stack[0]?.children[0];
    if (root !== undefined) characters.set(codePoint.replace(/^0+/, ''), root);
  }
  return characters;
}

const POSITION_LABELS: Readonly<Record<string, string>> = {
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
  middle: 'Middle',
  kamae: 'Enclosure',
  tare: 'Upper-left cover',
  nyo: 'Lower-left wrap',
  // What an enclosure, cover or wrap holds.
  kamaec: 'Inside',
  tarec: 'Inside',
  nyoc: 'Inside',
};

/** Positions of parts that hold another part; an unpositioned sibling is what they hold. */
const HOLDERS = new Set(['kamae', 'tare', 'nyo']);

/**
 * English names for common components that are not Jōyō kanji themselves, or whose Jōyō
 * meaning would mislead as a component name.
 */
export const COMPONENT_NAMES: Readonly<Record<string, string>> = {
  亻: 'person',
  氵: 'water',
  扌: 'hand',
  忄: 'heart',
  犭: 'dog',
  礻: 'altar',
  衤: 'clothing',
  訁: 'words',
  飠: 'food',
  釒: 'metal',
  糹: 'thread',
  刂: 'sword',
  灬: 'fire',
  艹: 'grass',
  '⺾': 'grass',
  辶: 'movement',
  '⻌': 'movement',
  '⻍': 'movement',
  廴: 'long stride',
  宀: 'roof',
  冖: 'cover',
  亠: 'lid',
  广: 'dotted cliff',
  厂: 'cliff',
  疒: 'sickness',
  尸: 'corpse',
  彳: 'step',
  冫: 'ice',
  阝: 'mound',
  '⻖': 'mound',
  '⻏': 'village',
  攵: 'strike',
  攴: 'strike',
  殳: 'weapon',
  彡: 'hair',
  罒: 'net',
  癶: 'footsteps',
  夂: 'winter',
  匚: 'box',
  匸: 'box',
  冂: 'open box',
  囗: 'enclosure',
  勹: 'wrap',
  卩: 'seal',
  '⺋': 'seal',
  爫: 'claw',
  '⺍': 'small',
  '⺌': 'small',
  丷: 'horns',
  '⺧': 'cow',
  牜: 'cow',
  '𧾷': 'foot',
  '⻊': 'foot',
  歹: 'death',
  隹: 'small bird',
  豕: 'pig',
  豸: 'badger',
  頁: 'head',
  疋: 'bolt of cloth',
  '⺮': 'bamboo',
  '⺶': 'sheep',
  '⺷': 'sheep',
  王: 'king',
  '⺩': 'jewel',
  '𤣩': 'jewel',
  月: 'moon',
  '⺼': 'flesh',
  尢: 'lame',
  屮: 'sprout',
  巛: 'river',
  弋: 'ceremony',
  彐: 'snout',
  '⺕': 'snout',
  戈: 'halberd',
  斤: 'axe',
  曰: 'say',
  欠: 'yawn',
  毋: 'mother',
  氏: 'clan',
  爻: 'mix',
  爿: 'split wood',
  片: 'slice',
  禸: 'track',
  耒: 'plough',
  襾: 'cover',
  覀: 'cover',
  臼: 'mortar',
  舛: 'oppose',
  艮: 'stopping',
  虍: 'tiger',
  聿: 'brush',
  酉: 'wine jar',
  釆: 'divide',
  靑: 'blue',
  韋: 'leather',
  黹: 'embroidery',
  鬲: 'cauldron',
  鬯: 'herbs',
  儿: 'legs',
  几: 'table',
  凵: 'container',
  匕: 'spoon',
  厶: 'private',
  亅: 'hook',
  乙: 'second',
  丶: 'dot',
  丿: 'slash',
  丨: 'line',
  一: 'one',
  '⺊': 'divination',
  卜: 'divination',
  冊: 'book',
  夊: 'go slowly',
  幺: 'short thread',
  廾: 'two hands',
  无: 'not',
  旡: 'choke',
  辛: 'bitter',
  辰: 'dragon sign',
  巳: 'snake sign',
  已: 'already',
  己: 'self',
};

/** A component's name: its own Jōyō meaning, or the name of its original form. */
function componentName(
  node: ComponentNode,
  meaningOf: (literal: string) => string | undefined,
): string | undefined {
  for (const candidate of [node.element, node.original]) {
    if (candidate === undefined) continue;
    const named = COMPONENT_NAMES[candidate] ?? meaningOf(candidate);
    if (named !== undefined) return named;
  }
  return undefined;
}

function strokesText(count: number): string {
  return `${String(count)} ${count === 1 ? 'stroke' : 'strokes'}`;
}

/**
 * A hint that names a character's main parts by position, without showing them: "Left:
 * water · Right: 6 strokes". Undefined when the character has no clear split into parts.
 */
export function componentHint(
  root: ComponentNode,
  meaningOf: (literal: string) => string | undefined,
): string | undefined {
  let node = root;
  // A single unpositioned wrapper around the real split.
  for (
    let only = node.children[0];
    node.ownStrokes === 0 &&
    node.children.length === 1 &&
    only !== undefined &&
    only.position === undefined;
    only = node.children[0]
  ) {
    node = only;
  }
  if (node.ownStrokes > 0) return undefined;
  const holds = node.children.some(
    (child) => child.position !== undefined && HOLDERS.has(child.position),
  );
  const parts: { label: string; node: ComponentNode; strokes: number }[] = [];
  for (const child of node.children) {
    const label =
      child.position === undefined
        ? holds
          ? 'Inside'
          : undefined
        : POSITION_LABELS[child.position];
    if (label === undefined) return undefined;
    // An enclosure split in two around its contents (囗 in 国) is one part.
    const earlier = parts.find(
      (part) =>
        part.label === label && child.element !== undefined && part.node.element === child.element,
    );
    if (earlier === undefined) parts.push({ label, node: child, strokes: child.strokeCount });
    else earlier.strokes += child.strokeCount;
  }
  if (parts.length < 2) return undefined;
  return parts
    .map(({ label, node: part, strokes }) => {
      const name = componentName(part, meaningOf);
      return `${label}: ${name ?? strokesText(strokes)}`;
    })
    .join(' · ');
}

/** Component hints for the catalog's characters, keyed by kanji ID, in catalog order. */
export function buildComponentHints(
  xml: string,
  catalog: readonly KanjiEntry[],
): Record<string, string> {
  const trees = parseKanjivgComponents(xml);
  const meanings = new Map(catalog.map((entry) => [entry.literal, entry.meanings[0]]));
  const hints: Record<string, string> = {};
  for (const entry of catalog) {
    const tree = trees.get(entry.literal.codePointAt(0)?.toString(16) ?? '');
    if (tree === undefined) continue;
    const hint = componentHint(tree, (literal) => meanings.get(literal));
    // Never name the character itself, or anything that writes it.
    if (hint !== undefined && !hint.includes(entry.literal)) {
      hints[kanjiIdFromLiteral(entry.literal)] = hint;
    }
  }
  return hints;
}

/** Most look-alikes kept for one character. */
const MAX_LOOKALIKES = 4;

/**
 * Pairs of characters whose written shapes pass the checker as each other, so only its
 * look-alike margin separates them: 未 and 末, 土 and 士. Symmetric, closest first.
 */
export function buildLookalikes(
  references: ReferenceStrokes,
  ids: readonly KanjiId[],
): Record<string, string[]> {
  const scored = new Map<string, Map<string, number>>();
  const add = (from: string, to: string, cost: number) => {
    const row = scored.get(from) ?? new Map<string, number>();
    row.set(to, Math.min(cost, row.get(to) ?? Infinity));
    scored.set(from, row);
  };
  const wanted = new Set(ids);
  for (const id of ids) {
    const count = references.strokesFor(id)?.length ?? 0;
    for (const other of references.idsWithStrokeCount(count)) {
      if (other <= id || !wanted.has(other)) continue;
      const cost = Math.min(
        lookalikeCost(references, id, other),
        lookalikeCost(references, other, id),
      );
      if (Number.isFinite(cost)) {
        add(id, other, cost);
        add(other, id, cost);
      }
    }
  }
  const result: Record<string, string[]> = {};
  for (const id of ids) {
    const row = scored.get(id);
    if (row === undefined) continue;
    result[id] = [...row]
      .sort(([leftId, left], [rightId, right]) => left - right || leftId.localeCompare(rightId))
      .slice(0, MAX_LOOKALIKES)
      .map(([other]) => other);
  }
  return result;
}
