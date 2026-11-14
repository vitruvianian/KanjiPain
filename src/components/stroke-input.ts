import type { Point, Stroke } from '../domain/types';
import { makePoint } from './brush';

/** One pointer sample, with the position as a fraction of the drawing surface. */
export interface InputSample {
  readonly x: number;
  readonly y: number;
  /** Event time in milliseconds. */
  readonly t: number;
  readonly pressure: number;
}

/** Samples closer than this to the previous point are dropped (0.4% of the pad). */
export const MIN_DISTANCE = 0.004;

/**
 * Pen pressure is mapped through a curve fitted to Apple Pencil recordings: ordinary writing
 * reports about 0.05–0.5 (median 0.2), so that range is spread over most of the brush range
 * instead of drawing almost every stroke thin.
 */
const PEN_FULL_PRESSURE = 0.8;
const PEN_GAMMA = 0.6;
/** Pressure assumed when a pen lands without reporting any. */
const PEN_DEFAULT_RAW = 0.2;

/** Smoothing time constants. Time-based, so 60 Hz and 240 Hz input behave the same. */
const PEN_PRESSURE_TAU_MS = 30;
const SPEED_PRESSURE_TAU_MS = 37;

/** Pressure a mouse or touch stroke starts with: a firm entry. */
const SPEED_INITIAL_PRESSURE = 0.65;
/** Normalized units per millisecond at which a mouse/touch stroke is at its thinnest. */
const FAST_SPEED = 0.004;
const SLOW_PRESSURE = 0.8;
const FAST_PRESSURE = 0.15;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function penPressureCurve(raw: number): number {
  return clamp01(clamp01(raw / PEN_FULL_PRESSURE) ** PEN_GAMMA);
}

function smoothingFactor(elapsedMs: number, tauMs: number): number {
  return elapsedMs <= 0 ? 0 : 1 - Math.exp(-elapsedMs / tauMs);
}

/**
 * Builds one stroke from pointer samples. The pressure model is chosen once, when the stroke
 * starts: a pen uses its reported pressure for the whole stroke, anything else derives
 * pressure from speed. Samples reporting no pressure (Safari reports 0 on every pen lift)
 * keep the previous value instead of switching models mid-stroke.
 */
export class StrokeBuilder {
  readonly #pen: boolean;
  readonly #startedAt: number;
  readonly #points: Point[];
  #lastT: number;
  #rawPressure: number;
  #pressure: number;

  constructor(pointerType: string, first: InputSample) {
    this.#pen = pointerType === 'pen';
    this.#startedAt = first.t;
    this.#lastT = first.t;
    this.#rawPressure = this.#pen && first.pressure > 0 ? first.pressure : PEN_DEFAULT_RAW;
    this.#pressure = this.#pen ? penPressureCurve(this.#rawPressure) : SPEED_INITIAL_PRESSURE;
    this.#points = [makePoint(first.x, first.y, this.#pressure, 0)];
  }

  get stroke(): Stroke {
    return this.#points;
  }

  get length(): number {
    return this.#points.length;
  }

  /** Adds a sample; returns false when it was too close to the previous point to keep. */
  add(sample: InputSample): boolean {
    if (this.#pen && sample.pressure > 0) this.#rawPressure = sample.pressure;
    const last = this.#points[this.#points.length - 1];
    const candidate = makePoint(sample.x, sample.y, 0, 0);
    const distance =
      last === undefined ? 0 : Math.hypot(candidate.x - last.x, candidate.y - last.y);
    if (last !== undefined && distance < MIN_DISTANCE) return false;

    const elapsed = sample.t - this.#lastT;
    const target = this.#pen
      ? penPressureCurve(this.#rawPressure)
      : this.#speedPressure(distance, elapsed);
    const tau = this.#pen ? PEN_PRESSURE_TAU_MS : SPEED_PRESSURE_TAU_MS;
    // A pen sample without pressure (every lift in Safari) leaves the width as it is.
    const reported = !this.#pen || sample.pressure > 0;
    if (reported) {
      this.#pressure = clamp01(
        this.#pressure + (target - this.#pressure) * smoothingFactor(elapsed, tau),
      );
    }
    this.#lastT = sample.t;
    this.#points.push(makePoint(sample.x, sample.y, this.#pressure, sample.t - this.#startedAt));
    return true;
  }

  /** Points for samples the browser predicts will follow: drawn for one frame, never kept. */
  preview(predicted: readonly InputSample[]): Stroke {
    if (predicted.length === 0) return this.#points;
    return [
      ...this.#points,
      ...predicted.map((sample) =>
        makePoint(sample.x, sample.y, this.#pressure, sample.t - this.#startedAt),
      ),
    ];
  }

  #speedPressure(distance: number, elapsedMs: number): number {
    if (elapsedMs <= 0) return this.#pressure;
    const speed = Math.min(1, distance / elapsedMs / FAST_SPEED);
    return SLOW_PRESSURE - (SLOW_PRESSURE - FAST_PRESSURE) * speed;
  }
}
