import { describe, expect, it } from 'vitest';

import type { KanjiEntry } from '../../src/domain/types';
import {
  buildReferenceStrokes,
  encodeStroke,
  flattenSvgPath,
  parseKanjivgXml,
  simplifyPolyline,
} from '../../scripts/kanjivg-pipeline';

const xml = `<kanjivg>
<kanji id="kvg:kanji_04e00">
<g id="kvg:04e00" kvg:element="一">
	<path id="kvg:04e00-s1" kvg:type="㇐" d="M11,54.25c3.19,0.62,6.25,0.75,9.73,0.5"/>
</g>
</kanji>
<kanji id="kvg:kanji_04e8c">
<g id="kvg:04e8c">
	<path id="kvg:04e8c-s2" d="M12,80L96,80"/>
	<path id="kvg:04e8c-s1" d="M25,32h60"/>
</g>
</kanji>
</kanjivg>`;

function entry(literal: string, strokeCount: number): KanjiEntry {
  return {
    id: `k-${literal.codePointAt(0)?.toString(16) ?? ''}`,
    literal,
    grade: 1,
    meanings: ['test'],
    onReadings: [],
    kunReadings: ['て'],
    strokeCount,
    frequencyRank: null,
    curriculumOrder: 0,
  };
}

describe('KanjiVG pipeline', () => {
  it('flattens absolute, relative and shorthand path commands', () => {
    expect(flattenSvgPath('M10,20L30,20l0,10H5v-5')).toEqual([
      [10, 20],
      [30, 20],
      [30, 30],
      [5, 30],
      [5, 25],
    ]);
    const curve = flattenSvgPath('M0,0c10,0,10,10,10,10s0,10,10,10');
    expect(curve[0]).toEqual([0, 0]);
    expect(curve[16]).toEqual([10, 10]);
    expect(curve.at(-1)).toEqual([20, 20]);
    expect(() => flattenSvgPath('M0,0A5,5,0,0,1,10,10')).toThrow(/Unsupported/);
    expect(() => flattenSvgPath('M0,0L5,5M9,9L1,1')).toThrow(/more than one subpath/);
  });

  it('simplifies straight runs but keeps corners', () => {
    const points = [
      [0, 0],
      [5, 0.1],
      [10, 0],
      [10, 10],
    ] as const;
    expect(simplifyPolyline(points, 0.5)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it('encodes strokes on a 0–255 grid', () => {
    expect(encodeStroke('M0,0L109,109')).toBe('0000ffff');
    expect(encodeStroke('M54.5,0v109')).toBe('800080ff');
  });

  it('reads strokes in stroke order and requires every catalog character', () => {
    const parsed = parseKanjivgXml(xml);
    expect(parsed.get('4e8c')).toEqual(['M25,32h60', 'M12,80L96,80']);

    const build = buildReferenceStrokes(xml, [entry('一', 1), entry('二', 3)]);
    expect(Object.keys(build.data)).toEqual(['k-4e00', 'k-4e8c']);
    expect(build.strokeTotal).toBe(3);
    expect(build.strokeCountDifferences).toEqual([
      { id: 'k-4e8c', literal: '二', catalog: 3, kanjivg: 2 },
    ]);
    expect(() => buildReferenceStrokes(xml, [entry('三', 3)])).toThrow(/三/);
  });
});
