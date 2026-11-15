import { describe, expect, it } from 'vitest';

import type { KanjiEntry } from '../../src/domain/types';
import {
  buildComponentHints,
  buildLookalikes,
  buildReferenceStrokes,
  buildStrokeShards,
  componentHint,
  encodeStroke,
  flattenSvgPath,
  parseKanjivgComponents,
  parseKanjivgXml,
  simplifyPolyline,
} from '../../scripts/kanjivg-pipeline';
import { ReferenceStrokes } from '../../src/recognition/reference-data';

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

  it('splits every KanjiVG character into shards by code point', () => {
    const build = buildStrokeShards(xml);
    expect(build.entryCount).toBe(2);
    expect(build.strokeTotal).toBe(3);
    // U+4E00 % 64 = 0 and U+4E8C % 64 = 12.
    expect([...build.shards.keys()]).toEqual(['00', '0c']);
    expect(build.shards.get('0c')).toEqual({ 'k-4e8c': ['3a4bc74b', '1cbbe1bb'] });
    expect(Object.keys(build.shards.get('00') ?? {})).toEqual(['k-4e00']);
  });

  const componentXml = `<kanjivg>
<kanji id="kvg:kanji_06d77">
<g id="kvg:06d77" kvg:element="海">
	<g id="kvg:06d77-g1" kvg:element="氵" kvg:original="水" kvg:position="left">
		<path id="kvg:06d77-s1" d="M1,1L2,2"/><path id="kvg:06d77-s2" d="M1,1L2,2"/><path id="kvg:06d77-s3" d="M1,1L2,2"/>
	</g>
	<g id="kvg:06d77-g2" kvg:element="毎" kvg:position="right">
		<g id="kvg:06d77-g3" kvg:position="top"><path id="kvg:06d77-s4" d="M1,1L2,2"/></g>
		<path id="kvg:06d77-s5" d="M1,1L2,2"/>
	</g>
</g>
</kanji>
<kanji id="kvg:kanji_056fd">
<g id="kvg:056fd" kvg:element="国">
	<g id="kvg:056fd-g1" kvg:element="囗" kvg:part="1" kvg:position="kamae"><path id="kvg:056fd-s1" d="M1,1L2,2"/><path id="kvg:056fd-s2" d="M1,1L2,2"/></g>
	<g id="kvg:056fd-g2" kvg:element="玉"><path id="kvg:056fd-s3" d="M1,1L2,2"/></g>
	<g id="kvg:056fd-g3" kvg:element="囗" kvg:part="2" kvg:position="kamae"><path id="kvg:056fd-s4" d="M1,1L2,2"/></g>
</g>
</kanji>
<kanji id="kvg:kanji_04e00">
<g id="kvg:04e00" kvg:element="一"><path id="kvg:04e00-s1" d="M1,1L2,2"/></g>
</kanji>
</kanjivg>`;

  it('reads component trees with stroke counts', () => {
    const tree = parseKanjivgComponents(componentXml).get('6d77');
    expect(tree?.element).toBe('海');
    expect(tree?.strokeCount).toBe(5);
    expect(
      tree?.children.map((child) => [child.element, child.position, child.strokeCount]),
    ).toEqual([
      ['氵', 'left', 3],
      ['毎', 'right', 2],
    ]);
  });

  it('names parts by position, with a name where one is known and a stroke count otherwise', () => {
    const trees = parseKanjivgComponents(componentXml);
    const meanings = new Map([['玉', 'jewel']]);
    const hint = (codePoint: string) => {
      const tree = trees.get(codePoint);
      return tree === undefined
        ? undefined
        : componentHint(tree, (literal) => meanings.get(literal));
    };
    expect(hint('6d77')).toBe('Left: water · Right: 2 strokes');
    // An enclosure split around its contents is one part.
    expect(hint('56fd')).toBe('Enclosure: enclosure · Inside: jewel');
    expect(hint('4e00')).toBeUndefined();
  });

  it('builds hints for catalog characters only', () => {
    const hints = buildComponentHints(componentXml, [
      { ...entry('海', 5), meanings: ['sea'] },
      { ...entry('毎', 6), meanings: ['every'] },
      entry('一', 1),
    ]);
    expect(hints).toEqual({ 'k-6d77': 'Left: water · Right: every' });
  });

  it('pairs characters whose shapes pass as each other, symmetrically', () => {
    // 土 and 士 differ only in which horizontal is longer; 工 is further away.
    const references = new ReferenceStrokes({
      'k-571f': ['2a5ad65a', '8018809e', '1ab8e6b8'],
      'k-58eb': ['1a5ae65a', '8018809e', '2ab8d6b8'],
      'k-5ddd': ['10201030', '80208070', '7070a070'],
    });
    const lookalikes = buildLookalikes(references, ['k-571f', 'k-58eb', 'k-5ddd']);
    expect(lookalikes['k-571f']).toEqual(['k-58eb']);
    expect(lookalikes['k-58eb']).toEqual(['k-571f']);
    expect(lookalikes['k-5ddd']).toBeUndefined();
  });
});
