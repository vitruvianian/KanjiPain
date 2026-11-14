import { useEffect, useMemo, useState } from 'react';

import type { KanjiId, Stroke } from '../domain/types';
import { resample } from '../recognition/geometry';
import { useReferenceStrokes } from '../recognition/useReferenceStrokes';
import { VIEW_SIZE, strokeOutlinePath } from './brush';
import { Button } from './Button';
import { UnrecognizedWarning } from './UnrecognizedWarning';

interface StrokeOrderProps {
  readonly kanjiId: KanjiId;
  readonly literal: string;
}

/** Points per stroke: enough for a smooth brush shape and a smooth animation. */
const POINTS = 28;
/** How long each stroke takes to draw, and the pause before the next one. */
const STROKE_MS = 650;
const PAUSE_MS = 250;
const LABEL_OFFSET = 34;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function clampToView(value: number): number {
  return Math.max(30, Math.min(VIEW_SIZE - 30, value));
}

/** Where to put a stroke's number: just behind its starting point. */
function labelPosition(stroke: Stroke): { x: number; y: number } {
  const start = stroke[0] ?? { x: 0, y: 0 };
  const next = stroke[2] ?? stroke[1] ?? start;
  const dx = next.x - start.x;
  const dy = next.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: clampToView(start.x * VIEW_SIZE - (dx / length) * LABEL_OFFSET),
    y: clampToView(start.y * VIEW_SIZE - (dy / length) * LABEL_OFFSET),
  };
}

function Guide() {
  const half = VIEW_SIZE / 2;
  return (
    <g className="drawing-guide" aria-hidden="true">
      <line x1={half} y1={0} x2={half} y2={VIEW_SIZE} />
      <line x1={0} y1={half} x2={VIEW_SIZE} y2={half} />
    </g>
  );
}

/**
 * How to write a character: an animation that draws the strokes in order, each numbered at
 * its starting point, and a step-by-step chart that adds one stroke per frame.
 */
export function StrokeOrder({ kanjiId, literal }: StrokeOrderProps) {
  // The character may come from a custom deck, outside the bundled Jōyō stroke data.
  const extraIds = useMemo(() => [kanjiId], [kanjiId]);
  const references = useReferenceStrokes(extraIds);
  const strokes = useMemo<Stroke[] | null>(() => {
    if (typeof references !== 'object') return null;
    const reference = references.strokesFor(kanjiId);
    return reference === undefined
      ? null
      : reference.map((stroke) => resample(stroke, POINTS).map(({ x, y }) => ({ x, y, p: 0.5 })));
  }, [kanjiId, references]);
  const outlines = useMemo(
    () => (strokes ?? []).map((stroke) => strokeOutlinePath(stroke, true)),
    [strokes],
  );
  const count = strokes?.length ?? 0;

  // Strokes drawn so far, fractional while one is in progress. Starts complete when motion
  // is reduced, so nothing moves unless the learner asks for it.
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? Infinity : 0));
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (count === 0 || (run === 0 && prefersReducedMotion())) return undefined;
    let frame = 0;
    let startedAt: number | null = null;
    const tick = (now: number) => {
      startedAt ??= now;
      const elapsed = now - startedAt;
      const index = Math.floor(elapsed / (STROKE_MS + PAUSE_MS));
      const within = Math.min(1, (elapsed - index * (STROKE_MS + PAUSE_MS)) / STROKE_MS);
      const next = Math.min(count, index + within);
      setProgress(next);
      if (next < count) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [count, run]);

  if (references === 'loading') {
    return (
      <p className="muted" role="status">
        Loading the stroke order…
      </p>
    );
  }
  if (references === 'unavailable') {
    return <p className="muted">The stroke order could not be loaded. Reload to try again.</p>;
  }
  if (strokes === null) {
    return <UnrecognizedWarning />;
  }

  const shown = Math.min(count, progress);
  const finished = Math.floor(shown);
  const active = strokes[finished];
  const activePoints = active === undefined ? 0 : Math.round((shown - finished) * (POINTS - 1)) + 1;

  return (
    <div className="stroke-order">
      <p>
        Write the {count === 1 ? 'single stroke' : `${String(count)} strokes`} in the numbered
        order. Each stroke starts at its number and follows the animation.
      </p>
      <div className="stroke-order__main">
        <svg
          className="stroke-order__animation"
          viewBox={`0 0 ${String(VIEW_SIZE)} ${String(VIEW_SIZE)}`}
          role="img"
          aria-label={`Stroke order animation for ${literal}: ${String(count)} ${count === 1 ? 'stroke' : 'strokes'}`}
        >
          <Guide />
          <g className="stroke-order__ghost">
            {outlines.map((outline, index) => (
              <path key={index} d={outline} />
            ))}
          </g>
          <g className="drawing-ink" data-testid="stroke-order-ink">
            {outlines.slice(0, finished).map((outline, index) => (
              <path key={index} d={outline} />
            ))}
            {active === undefined || activePoints < 2 ? null : (
              <path
                className="stroke-order__active"
                d={strokeOutlinePath(active.slice(0, activePoints), false)}
              />
            )}
          </g>
          <g className="stroke-order__labels" aria-hidden="true">
            {strokes.map((stroke, index) => {
              const { x, y } = labelPosition(stroke);
              return (
                <text key={index} x={x} y={y}>
                  {String(index + 1)}
                </text>
              );
            })}
          </g>
        </svg>
        <Button
          onClick={() => {
            setProgress(0);
            setRun((value) => value + 1);
          }}
        >
          {shown >= count ? 'Replay stroke order' : 'Restart stroke order'}
        </Button>
      </div>

      <ol className="stroke-order__steps" aria-label={`Stroke-by-stroke steps for ${literal}`}>
        {strokes.map((stroke, step) => {
          const start = stroke[0] ?? { x: 0, y: 0 };
          return (
            <li key={step}>
              <svg
                viewBox={`0 0 ${String(VIEW_SIZE)} ${String(VIEW_SIZE)}`}
                role="img"
                aria-label={`Stroke ${String(step + 1)} of ${String(count)}`}
              >
                <Guide />
                <g className="stroke-order__earlier">
                  {outlines.slice(0, step).map((outline, index) => (
                    <path key={index} d={outline} />
                  ))}
                </g>
                <path className="stroke-order__current" d={outlines[step] ?? ''} />
                <circle
                  className="stroke-order__start"
                  cx={start.x * VIEW_SIZE}
                  cy={start.y * VIEW_SIZE}
                  r={30}
                />
              </svg>
              <span aria-hidden="true">{String(step + 1)}</span>
            </li>
          );
        })}
      </ol>
      <p className="muted">
        In each step the new stroke is highlighted and the dot marks where it begins.
      </p>
    </div>
  );
}
