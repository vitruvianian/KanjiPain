import { memo, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';

import type { Stroke } from '../domain/types';
import {
  BRUSH,
  INITIAL_PRESSURE,
  VIEW_SIZE,
  makePoint,
  nextPressure,
  strokeOutlinePath,
} from './brush';
import { Button } from './Button';

interface DrawingPadProps {
  strokes: readonly Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
  readOnly?: boolean;
  label?: string;
}

interface ActiveStroke {
  pointerId: number;
  pointerType: string;
  stroke: Stroke;
  startedAt: number;
  lastAt: number;
  pressure: number;
}

const MAX_STROKES = 100;
const MAX_POINTS = 20_000;
/** Samples closer than this to the previous one are dropped (0.4% of the pad). */
const MIN_DISTANCE = 0.004;
/** A touch this soon after pen activity is treated as a resting palm. */
const PALM_REJECTION_MS = 1000;
const LIMIT_MESSAGE = 'Drawing limit reached. Undo a stroke or clear the drawing to continue.';

function penPressure(event: { pointerType: string; pressure: number }): number | null {
  return event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : null;
}

/** Every sample the browser collected since the last event, not only the latest one. */
function samplesOf(event: PointerEvent<SVGSVGElement>): readonly globalThis.PointerEvent[] {
  const native = event.nativeEvent;
  const coalesced =
    typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
  return coalesced.length > 0 ? coalesced : [native];
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

const StrokeShape = memo(function StrokeShape({ stroke }: { stroke: Stroke }) {
  const path = useMemo(() => strokeOutlinePath(stroke, true), [stroke]);
  const first = stroke[0];
  if (first === undefined) return null;
  if (stroke.length === 1) {
    return (
      <circle data-stroke cx={first.x * VIEW_SIZE} cy={first.y * VIEW_SIZE} r={BRUSH.dotRadius} />
    );
  }
  return <path data-stroke d={path} />;
});

function DrawingSurface({
  strokes,
  onStrokesChange,
  readOnly = false,
  label = 'Kanji drawing area',
}: DrawingPadProps) {
  const descriptionId = useId();
  const active = useRef<ActiveStroke | null>(null);
  const livePath = useRef<SVGPathElement | null>(null);
  const frame = useRef<number | null>(null);
  const lastPenAt = useRef(Number.NEGATIVE_INFINITY);
  const [drawing, setDrawing] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const pointCount = strokes.reduce((total, stroke) => total + stroke.length, 0);
  const atLimit = strokes.length >= MAX_STROKES || pointCount >= MAX_POINTS;
  const canEdit = !readOnly && strokes.length > 0 && !drawing;

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  useEffect(() => {
    if (!canEdit) return undefined;
    function undoOnShortcut(event: KeyboardEvent) {
      const isUndo =
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'z';
      if (!isUndo || isTextEntry(event.target)) return;
      event.preventDefault();
      setLimitReached(false);
      onStrokesChange(strokes.slice(0, -1));
    }
    window.addEventListener('keydown', undoOnShortcut);
    return () => {
      window.removeEventListener('keydown', undoOnShortcut);
    };
  }, [canEdit, strokes, onStrokesChange]);

  // The stroke in progress is drawn straight to the DOM, at most once per frame, so React
  // does not re-render for every pointer sample.
  function paintLive() {
    frame.current = null;
    const current = active.current;
    livePath.current?.setAttribute(
      'd',
      current === null ? '' : strokeOutlinePath(current.stroke, false),
    );
  }

  function schedulePaint() {
    frame.current ??= requestAnimationFrame(paintLive);
  }

  function relativePosition(
    surface: SVGSVGElement,
    sample: { clientX: number; clientY: number },
  ): { x: number; y: number } {
    const bounds = surface.getBoundingClientRect();
    return {
      x: (sample.clientX - bounds.left) / bounds.width,
      y: (sample.clientY - bounds.top) / bounds.height,
    };
  }

  function appendSamples(event: PointerEvent<SVGSVGElement>) {
    const current = active.current;
    if (readOnly || current?.pointerId !== event.pointerId) return;
    for (const sample of samplesOf(event)) {
      if (current.stroke.length + pointCount >= MAX_POINTS) {
        setLimitReached(true);
        break;
      }
      const last = current.stroke[current.stroke.length - 1];
      const position = relativePosition(event.currentTarget, sample);
      const candidate = makePoint(position.x, position.y, 0, 0);
      const distance =
        last === undefined ? 0 : Math.hypot(candidate.x - last.x, candidate.y - last.y);
      if (last !== undefined && distance < MIN_DISTANCE) continue;
      current.pressure = nextPressure(current.pressure, {
        penPressure: penPressure(sample),
        distance,
        elapsedMs: sample.timeStamp - current.lastAt,
      });
      current.lastAt = sample.timeStamp;
      current.stroke.push(
        makePoint(position.x, position.y, current.pressure, sample.timeStamp - current.startedAt),
      );
    }
    schedulePaint();
  }

  function discard(event: PointerEvent<SVGSVGElement>) {
    if (active.current?.pointerId !== event.pointerId) return;
    active.current = null;
    setDrawing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function begin(event: PointerEvent<SVGSVGElement>) {
    if (readOnly || event.button !== 0) return;
    const isPen = event.pointerType === 'pen';
    if (isPen) lastPenAt.current = event.timeStamp;
    const current = active.current;
    if (current !== null) {
      // A pen landing while a touch stroke is in progress means the touch was a palm.
      if (!isPen || current.pointerType !== 'touch') return;
      active.current = null;
      if (event.currentTarget.hasPointerCapture(current.pointerId)) {
        event.currentTarget.releasePointerCapture(current.pointerId);
      }
    } else if (
      event.pointerType === 'touch' &&
      event.timeStamp - lastPenAt.current < PALM_REJECTION_MS
    ) {
      return;
    }
    if (atLimit) {
      setLimitReached(true);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const position = relativePosition(event.currentTarget, event);
    const pressure = penPressure(event) ?? INITIAL_PRESSURE;
    active.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      stroke: [makePoint(position.x, position.y, pressure, 0)],
      startedAt: event.timeStamp,
      lastAt: event.timeStamp,
      pressure,
    };
    setDrawing(true);
    schedulePaint();
  }

  const half = VIEW_SIZE / 2;

  return (
    <section className="drawing-pad" aria-label={label}>
      <p id={descriptionId} className="muted">
        {readOnly
          ? 'Submitted drawing. This answer is frozen.'
          : 'Draw with a mouse, touch, or pen. For keyboard input, choose paper mode.'}
      </p>
      <svg
        className={`drawing-surface${readOnly ? ' drawing-surface--readonly' : ''}`}
        viewBox={`0 0 ${String(VIEW_SIZE)} ${String(VIEW_SIZE)}`}
        role="img"
        aria-label={label}
        aria-describedby={descriptionId}
        onPointerDown={begin}
        onPointerMove={(event) => {
          if (event.pointerType === 'pen') lastPenAt.current = event.timeStamp;
          appendSamples(event);
        }}
        onPointerUp={(event) => {
          const current = active.current;
          if (readOnly || current?.pointerId !== event.pointerId) return;
          appendSamples(event);
          discard(event);
          onStrokesChange([...strokes, current.stroke]);
        }}
        onPointerCancel={discard}
        onLostPointerCapture={discard}
      >
        <g className="drawing-guide" aria-hidden="true">
          <line x1={half} y1={0} x2={half} y2={VIEW_SIZE} />
          <line x1={0} y1={half} x2={VIEW_SIZE} y2={half} />
        </g>
        <g className="drawing-ink" data-testid="completed-strokes">
          {strokes.map((stroke, index) => (
            <StrokeShape key={index} stroke={stroke} />
          ))}
        </g>
        <g className="drawing-ink" aria-hidden="true">
          {drawing ? <path ref={livePath} d="" /> : null}
        </g>
      </svg>
      <div className="button-row">
        <Button
          disabled={!canEdit}
          onClick={() => {
            setLimitReached(false);
            onStrokesChange(strokes.slice(0, -1));
          }}
        >
          Undo
        </Button>
        <Button
          disabled={!canEdit}
          onClick={() => {
            setLimitReached(false);
            onStrokesChange([]);
          }}
        >
          Clear
        </Button>
      </div>
      <p role="status" className="drawing-status">
        {!readOnly && (atLimit || limitReached) ? LIMIT_MESSAGE : ''}
      </p>
    </section>
  );
}

export function DrawingPad(props: DrawingPadProps) {
  // Changing submission state discards any uncommitted pointer gesture.
  return <DrawingSurface key={props.readOnly === true ? 'frozen' : 'editable'} {...props} />;
}
