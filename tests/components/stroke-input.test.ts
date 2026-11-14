import { describe, expect, it } from 'vitest';

import { strokeOutlinePath } from '../../src/components/brush';
import {
  penPressureCurve,
  StrokeBuilder,
  type InputSample,
} from '../../src/components/stroke-input';
import pencil from '../fixtures/pencil-traces.json';

interface TraceEvent extends InputSample {
  readonly type: string;
}

const recordings = pencil.recordings as {
  label: string;
  strokes: TraceEvent[][];
}[];

function replay(events: readonly TraceEvent[], pointerType = 'pen') {
  const [first, ...rest] = events;
  if (first === undefined) throw new Error('Empty trace stroke.');
  const builder = new StrokeBuilder(pointerType, first);
  for (const event of rest) builder.add(event);
  return builder.stroke;
}

/** Sign changes of the outline's turning angle over 4°, per 1000 units of edge: ripples. */
function ripplesPer1000(path: string): { ripples: number; length: number } {
  const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const points: [number, number][] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push([numbers[index] ?? 0, numbers[index + 1] ?? 0]);
  }
  let ripples = 0;
  let length = 0;
  let previous = 0;
  for (let index = 2; index < points.length; index += 1) {
    const [a, b, c] = [points[index - 2], points[index - 1], points[index]] as [
      [number, number],
      [number, number],
      [number, number],
    ];
    const raw = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    const turn = Math.atan2(Math.sin(raw), Math.cos(raw));
    length += Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (Math.abs(turn) > (4 * Math.PI) / 180) {
      if (previous !== 0 && Math.sign(turn) !== previous) ripples += 1;
      previous = Math.sign(turn);
    }
  }
  return { ripples, length };
}

describe('penPressureCurve', () => {
  it('spreads ordinary Pencil writing pressure across the brush range', () => {
    expect(penPressureCurve(0)).toBe(0);
    expect(penPressureCurve(0.05)).toBeGreaterThan(0.15);
    expect(penPressureCurve(0.2)).toBeGreaterThan(0.4);
    expect(penPressureCurve(0.2)).toBeLessThan(0.5);
    expect(penPressureCurve(0.5)).toBeGreaterThan(0.7);
    expect(penPressureCurve(1)).toBe(1);
  });
});

describe('StrokeBuilder', () => {
  it('drops samples that barely move and keeps clamped, rounded points', () => {
    const builder = new StrokeBuilder('mouse', { x: 0.5, y: 0.5, t: 0, pressure: 0 });
    expect(builder.add({ x: 0.501, y: 0.5, t: 16, pressure: 0 })).toBe(false);
    expect(builder.add({ x: 1.2, y: 0.5, t: 32, pressure: 0 })).toBe(true);
    expect(builder.stroke.at(-1)).toMatchObject({ x: 1, y: 0.5, t: 32 });
  });

  it('derives mouse pressure from speed: heavier when slow than when fast', () => {
    const slow = new StrokeBuilder('mouse', { x: 0.1, y: 0.5, t: 0, pressure: 0 });
    const fast = new StrokeBuilder('touch', { x: 0.1, y: 0.5, t: 0, pressure: 0 });
    for (let step = 1; step <= 10; step += 1) {
      slow.add({ x: 0.1 + step * 0.005, y: 0.5, t: step * 16, pressure: 0 });
      fast.add({ x: 0.1 + step * 0.08, y: 0.5, t: step * 16, pressure: 0 });
    }
    expect(slow.stroke.at(-1)?.p).toBeGreaterThan(0.7);
    expect(fast.stroke.at(-1)?.p).toBeLessThan(0.3);
  });

  it('keeps pen pressure when a sample reports none, instead of switching to speed', () => {
    const builder = new StrokeBuilder('pen', { x: 0.1, y: 0.5, t: 0, pressure: 0.3 });
    for (let step = 1; step <= 8; step += 1) {
      builder.add({ x: 0.1 + step * 0.02, y: 0.5, t: step * 16, pressure: 0.3 });
    }
    const before = builder.stroke.at(-1)?.p ?? 0;
    // Safari reports pressure 0 on every pen lift.
    builder.add({ x: 0.3, y: 0.5, t: 160, pressure: 0 });
    expect(builder.stroke.at(-1)?.p).toBeCloseTo(before, 2);
  });

  it('smooths pressure by time, so a sudden press does not jump the width', () => {
    const builder = new StrokeBuilder('pen', { x: 0.1, y: 0.5, t: 0, pressure: 0.1 });
    builder.add({ x: 0.12, y: 0.5, t: 4, pressure: 0.9 });
    const afterFourMs = builder.stroke.at(-1)?.p ?? 0;
    expect(afterFourMs).toBeLessThan(penPressureCurve(0.3));
    for (let step = 2; step < 20; step += 1) {
      builder.add({ x: 0.1 + step * 0.02, y: 0.5, t: step * 16, pressure: 0.9 });
    }
    expect(builder.stroke.at(-1)?.p).toBeCloseTo(penPressureCurve(0.9), 1);
  });

  it('adds predicted points to the live preview without keeping them', () => {
    const builder = new StrokeBuilder('pen', { x: 0.1, y: 0.5, t: 0, pressure: 0.3 });
    builder.add({ x: 0.2, y: 0.5, t: 16, pressure: 0.3 });
    const preview = builder.preview([{ x: 0.25, y: 0.5, t: 24, pressure: 0.3 }]);
    expect(preview).toHaveLength(3);
    expect(builder.stroke).toHaveLength(2);
  });
});

describe('recorded Apple Pencil input (iPad Safari)', () => {
  it('has the recordings this suite relies on', () => {
    expect(recordings).toHaveLength(12);
  });

  it('never lets a pen lift change the stroke width', () => {
    let lifts = 0;
    for (const recording of recordings) {
      for (const events of recording.strokes) {
        const up = events.at(-1);
        expect(up?.type).toBe('pointerup');
        expect(up?.pressure).toBe(0);
        const without = replay(events.slice(0, -1));
        const withLift = replay(events);
        if (withLift.length === without.length) continue;
        lifts += 1;
        expect(withLift.at(-1)?.p).toBe(without.at(-1)?.p);
      }
    }
    expect(lifts).toBeGreaterThan(0);
  });

  it('draws smooth, closed outlines with few edge ripples', () => {
    let ripples = 0;
    let length = 0;
    for (const recording of recordings) {
      for (const events of recording.strokes) {
        const path = strokeOutlinePath(replay(events), true);
        expect(path).toMatch(/^M[\d.]+ [\d.]+ .+Z$/);
        const measured = ripplesPer1000(path);
        ripples += measured.ripples;
        length += measured.length;
      }
    }
    // The brush before the Pencil fix measured 23 ripples per 1000 units on these
    // recordings; the fix measures about 14.
    expect((1000 * ripples) / length).toBeLessThan(16);
  });
});
