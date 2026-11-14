import { getStroke } from 'perfect-freehand';

import type { Point, Stroke } from '../domain/types';

/** Drawing coordinates are normalized to 0–1 and rendered in a square box of this size. */
export const VIEW_SIZE = 1000;

/** Brush tuning, in view-box units. Adjust here; rendering derives everything from these. */
export const BRUSH = {
  /** Diameter at full pressure. Half pressure draws at half of this. */
  size: 36,
  /** How strongly pressure (pen) or speed (mouse/touch) changes the width. */
  thinning: 0.42,
  /** Softening of the outline edges. */
  smoothing: 0.6,
  /**
   * Stabilizer: how much hand jitter is absorbed. Kept light because the path is already
   * smoothed by the spline before it reaches the brush.
   */
  streamline: 0.2,
  /** Length of the tapered tail at the end of a stroke. */
  endTaper: 55,
  /** Radius of a tap (single-point stroke). */
  dotRadius: 12,
} as const;

const FALLBACK_PRESSURE = 0.5;
/** Rendered points are spaced evenly at this fraction of the brush diameter. */
const SPACING_RATIO = 0.25;
/** Pressure is averaged over this many neighbouring points on each side. */
const PRESSURE_WINDOW = 2;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Builds a stored point: clamped, and rounded so saved drafts stay small. */
export function makePoint(x: number, y: number, pressure: number, elapsedMs: number): Point {
  return {
    x: roundTo(clamp01(x), 4),
    y: roundTo(clamp01(y), 4),
    p: roundTo(clamp01(pressure), 2),
    t: Math.max(0, Math.round(elapsedMs)),
  };
}

function format(value: number): string {
  return String(roundTo(value, 1));
}

function dotPath(point: Point): string {
  const cx = point.x * VIEW_SIZE;
  const cy = point.y * VIEW_SIZE;
  const r = BRUSH.dotRadius;
  const d = String(r * 2);
  return `M${format(cx - r)} ${format(cy)} a${String(r)} ${String(r)} 0 1 0 ${d} 0 a${String(r)} ${String(r)} 0 1 0 -${d} 0 Z`;
}

/** Closed path through the outline, curving through the midpoints of consecutive points. */
function outlineToPath(outline: readonly number[][]): string {
  const first = outline[0];
  if (first === undefined || outline.length < 3) return '';
  const [firstX = 0, firstY = 0] = first;
  let path = `M${format(firstX)} ${format(firstY)} Q`;
  for (let index = 0; index < outline.length; index += 1) {
    const [x0 = 0, y0 = 0] = outline[index] ?? [];
    const [x1 = 0, y1 = 0] = outline[(index + 1) % outline.length] ?? [];
    path += `${format(x0)} ${format(y0)} ${format((x0 + x1) / 2)} ${format((y0 + y1) / 2)} `;
  }
  return `${path}Z`;
}

interface BrushPoint {
  readonly x: number;
  readonly y: number;
  readonly p: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function gap(a: BrushPoint, b: BrushPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Point at `t` (0–1) between p1 and p2 on a centripetal Catmull–Rom spline. The centripetal
 * form follows sharp turns, such as the corner of 口, without loops or overshoot.
 */
function catmullRom(
  p0: BrushPoint,
  p1: BrushPoint,
  p2: BrushPoint,
  p3: BrushPoint,
  t: number,
): BrushPoint {
  const knot = (a: BrushPoint, b: BrushPoint) => Math.max(Math.sqrt(gap(a, b)), 1e-4);
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = lerp(t1, t2, t);
  const mix = (a: BrushPoint, b: BrushPoint, from: number, to: number): BrushPoint => {
    const w = (u - from) / (to - from);
    return { x: lerp(a.x, b.x, w), y: lerp(a.y, b.y, w), p: lerp(a.p, b.p, w) };
  };
  const a1 = mix(p0, p1, 0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, 0, t2);
  const b2 = mix(a2, a3, t1, t3);
  const point = mix(b1, b2, t1, t2);
  // Pressure follows the segment linearly; the spline is only for position.
  return { ...point, p: lerp(p1.p, p2.p, t) };
}

/** A smooth curve through the samples, densely subdivided. */
function splineThrough(points: readonly BrushPoint[], step: number): BrushPoint[] {
  const result: BrushPoint[] = [points[0] as BrushPoint];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const p1 = points[index] as BrushPoint;
    const p2 = points[index + 1] as BrushPoint;
    // Mirror the ends so the first and last segments have a neighbour on each side.
    const p0 = points[index - 1] ?? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, p: p1.p };
    const p3 = points[index + 2] ?? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, p: p2.p };
    const parts = Math.max(1, Math.ceil(gap(p1, p2) / step));
    for (let part = 1; part <= parts; part += 1) {
      result.push(catmullRom(p0, p1, p2, p3, part / parts));
    }
  }
  return result;
}

/** Points spaced evenly along the curve, so the outline does not depend on sample density. */
function evenlySpaced(points: readonly BrushPoint[], spacing: number): BrushPoint[] {
  const first = points[0] as BrushPoint;
  const result: BrushPoint[] = [first];
  let carried = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as BrushPoint;
    const to = points[index] as BrushPoint;
    const length = gap(from, to);
    let travelled = spacing - carried;
    while (travelled <= length) {
      const t = travelled / length;
      result.push({ x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), p: lerp(from.p, to.p, t) });
      travelled += spacing;
    }
    carried = length - (travelled - spacing);
  }
  const last = points[points.length - 1] as BrushPoint;
  if (gap(result[result.length - 1] as BrushPoint, last) > spacing * 0.25) result.push(last);
  return result;
}

/** Averages pressure over neighbouring points to remove ripples in the stroke width. */
function smoothPressure(points: readonly BrushPoint[]): BrushPoint[] {
  return points.map((point, index) => {
    let total = 0;
    let count = 0;
    for (let offset = -PRESSURE_WINDOW; offset <= PRESSURE_WINDOW; offset += 1) {
      const neighbour = points[index + offset];
      if (neighbour !== undefined) {
        total += neighbour.p;
        count += 1;
      }
    }
    return { ...point, p: total / count };
  });
}

/** The stroke as evenly spaced brush points in view-box units. */
export function brushPoints(stroke: Stroke): BrushPoint[] {
  const points = stroke.map((point) => ({
    x: point.x * VIEW_SIZE,
    y: point.y * VIEW_SIZE,
    p: point.p ?? FALLBACK_PRESSURE,
  }));
  if (points.length < 2) return points;
  const spacing = BRUSH.size * SPACING_RATIO;
  return smoothPressure(evenlySpaced(splineThrough(points, spacing / 2), spacing));
}

/** Outline polygon of the filled brush shape, in view-box units. */
export function strokeOutline(stroke: Stroke, complete: boolean): number[][] {
  // Strokes saved before pressure was recorded fall back to speed estimated from spacing.
  const hasPressure = stroke.every((point) => point.p !== undefined);
  return getStroke(
    brushPoints(stroke).map((point) => [point.x, point.y, point.p]),
    {
      size: BRUSH.size,
      thinning: BRUSH.thinning,
      smoothing: BRUSH.smoothing,
      streamline: BRUSH.streamline,
      simulatePressure: !hasPressure,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: BRUSH.endTaper },
      last: complete,
    },
  );
}

/**
 * SVG path data for the filled brush shape of a stroke. `complete` finishes the tail; pass
 * false while the stroke is still being drawn.
 */
export function strokeOutlinePath(stroke: Stroke, complete: boolean): string {
  const first = stroke[0];
  if (first === undefined) return '';
  if (stroke.length === 1) return dotPath(first);
  return outlineToPath(strokeOutline(stroke, complete)) || dotPath(first);
}
