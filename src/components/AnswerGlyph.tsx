import { useMemo } from 'react';

import type { KanjiId } from '../domain/types';
import { resample } from '../recognition/geometry';
import { useReferenceStrokes } from '../recognition/useReferenceStrokes';
import { VIEW_SIZE, strokeOutlinePath } from './brush';

interface AnswerGlyphProps {
  readonly kanjiId: KanjiId;
  readonly literal: string;
}

const POINTS = 28;

/**
 * The answer as it is written by hand: drawn from its KanjiVG strokes with the same brush
 * as the drawing pad. Print fonts form some characters differently from handwriting (令,
 * 心, 糸, 北, 入). Characters without stroke data fall back to the font.
 */
export function AnswerGlyph({ kanjiId, literal }: AnswerGlyphProps) {
  const extraIds = useMemo(() => [kanjiId], [kanjiId]);
  const references = useReferenceStrokes(extraIds);
  const outlines = useMemo(() => {
    if (typeof references !== 'object') return null;
    const strokes = references.strokesFor(kanjiId);
    return strokes === undefined
      ? null
      : strokes.map((stroke) =>
          strokeOutlinePath(
            resample(stroke, POINTS).map(({ x, y }) => ({ x, y, p: 0.6 })),
            true,
          ),
        );
  }, [kanjiId, references]);

  if (outlines === null) {
    return (
      <p className="glyph" lang="ja">
        {literal}
      </p>
    );
  }
  return (
    <p className="glyph glyph--written" lang="ja">
      <svg
        className="glyph__drawing"
        viewBox={`0 0 ${String(VIEW_SIZE)} ${String(VIEW_SIZE)}`}
        aria-hidden="true"
        data-testid="answer-glyph"
      >
        {outlines.map((outline, index) => (
          <path key={index} d={outline} />
        ))}
      </svg>
      <span className="visually-hidden">{literal}</span>
    </p>
  );
}
