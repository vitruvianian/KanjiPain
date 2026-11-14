import { describe, expect, it } from 'vitest';

import strokeData from '../../src/data/strokes.generated.json';
import type { Stroke } from '../../src/domain/types';
import { checkDrawing, suggestedGrade } from '../../src/recognition/check';
import { ReferenceStrokes } from '../../src/recognition/reference-data';

const references = new ReferenceStrokes(strokeData);

const ID = {
  one: 'k-4e00', // 一
  sun: 'k-65e5', // 日
  eternity: 'k-6c38', // 永
  notYet: 'k-672a', // 未
  end: 'k-672b', // 末
  bet: 'k-8ced', // 賭
} as const;

/** The reference strokes redrawn small and off-centre, as a learner would place them. */
function drawn(id: string, size = 0.55, left = 0.3, top = 0.15): Stroke[] {
  const strokes = references.strokesFor(id);
  if (strokes === undefined) throw new Error(`No reference strokes for ${id}.`);
  return strokes.map((stroke) =>
    stroke.map((point) => ({ x: left + point.x * size, y: top + point.y * size })),
  );
}

function verdictOf(strokes: Stroke[], id: string) {
  const result = checkDrawing(strokes, id, references);
  if (result === null) throw new Error('Expected a check result.');
  return result;
}

describe('checkDrawing', () => {
  it('covers every catalog character', () => {
    expect(references.size).toBe(2136);
  });

  it.each([ID.one, ID.sun, ID.eternity, ID.notYet])(
    'accepts %s wherever and however large it is drawn',
    (id) => {
      for (const [size, left, top] of [
        [0.55, 0.3, 0.15],
        [0.3, 0.05, 0.6],
        [0.95, 0.02, 0.02],
      ] as const) {
        const result = verdictOf(drawn(id, size, left, top), id);
        expect(result.verdict).toBe('match');
        expect(result.marks.every((mark) => mark === 'ok')).toBe(true);
        expect(suggestedGrade(result)).toBe('got');
      }
    },
  );

  it('places the guide strokes over the drawing', () => {
    const strokes = drawn(ID.sun, 0.4, 0.5, 0.1);
    const { guide } = verdictOf(strokes, ID.sun);
    expect(guide).toHaveLength(4);
    guide.forEach((stroke, index) => {
      expect(stroke[0]?.x).toBeCloseTo(strokes[index]?.[0]?.x ?? -1, 2);
      expect(stroke[0]?.y).toBeCloseTo(strokes[index]?.[0]?.y ?? -1, 2);
    });
  });

  it('reports strokes written out of order', () => {
    const [first = [], second = [], third = [], ...rest] = drawn(ID.eternity);
    const result = verdictOf([first, third, second, ...rest], ID.eternity);
    expect(result.verdict).toBe('order');
    expect(result.marks.slice(0, 3)).toEqual(['ok', 'order', 'order']);
    expect(suggestedGrade(result)).toBe('barely');
  });

  it('reports a stroke written backwards', () => {
    const [first = [], ...rest] = drawn(ID.sun);
    const result = verdictOf([[...first].reverse(), ...rest], ID.sun);
    expect(result.verdict).toBe('direction');
    expect(result.marks).toEqual(['direction', 'ok', 'ok', 'ok']);
    expect(suggestedGrade(result)).toBe('barely');
  });

  it('rejects a missing stroke, but recognizes two strokes written as one', () => {
    const missing = verdictOf(drawn(ID.sun).slice(0, 3), ID.sun);
    expect(missing).toMatchObject({
      verdict: 'stroke-count',
      shapeClose: false,
      expectedStrokes: 4,
      drawnStrokes: 3,
    });
    expect(suggestedGrade(missing)).toBe('missed');

    // One stroke lifted halfway and continued: two touching strokes where one is expected.
    const [first = [], ...rest] = drawn(ID.one);
    const middle = Math.floor(first.length / 2);
    const split = verdictOf([first.slice(0, middle + 1), first.slice(middle), ...rest], ID.one);
    expect(split).toMatchObject({ verdict: 'stroke-count', shapeClose: true });
    expect(suggestedGrade(split)).toBe('barely');
  });

  it('names the look-alike when a similar character was drawn', () => {
    const result = verdictOf(drawn(ID.end), ID.notYet);
    expect(result).toMatchObject({ verdict: 'lookalike', lookalikeId: ID.end });
    expect(suggestedGrade(result)).toBe('missed');
  });

  it('rejects a drawing that is not the character and marks the misplaced strokes', () => {
    const scribble: Stroke[] = [0.2, 0.4, 0.6, 0.8].map((x) => [
      { x, y: 0.2 },
      { x: x - 0.15, y: 0.8 },
    ]);
    const result = verdictOf(scribble, ID.sun);
    expect(result.verdict).toBe('mismatch');
    expect(result.marks).toContain('off');
    expect(suggestedGrade(result)).toBe('missed');
  });

  it('declines to judge what it cannot check', () => {
    expect(checkDrawing([], ID.sun, references)).toBeNull();
    expect(checkDrawing(drawn(ID.sun), 'k-0000', references)).toBeNull();
    // 賭 is also written with 15 strokes; the reference holds the 16-stroke form.
    const fifteen = drawn(ID.bet).slice(0, 15);
    expect(checkDrawing(fifteen, ID.bet, references, { alternateStrokeCount: 15 })).toBeNull();
    expect(checkDrawing(fifteen, ID.bet, references)?.verdict).toBe('stroke-count');
  });
});
