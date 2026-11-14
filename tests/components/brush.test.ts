import { describe, expect, it } from 'vitest';

import { makePoint, strokeOutlinePath } from '../../src/components/brush';
import { strokeSchema } from '../../src/domain/schemas';
import type { Stroke } from '../../src/domain/types';

const CLOSED_CURVE = /^M[\d.]+ [\d.]+ Q[\d. -]+Z$/;

function coordinates(path: string): number[] {
  return (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

describe('makePoint', () => {
  it('clamps to the pad and rounds for compact storage', () => {
    expect(makePoint(1.2, -0.3, 0.456, 12.6)).toEqual({ x: 1, y: 0, p: 0.46, t: 13 });
    expect(makePoint(0.123456, 0.5, 2, -4)).toEqual({ x: 0.1235, y: 0.5, p: 1, t: 0 });
  });

  it('produces points the persisted stroke schema accepts, alongside legacy points', () => {
    const stroke = [makePoint(0.2, 0.2, 0.6, 0), { x: 0.4, y: 0.4 }];
    expect(strokeSchema.parse(stroke)).toEqual(stroke);
    expect(() => strokeSchema.parse([{ x: 0.5, y: 0.5, p: 1.5 }])).toThrow();
    expect(() => strokeSchema.parse([{ x: 0.5, y: 0.5, t: 1.5 }])).toThrow();
  });
});

describe('strokeOutlinePath', () => {
  const line = (pressure?: number): Stroke =>
    Array.from({ length: 21 }, (_, index) => ({
      x: 0.2 + index * 0.03,
      y: 0.5,
      ...(pressure === undefined ? {} : { p: pressure, t: index * 16 }),
    }));

  it('returns nothing for an empty stroke and a closed dot for a tap', () => {
    expect(strokeOutlinePath([], true)).toBe('');
    expect(strokeOutlinePath([{ x: 0.5, y: 0.5 }], true)).toMatch(/^M488 500 a12 12 .+Z$/);
  });

  it('draws a closed, curved outline inside the pad for live and finished strokes', () => {
    for (const complete of [false, true]) {
      const path = strokeOutlinePath(line(0.6), complete);
      expect(path).toMatch(CLOSED_CURVE);
      for (const value of coordinates(path)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('draws heavier pressure as a thicker stroke', () => {
    const height = (pressure: number) => {
      const ys = coordinates(strokeOutlinePath(line(pressure), true)).filter(
        (_, index) => index % 2 === 1,
      );
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(height(0.9)).toBeGreaterThan(height(0.2) * 1.5);
  });

  it('still renders strokes saved before pressure was recorded', () => {
    expect(strokeOutlinePath(line(), true)).toMatch(CLOSED_CURVE);
  });
});
