/**
 * Calibrates the handwriting checker against its own reference data: every character is
 * redrawn with simulated hand error and must be accepted as itself, and must not be
 * accepted as its nearest look-alikes. Run with `npm run checker:selftest`.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Stroke } from '../src/domain/types';
import { checkDrawing, referenceDistance, type CheckVerdict } from '../src/recognition/check';
import { resample } from '../src/recognition/geometry';
import { ReferenceStrokes, type ReferenceStrokeData } from '../src/recognition/reference-data';

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sloppiness {
  readonly name: string;
  /** Per-stroke shift, as a fraction of the character size. */
  readonly shift: number;
  /** Per-stroke scale change. */
  readonly stretch: number;
  /** Per-stroke rotation in radians. */
  readonly turn: number;
  /** Per-point wobble. */
  readonly wobble: number;
}

const LEVELS: readonly Sloppiness[] = [
  { name: 'neat', shift: 0.02, stretch: 0.08, turn: 0.05, wobble: 0.004 },
  { name: 'rough', shift: 0.045, stretch: 0.18, turn: 0.12, wobble: 0.008 },
];

/** Redraws reference strokes the way a hand would: smaller, off-centre and imprecise. */
function redraw(
  strokes: readonly (readonly { x: number; y: number }[])[],
  level: Sloppiness,
  random: () => number,
): Stroke[] {
  const spread = (amount: number) => (random() * 2 - 1) * amount;
  const size = 0.6 + random() * 0.35;
  const offsetX = random() * (1 - size);
  const offsetY = random() * (1 - size);
  return strokes.map((stroke) => {
    const points = resample(stroke, 20);
    const centreX = points.reduce((total, point) => total + point.x, 0) / points.length;
    const centreY = points.reduce((total, point) => total + point.y, 0) / points.length;
    const scale = 1 + spread(level.stretch);
    const angle = spread(level.turn);
    const shiftX = spread(level.shift);
    const shiftY = spread(level.shift);
    return points.map((point) => {
      const dx = (point.x - centreX) * scale;
      const dy = (point.y - centreY) * scale;
      const x = centreX + dx * Math.cos(angle) - dy * Math.sin(angle) + shiftX;
      const y = centreY + dx * Math.sin(angle) + dy * Math.cos(angle) + shiftY;
      return {
        x: Math.max(0, Math.min(1, offsetX + size * (x + spread(level.wobble)))),
        y: Math.max(0, Math.min(1, offsetY + size * (y + spread(level.wobble)))),
      };
    });
  });
}

function percent(part: number, whole: number): string {
  return `${((100 * part) / Math.max(1, whole)).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const data = JSON.parse(
    await readFile(resolve('src/data/strokes.generated.json'), 'utf8'),
  ) as ReferenceStrokeData;
  const catalog = JSON.parse(await readFile(resolve('src/data/kanji.generated.json'), 'utf8')) as {
    id: string;
    literal: string;
  }[];
  const literal = new Map(catalog.map((entry) => [entry.id, entry.literal]));
  const references = new ReferenceStrokes(data);
  const step = Number(process.argv[2] ?? 1);
  const ids = Object.keys(data).filter((_, index) => index % step === 0);
  const started = Date.now();

  for (const level of LEVELS) {
    const random = randomSource(20261114);
    const own = new Map<CheckVerdict, number>();
    const swapped = new Map<CheckVerdict, number>();
    const reversed = new Map<CheckVerdict, number>();
    const asNeighbour = new Map<CheckVerdict, number>();
    const confusable: string[] = [];
    const rejected: string[] = [];
    let swappedTotal = 0;
    let neighbourTotal = 0;
    let droppedClose = 0;
    let droppedTotal = 0;
    let joinedClose = 0;
    let joinedTotal = 0;
    const bump = (map: Map<CheckVerdict, number>, verdict: CheckVerdict) =>
      map.set(verdict, (map.get(verdict) ?? 0) + 1);

    for (const id of ids) {
      const strokes = references.strokesFor(id) ?? [];
      const drawing = redraw(strokes, level, random);

      const result = checkDrawing(drawing, id, references);
      if (result === null) throw new Error(`No result for ${id}.`);
      bump(own, result.verdict);
      if (result.verdict !== 'match') {
        rejected.push(`${literal.get(id) ?? id}:${result.verdict}`);
      }

      bump(
        reversed,
        checkDrawing([[...(drawing[0] ?? [])].reverse(), ...drawing.slice(1)], id, references)
          ?.verdict ?? 'mismatch',
      );

      if (drawing.length >= 2) {
        const [first = [], second = [], ...rest] = drawing;
        swappedTotal += 1;
        bump(
          swapped,
          checkDrawing([second, first, ...rest], id, references)?.verdict ?? 'mismatch',
        );
        droppedTotal += 1;
        const dropped = checkDrawing(drawing.slice(1), id, references);
        if (dropped?.shapeClose === true) droppedClose += 1;
        // Join the first pair of consecutive strokes that nearly touch, as a fast hand would.
        const touching = drawing.findIndex((stroke, index) => {
          const end = stroke.at(-1);
          const next = drawing[index + 1]?.[0];
          return (
            end !== undefined &&
            next !== undefined &&
            Math.hypot(end.x - next.x, end.y - next.y) < 0.04
          );
        });
        if (touching >= 0) {
          joinedTotal += 1;
          const joined = [
            ...drawing.slice(0, touching),
            [...(drawing[touching] ?? []), ...(drawing[touching + 1] ?? [])],
            ...drawing.slice(touching + 2),
          ];
          if (checkDrawing(joined, id, references)?.shapeClose === true) joinedClose += 1;
        }
      }

      // The three same-count characters whose shapes are closest to this one.
      const neighbours = references
        .idsWithStrokeCount(strokes.length)
        .filter((other) => other !== id)
        .map((other) => ({
          other,
          gap: referenceDistance(references, id, other),
        }))
        .sort((a, b) => a.gap - b.gap)
        .slice(0, 3);
      for (const { other } of neighbours) {
        neighbourTotal += 1;
        const verdict = checkDrawing(drawing, other, references)?.verdict ?? 'mismatch';
        bump(asNeighbour, verdict);
        if (verdict === 'match' || verdict === 'order' || verdict === 'direction') {
          confusable.push(`${literal.get(id) ?? id}→${literal.get(other) ?? other}`);
        }
      }
    }

    const show = (map: Map<CheckVerdict, number>, total: number) =>
      [...map]
        .sort((a, b) => b[1] - a[1])
        .map(([verdict, count]) => `${verdict} ${percent(count, total)}`)
        .join(', ');
    console.log(`\n=== ${level.name} handwriting (${String(ids.length)} characters) ===`);
    console.log(`Drawn as itself:           ${show(own, ids.length)}`);
    console.log(`First stroke reversed:     ${show(reversed, ids.length)}`);
    console.log(`First two strokes swapped: ${show(swapped, swappedTotal)}`);
    console.log(
      `First stroke left out:     shape still "close" ${percent(droppedClose, droppedTotal)}`,
    );
    console.log(
      `Two touching strokes joined: shape still "close" ${percent(joinedClose, joinedTotal)} of ${String(joinedTotal)}`,
    );
    console.log(`Checked as a look-alike:   ${show(asNeighbour, neighbourTotal)}`);
    console.log(
      `Wrongly rejected (${String(rejected.length)}): ${rejected.slice(0, 40).join(' ')}`,
    );
    console.log(
      `Wrongly accepted (${String(confusable.length)}): ${confusable.slice(0, 60).join(' ')}`,
    );
  }
  console.log(`\nFinished in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
