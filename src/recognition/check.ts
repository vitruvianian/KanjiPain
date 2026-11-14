import type { CheckerVerdict, Grade, KanjiId, Stroke } from '../domain/types';
import {
  applyTransform,
  assign,
  composeTransforms,
  distance,
  fitTransform,
  invertTransform,
  resample,
  unitFrame,
  type Line,
  type Transform,
  type Vec,
} from './geometry';
import type { ReferenceStrokes } from './reference-data';

/** Bump when thresholds or the algorithm change, so recorded verdicts stay interpretable. */
export const CHECKER_VERSION = 1;

/**
 * Distances are fractions of the character's size. The thresholds lean lenient: wrongly
 * rejecting a correct character costs more trust than wrongly accepting a rough one, and
 * the look-alike comparison catches drawings that fit another character better.
 */
export const THRESHOLDS = {
  /** Largest allowed cost for any single stroke. */
  stroke: 0.2,
  /** Largest allowed average cost over all strokes. */
  mean: 0.12,
  /** Another character must fit better than the target by at least this much… */
  lookalikeMargin: 0.012,
  /** …and by this fraction of the target's own cost. */
  lookalikeRatio: 0.25,
  /** A drawn stroke counts as backwards when reversing it cuts its cost to this fraction… */
  reversalRatio: 0.6,
  /** …and by at least this much. */
  reversalGain: 0.03,
  /** Strokes count as out of order when re-pairing them cuts their cost to this fraction… */
  reorderRatio: 0.6,
  /** …and by at least this much per stroke. */
  reorderGain: 0.015,
  /** Largest gap between two consecutive strokes that may have been written as one. */
  joinGap: 0.12,
} as const;

const SAMPLES = 16;
/** Most strokes that may be joined or split before the shape no longer counts as close. */
const MAX_JOINS = 2;
const MAX_JOIN_CANDIDATES = 8;

export type CheckVerdict = CheckerVerdict;

export type StrokeMark = 'ok' | 'order' | 'direction' | 'off';

export interface CheckResult {
  readonly verdict: CheckVerdict;
  readonly expectedStrokes: number;
  readonly drawnStrokes: number;
  /** One mark per drawn stroke; empty when strokes cannot be paired with the reference. */
  readonly marks: readonly StrokeMark[];
  /** For `stroke-count`: whether the overall shape still matches the character. */
  readonly shapeClose: boolean;
  /** For `lookalike`: the character the drawing fits better. */
  readonly lookalikeId: KanjiId | null;
  /** The reference strokes, placed over the drawing in pad coordinates. */
  readonly guide: readonly Stroke[];
}

export interface CheckOptions {
  /**
   * A stroke count that is also correct for this character. A few characters have two
   * accepted forms (賭 with or without the dot) and the reference data holds only one.
   */
  readonly alternateStrokeCount?: number | undefined;
}

interface Sampled {
  readonly forward: readonly Vec[];
  readonly backward: readonly Vec[];
}

function sample(line: Line, transform: Transform): Sampled {
  const forward = resample(line, SAMPLES).map((point) => applyTransform(transform, point));
  return { forward, backward: [...forward].reverse() };
}

/** Cost of drawing `drawn` where `reference` was expected: shape, position and end points. */
function strokeCost(drawn: readonly Vec[], reference: readonly Vec[]): number {
  let total = 0;
  for (let index = 0; index < SAMPLES; index += 1) {
    total += distance(drawn[index] as Vec, reference[index] as Vec);
  }
  const start = distance(drawn[0] as Vec, reference[0] as Vec);
  const end = distance(drawn[SAMPLES - 1] as Vec, reference[SAMPLES - 1] as Vec);
  return 0.6 * (total / SAMPLES) + 0.2 * start + 0.2 * end;
}

const sampledCache = new WeakMap<ReferenceStrokes, Map<KanjiId, readonly Sampled[]>>();

/** A character's reference strokes, sampled in its own unit frame. Computed once. */
function sampledReference(
  references: ReferenceStrokes,
  id: KanjiId,
): readonly Sampled[] | undefined {
  let cache = sampledCache.get(references);
  if (cache === undefined) {
    cache = new Map();
    sampledCache.set(references, cache);
  }
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const strokes = references.strokesFor(id);
  if (strokes === undefined) return undefined;
  const frame = unitFrame(strokes);
  const sampled = strokes.map((line) => sample(line, frame));
  cache.set(id, sampled);
  return sampled;
}

const ROUGH_INDEXES = [0, Math.floor(SAMPLES / 2), SAMPLES - 1] as const;

function roughStrokeCost(drawn: readonly Vec[], reference: readonly Vec[]): number {
  let total = 0;
  for (const index of ROUGH_INDEXES) {
    total += distance(drawn[index] as Vec, reference[index] as Vec);
  }
  return total / ROUGH_INDEXES.length;
}

/**
 * A fast estimate of how far a drawing is from a reference with the same stroke count:
 * each drawn stroke against its nearest reference stroke, on three points, either direction.
 * Used to discard distant characters before the full comparison.
 */
export function roughCost(drawn: readonly Sampled[], reference: readonly Sampled[]): number {
  let total = 0;
  for (const stroke of drawn) {
    let nearest = Infinity;
    for (const target of reference) {
      nearest = Math.min(
        nearest,
        roughStrokeCost(stroke.forward, target.forward),
        roughStrokeCost(stroke.backward, target.forward),
      );
    }
    total += nearest;
  }
  return total / Math.max(1, drawn.length);
}

/** Rough distance between two reference characters; Infinity if stroke counts differ. */
export function referenceDistance(references: ReferenceStrokes, a: KanjiId, b: KanjiId): number {
  const first = sampledReference(references, a);
  const second = sampledReference(references, b);
  if (first === undefined || second === undefined) return Infinity;
  return first.length === second.length ? roughCost(first, second) : Infinity;
}

interface Pairing {
  /** Reference stroke index for each drawn stroke. */
  readonly assignment: readonly number[];
  /** Whether each drawn stroke only fits when reversed. */
  readonly reversed: readonly boolean[];
  readonly costs: readonly number[];
  readonly mean: number;
}

function summarize(
  assignment: readonly number[],
  reversed: readonly boolean[],
  costs: readonly number[],
): Pairing {
  const mean = costs.reduce((total, cost) => total + cost, 0) / Math.max(1, costs.length);
  return { assignment, reversed, costs, mean };
}

function passes(pairing: Pairing): boolean {
  return (
    pairing.mean <= THRESHOLDS.mean && pairing.costs.every((cost) => cost <= THRESHOLDS.stroke)
  );
}

/** Best pairing of drawn strokes to reference strokes, ignoring order and direction. */
function bestPairing(drawn: readonly Sampled[], reference: readonly Sampled[]): Pairing {
  const forward = drawn.map((stroke) =>
    reference.map((target) => strokeCost(stroke.forward, target.forward)),
  );
  const backward = drawn.map((stroke) =>
    reference.map((target) => strokeCost(stroke.backward, target.forward)),
  );
  const matrix = forward.map((row, i) =>
    row.map((cost, j) => Math.min(cost, (backward[i] as number[])[j] as number)),
  );
  const assignment = assign(matrix);
  const reversed = assignment.map(
    (j, i) => ((backward[i] as number[])[j] as number) < ((forward[i] as number[])[j] as number),
  );
  const costs = assignment.map((j, i) => (matrix[i] as number[])[j] as number);
  return summarize(assignment, reversed, costs);
}

/** Pairs each drawn stroke with the reference stroke at the same position. */
function inOrderPairing(drawn: readonly Sampled[], reference: readonly Sampled[]): Pairing {
  const reversed: boolean[] = [];
  const costs = drawn.map((stroke, index) => {
    const target = (reference[index] as Sampled).forward;
    const forward = strokeCost(stroke.forward, target);
    const backward = strokeCost(stroke.backward, target);
    reversed.push(
      backward < THRESHOLDS.reversalRatio * forward && forward - backward > THRESHOLDS.reversalGain,
    );
    return forward;
  });
  return summarize(
    drawn.map((_, index) => index),
    reversed,
    costs,
  );
}

/** Whether re-pairing the strokes fits clearly better than taking them in the drawn order. */
function clearlyReordered(inOrder: Pairing, best: Pairing): boolean {
  let moved = 0;
  let inOrderCost = 0;
  let bestCost = 0;
  best.assignment.forEach((j, i) => {
    if (j === i) return;
    moved += 1;
    inOrderCost += inOrder.costs[i] as number;
    bestCost += best.costs[i] as number;
  });
  return (
    moved > 0 &&
    bestCost < THRESHOLDS.reorderRatio * inOrderCost &&
    (inOrderCost - bestCost) / moved > THRESHOLDS.reorderGain
  );
}

interface Comparison {
  readonly best: Pairing;
  readonly inOrder: Pairing;
  /** Maps pad coordinates of the drawing into the reference's unit frame. */
  readonly drawnToFrame: Transform;
}

/**
 * Compares two drawings with equal stroke counts. Both start in their own unit frame; the
 * drawing is then re-fitted onto the reference using the paired strokes, which absorbs an
 * over-long stroke or an off-centre drawing that the bounding box alone would not.
 */
function compare(
  drawnLines: readonly Line[],
  drawnFrame: Transform,
  reference: readonly Sampled[],
  refine: boolean,
): Comparison {
  let frame = drawnFrame;
  let drawn = drawnLines.map((line) => sample(line, frame));
  let best = bestPairing(drawn, reference);
  if (refine) {
    const from: Vec[] = [];
    const to: Vec[] = [];
    best.assignment.forEach((j, i) => {
      const stroke = drawn[i] as Sampled;
      from.push(...(best.reversed[i] === true ? stroke.backward : stroke.forward));
      to.push(...(reference[j] as Sampled).forward);
    });
    const fit = fitTransform(from, to);
    if (fit !== null && fit.scale > 0.6 && fit.scale < 1.6) {
      const refinedFrame = composeTransforms(frame, fit);
      const refinedDrawn = drawnLines.map((line) => sample(line, refinedFrame));
      const refinedBest = bestPairing(refinedDrawn, reference);
      if (refinedBest.mean < best.mean) {
        frame = refinedFrame;
        drawn = refinedDrawn;
        best = refinedBest;
      }
    }
  }
  return { best, inOrder: inOrderPairing(drawn, reference), drawnToFrame: frame };
}

function* combinations(items: readonly number[], size: number, from = 0): Generator<number[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let index = from; index <= items.length - size; index += 1) {
    for (const rest of combinations(items, size - 1, index + 1)) {
      yield [items[index] as number, ...rest];
    }
  }
}

/**
 * Whether two drawings with different stroke counts are the same shape, with some
 * consecutive strokes of the longer one written as a single stroke in the shorter one.
 * A missing or extra stroke does not qualify: every stroke must still find its partner.
 */
function sameShapeWithJoins(drawn: readonly Line[], target: readonly Line[]): boolean {
  const drawnIsLonger = drawn.length > target.length;
  const longer = drawnIsLonger ? drawn : target;
  const shorter = drawnIsLonger ? target : drawn;
  const joins = longer.length - shorter.length;
  if (joins > MAX_JOINS) return false;

  const frame = unitFrame(longer);
  const joinable: number[] = [];
  for (let index = 0; index + 1 < longer.length; index += 1) {
    const end = (longer[index] as Line).at(-1);
    const start = (longer[index + 1] as Line)[0];
    if (
      end !== undefined &&
      start !== undefined &&
      distance(applyTransform(frame, end), applyTransform(frame, start)) <= THRESHOLDS.joinGap
    ) {
      joinable.push(index);
    }
  }
  if (joinable.length < joins || joinable.length > MAX_JOIN_CANDIDATES) return false;

  const shorterFrame = unitFrame(shorter);
  for (const chosen of combinations(joinable, joins)) {
    const joined: Vec[][] = [];
    longer.forEach((line, index) => {
      const previous = joined.at(-1);
      if (previous !== undefined && chosen.includes(index - 1)) previous.push(...line);
      else joined.push([...line]);
    });
    const [drawnLines, drawnFrame, referenceLines, referenceFrame] = drawnIsLonger
      ? [joined, frame, shorter, shorterFrame]
      : [shorter, shorterFrame, joined, frame];
    const result = compare(
      drawnLines,
      drawnFrame,
      referenceLines.map((line) => sample(line, referenceFrame)),
      true,
    );
    if (passes(result.best)) return true;
  }
  return false;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function guideFor(reference: readonly Line[], referenceToPad: Transform): Stroke[] {
  return reference.map((line) =>
    line.map((point) => {
      const placed = applyTransform(referenceToPad, point);
      return { x: clamp01(placed.x), y: clamp01(placed.y) };
    }),
  );
}

/**
 * Decides whether `drawn` is the character `targetId`. Returns null when the drawing cannot
 * be checked: no strokes, no reference data, or an alternate written form.
 */
export function checkDrawing(
  drawn: readonly Stroke[],
  targetId: KanjiId,
  references: ReferenceStrokes,
  options: CheckOptions = {},
): CheckResult | null {
  const target = references.strokesFor(targetId);
  if (target === undefined || drawn.length === 0) return null;
  // An accepted written form that the reference data does not cover cannot be judged.
  if (drawn.length !== target.length && drawn.length === options.alternateStrokeCount) return null;

  const drawnFrame = unitFrame(drawn);
  const targetFrame = unitFrame(target);
  const base = {
    expectedStrokes: target.length,
    drawnStrokes: drawn.length,
    shapeClose: false,
    lookalikeId: null,
  };

  if (drawn.length !== target.length) {
    const referenceToPad = composeTransforms(targetFrame, invertTransform(drawnFrame));
    return {
      ...base,
      verdict: 'stroke-count',
      marks: [],
      shapeClose: sameShapeWithJoins(drawn, target),
      guide: guideFor(target, referenceToPad),
    };
  }

  const own = compare(drawn, drawnFrame, sampledReference(references, targetId) ?? [], true);
  const guide = guideFor(target, composeTransforms(targetFrame, invertTransform(own.drawnToFrame)));

  // Does another character with the same number of strokes fit clearly better?
  const needed = Math.max(THRESHOLDS.lookalikeMargin, THRESHOLDS.lookalikeRatio * own.best.mean);
  const drawnSampled = drawn.map((line) => sample(line, drawnFrame));
  let rival: { id: KanjiId; mean: number } | null = null;
  for (const id of references.idsWithStrokeCount(drawn.length)) {
    if (id === targetId) continue;
    const sampled = sampledReference(references, id);
    // Skip the full comparison for characters that are nowhere near.
    if (sampled === undefined || roughCost(drawnSampled, sampled) > 1.5 * THRESHOLDS.mean) {
      continue;
    }
    const fitted = compare(drawn, drawnFrame, sampled, true);
    if (
      passes(fitted.best) &&
      fitted.best.mean + needed < own.best.mean &&
      (rival === null || fitted.best.mean < rival.mean)
    ) {
      rival = { id, mean: fitted.best.mean };
    }
  }
  if (rival !== null) {
    return { ...base, verdict: 'lookalike', marks: [], lookalikeId: rival.id, guide };
  }

  const reordered = clearlyReordered(own.inOrder, own.best);
  const backwards = own.inOrder.reversed.includes(true);
  if (passes(own.inOrder) && !reordered && !backwards) {
    return { ...base, verdict: 'match', marks: drawn.map(() => 'ok'), guide };
  }
  if (passes(own.best) || passes(own.inOrder)) {
    if (reordered) {
      return {
        ...base,
        verdict: 'order',
        marks: own.best.assignment.map((j, i) =>
          j !== i ? 'order' : own.best.reversed[i] === true ? 'direction' : 'ok',
        ),
        guide,
      };
    }
    const reversed = backwards ? own.inOrder.reversed : own.best.reversed;
    return {
      ...base,
      verdict: reversed.includes(true) ? 'direction' : 'order',
      marks: reversed.map((flag, i) =>
        flag ? 'direction' : own.best.assignment[i] !== i ? 'order' : 'ok',
      ),
      guide,
    };
  }
  return {
    ...base,
    verdict: 'mismatch',
    marks: own.best.costs.map((cost) => (cost <= THRESHOLDS.stroke ? 'ok' : 'off')),
    guide,
  };
}

/** The grade the checker proposes. The learner's own choice is what gets recorded. */
export function suggestedGrade(result: CheckResult): Grade {
  switch (result.verdict) {
    case 'match':
      return 'got';
    case 'order':
    case 'direction':
      return 'barely';
    case 'stroke-count':
      return result.shapeClose ? 'barely' : 'missed';
    default:
      return 'missed';
  }
}
