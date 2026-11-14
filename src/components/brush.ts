import { getStroke } from 'perfect-freehand';

import type { Point, Stroke } from '../domain/types';

/** Drawing coordinates are normalized to 0–1 and rendered in a square box of this size. */
export const VIEW_SIZE = 1000;

/** Brush tuning, in view-box units. Adjust here; rendering derives everything from these. */
export const BRUSH = {
  /** Diameter at full pressure. Half pressure draws at half of this. */
  size: 36,
  /** How strongly pressure (pen) or speed (mouse/touch) changes the width. */
  thinning: 0.62,
  /** Softening of the outline edges. */
  smoothing: 0.55,
  /** Stabilizer: how much hand jitter is absorbed. */
  streamline: 0.4,
  /** Length of the tapered tail at the end of a stroke. */
  endTaper: 55,
  /** Radius of a tap (single-point stroke). */
  dotRadius: 12,
} as const;

/** Pressure a stroke starts with before speed or pen data is known: a firm entry. */
export const INITIAL_PRESSURE = 0.65;
const FALLBACK_PRESSURE = 0.5;
/** Normalized units per millisecond at which a mouse/touch stroke is at its thinnest. */
const FAST_SPEED = 0.004;
const SLOW_PRESSURE = 0.8;
const FAST_PRESSURE = 0.15;

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

/**
 * Brush pressure for the next point. A pen reports real pressure; for mouse and touch it is
 * derived from speed, so slow movement is heavy and fast movement is light. Both are eased
 * from the previous value so the width never jumps.
 */
export function nextPressure(
  previous: number,
  input: { penPressure: number | null; distance: number; elapsedMs: number },
): number {
  if (input.penPressure !== null) {
    return clamp01(previous + (clamp01(input.penPressure) - previous) * 0.6);
  }
  if (input.elapsedMs <= 0) return previous;
  const speed = Math.min(1, input.distance / input.elapsedMs / FAST_SPEED);
  const target = SLOW_PRESSURE - (SLOW_PRESSURE - FAST_PRESSURE) * speed;
  return clamp01(previous + (target - previous) * 0.35);
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

/**
 * SVG path data for the filled brush shape of a stroke. `complete` finishes the tail; pass
 * false while the stroke is still being drawn.
 */
export function strokeOutlinePath(stroke: Stroke, complete: boolean): string {
  const first = stroke[0];
  if (first === undefined) return '';
  if (stroke.length === 1) return dotPath(first);
  // Strokes saved before pressure was recorded fall back to speed estimated from point spacing.
  const hasPressure = stroke.every((point) => point.p !== undefined);
  const outline = getStroke(
    stroke.map((point) => [point.x * VIEW_SIZE, point.y * VIEW_SIZE, point.p ?? FALLBACK_PRESSURE]),
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
  return outlineToPath(outline) || dotPath(first);
}
