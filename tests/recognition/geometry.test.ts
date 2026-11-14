import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  assign,
  composeTransforms,
  fitTransform,
  invertTransform,
  resample,
  unitFrame,
} from '../../src/recognition/geometry';
import { decodeStroke } from '../../src/recognition/reference-data';

describe('geometry', () => {
  it('resamples evenly along a line and repeats a dot', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    const points = resample(line, 5);
    expect(points).toHaveLength(5);
    expect(points[1]).toEqual({ x: 0.5, y: 0 });
    expect(points[2]?.x).toBeCloseTo(1);
    expect(points[2]?.y).toBeCloseTo(0);
    expect(points[4]).toEqual({ x: 1, y: 1 });
    expect(resample([{ x: 0.3, y: 0.3 }], 3)).toEqual(Array(3).fill({ x: 0.3, y: 0.3 }));
  });

  it('frames a drawing by its longer side without distorting it', () => {
    const frame = unitFrame([
      [
        { x: 0.2, y: 0.4 },
        { x: 0.6, y: 0.4 },
      ],
    ]);
    expect(applyTransform(frame, { x: 0.2, y: 0.4 })).toEqual({ x: 0, y: 0.5 });
    expect(applyTransform(frame, { x: 0.6, y: 0.4 })).toEqual({ x: 1, y: 0.5 });
  });

  it('composes and inverts transforms', () => {
    const first = { scale: 2, dx: 0.1, dy: -0.2 };
    const second = { scale: 0.5, dx: 0.3, dy: 0.4 };
    const point = { x: 0.25, y: 0.75 };
    const composed = applyTransform(composeTransforms(first, second), point);
    const stepwise = applyTransform(second, applyTransform(first, point));
    expect(composed.x).toBeCloseTo(stepwise.x);
    expect(composed.y).toBeCloseTo(stepwise.y);
    const back = applyTransform(invertTransform(first), applyTransform(first, point));
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it('recovers the scale and shift between paired points', () => {
    const from = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const to = from.map((point) => ({ x: 0.5 * point.x + 0.2, y: 0.5 * point.y + 0.1 }));
    const fit = fitTransform(from, to);
    expect(fit?.scale).toBeCloseTo(0.5);
    expect(fit?.dx).toBeCloseTo(0.2);
    expect(fit?.dy).toBeCloseTo(0.1);
    expect(fitTransform([{ x: 1, y: 1 }], [{ x: 2, y: 2 }])).toBeNull();
  });

  it('finds the cheapest one-to-one assignment', () => {
    expect(
      assign([
        [4, 1, 3],
        [2, 0, 5],
        [3, 2, 2],
      ]),
    ).toEqual([1, 0, 2]);
    expect(assign([])).toEqual([]);
  });

  it('decodes hex-encoded reference strokes', () => {
    expect(decodeStroke('00ff8000')).toEqual([
      { x: 0, y: 1 },
      { x: 128 / 255, y: 0 },
    ]);
  });
});
