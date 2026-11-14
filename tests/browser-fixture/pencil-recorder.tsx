/**
 * Development-only page that records raw pointer input from a real device (for example an
 * iPad with Apple Pencil) while drawing on the actual DrawingPad. The recording is a JSON
 * file used to tune the brush against real data. Nothing is sent anywhere: the file is only
 * downloaded or shared from the device. Not part of the deployed app.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from '../../src/components/Button';
import { DrawingPad } from '../../src/components/DrawingPad';
import type { Stroke } from '../../src/domain/types';
import '../../src/styles/global.css';

interface Sample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
  readonly twist: number;
  readonly width: number;
  readonly height: number;
  readonly buttons: number;
}

interface RecordedEvent extends Sample {
  readonly type: string;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly coalesced: Sample[] | null;
  readonly predicted: Sample[] | null;
}

const EVENT_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;

function sampleOf(event: PointerEvent, bounds: DOMRect, origin: number): Sample {
  // Not every browser provides the angles, although the DOM types declare them.
  const hasAngles = 'altitudeAngle' in event && 'azimuthAngle' in event;
  return {
    t: Math.round((event.timeStamp - origin) * 100) / 100,
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
    pressure: event.pressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    ...(hasAngles ? { altitudeAngle: event.altitudeAngle, azimuthAngle: event.azimuthAngle } : {}),
    twist: event.twist,
    width: event.width,
    height: event.height,
    buttons: event.buttons,
  };
}

export function PencilRecorder() {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const events = useRef<RecordedEvent[]>([]);
  const origin = useRef<number | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [label, setLabel] = useState('');
  const [stats, setStats] = useState('Nothing recorded yet.');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const element = wrapper.current;
    if (element === null) return undefined;
    const record = (event: PointerEvent) => {
      // Only input that lands on the drawing surface; hover moves count too (Pencil hover).
      if (!(event.target instanceof Element) || event.target.closest('svg') === null) return;
      const svg = element.querySelector('svg.drawing-surface');
      if (svg === null) return;
      const bounds = svg.getBoundingClientRect();
      origin.current ??= event.timeStamp;
      const start = origin.current;
      const coalesced =
        typeof event.getCoalescedEvents === 'function'
          ? event.getCoalescedEvents().map((item) => sampleOf(item, bounds, start))
          : null;
      const predicted =
        typeof event.getPredictedEvents === 'function'
          ? event.getPredictedEvents().map((item) => sampleOf(item, bounds, start))
          : null;
      events.current.push({
        type: event.type,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        ...sampleOf(event, bounds, start),
        coalesced,
        predicted,
      });
    };
    for (const type of EVENT_TYPES) element.addEventListener(type, record, { capture: true });
    return () => {
      for (const type of EVENT_TYPES) element.removeEventListener(type, record, { capture: true });
    };
  }, []);

  function summarize() {
    const pressed = events.current.filter((event) => event.buttons !== 0);
    const samples = pressed.flatMap((event) =>
      event.coalesced !== null && event.coalesced.length > 0 ? event.coalesced : [event],
    );
    const pressures = samples.map((sample) => sample.pressure);
    const zero = pressures.filter((value) => value === 0).length;
    const times = samples.map((sample) => sample.t);
    const span = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 1000 : 0;
    const types = [...new Set(events.current.map((event) => event.pointerType))].join(', ');
    setStats(
      [
        `${String(strokes.length)} strokes, ${String(events.current.length)} events, ${String(samples.length)} samples while touching`,
        `pointer types: ${types || 'none'}`,
        `coalesced events: ${events.current.some((event) => event.coalesced !== null) ? 'supported' : 'not supported'}; predicted: ${events.current.some((event) => event.predicted !== null) ? 'supported' : 'not supported'}`,
        pressures.length === 0
          ? 'pressure: no samples'
          : `pressure: min ${Math.min(...pressures).toFixed(3)}, max ${Math.max(...pressures).toFixed(3)}, zero in ${String(zero)} samples`,
        span > 0
          ? `sample rate while drawing: ~${String(Math.round(samples.length / span))} Hz (includes pauses)`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  function recording() {
    const pad = wrapper.current?.querySelector('svg.drawing-surface')?.getBoundingClientRect();
    return {
      format: 'kanjipain-pointer-recording',
      version: 1,
      label,
      recordedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      pad: pad === undefined ? null : { width: pad.width, height: pad.height },
      events: events.current,
      // What the app stored from the same input, for comparison with the raw events.
      storedStrokes: strokes,
    };
  }

  function fileName() {
    const slug = label.trim() === '' ? 'drawing' : label.trim();
    return `pencil-${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  }

  async function save() {
    const file = new File([JSON.stringify(recording())], fileName(), {
      type: 'application/json',
    });
    // On iPad the share sheet offers AirDrop and Save to Files.
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        setMessage(`Shared ${file.name}.`);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10_000);
    setMessage(`Downloaded ${file.name}.`);
  }

  function reset() {
    events.current = [];
    origin.current = null;
    setStrokes([]);
    setStats('Nothing recorded yet.');
    setMessage('');
  }

  return (
    <main className="site-main">
      <h1>Pencil recorder</h1>
      <p>
        Write one kanji with the Pencil as you normally would, then save the recording. Start a new
        recording for each kanji.
      </p>
      <label>
        Kanji you are writing{' '}
        <input
          value={label}
          maxLength={20}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
        />
      </label>
      <div ref={wrapper}>
        <DrawingPad
          strokes={strokes}
          onStrokesChange={(next) => {
            // Clearing the pad starts a fresh recording, so files never accumulate drawings.
            if (next.length === 0) {
              events.current = [];
              origin.current = null;
            }
            setStrokes(next);
          }}
        />
      </div>
      <div className="button-row">
        <Button variant="primary" onClick={() => void save()}>
          Save recording
        </Button>
        <Button onClick={summarize}>Show stats</Button>
        <Button onClick={reset}>New recording</Button>
      </div>
      <p role="status">{message}</p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{stats}</pre>
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Recorder root missing.');
createRoot(root).render(<PencilRecorder />);
