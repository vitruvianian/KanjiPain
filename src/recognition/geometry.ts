export interface Vec {
  readonly x: number;
  readonly y: number;
}

export type Line = readonly Vec[];

/** Uniform scale then translation: `p' = scale · p + (dx, dy)`. */
export interface Transform {
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}

export const IDENTITY: Transform = { scale: 1, dx: 0, dy: 0 };

export function applyTransform(transform: Transform, point: Vec): Vec {
  return {
    x: transform.scale * point.x + transform.dx,
    y: transform.scale * point.y + transform.dy,
  };
}

/** The transform equal to applying `first`, then `second`. */
export function composeTransforms(first: Transform, second: Transform): Transform {
  return {
    scale: second.scale * first.scale,
    dx: second.scale * first.dx + second.dx,
    dy: second.scale * first.dy + second.dy,
  };
}

export function invertTransform(transform: Transform): Transform {
  return {
    scale: 1 / transform.scale,
    dx: -transform.dx / transform.scale,
    dy: -transform.dy / transform.scale,
  };
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lineLength(line: Line): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    total += distance(line[index - 1] as Vec, line[index] as Vec);
  }
  return total;
}

/** `count` points evenly spaced along the line. A dot yields `count` copies of itself. */
export function resample(line: Line, count: number): Vec[] {
  const first = line[0];
  if (first === undefined) return [];
  const total = lineLength(line);
  if (total === 0 || count < 2) return Array.from({ length: count }, () => first);
  const step = total / (count - 1);
  const result: Vec[] = [first];
  let travelled = 0;
  let segment = 1;
  let from = first;
  while (result.length < count - 1 && segment < line.length) {
    const to = line[segment] as Vec;
    const length = distance(from, to);
    const target = result.length * step;
    if (travelled + length >= target && length > 0) {
      const ratio = (target - travelled) / length;
      result.push({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio });
    } else {
      travelled += length;
      from = to;
      segment += 1;
    }
  }
  const last = line[line.length - 1] as Vec;
  while (result.length < count) result.push(last);
  return result;
}

/**
 * Maps a drawing into a unit frame: scaled uniformly by its longer side and centred on
 * (0.5, 0.5), so position and size on the pad do not matter and proportions are kept.
 */
export function unitFrame(lines: readonly Line[]): Transform {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of lines) {
    for (const point of line) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (minX === Infinity) return IDENTITY;
  const size = Math.max(maxX - minX, maxY - minY);
  const scale = size > 1e-6 ? 1 / size : 1;
  return {
    scale,
    dx: 0.5 - (scale * (minX + maxX)) / 2,
    dy: 0.5 - (scale * (minY + maxY)) / 2,
  };
}

/**
 * Least-squares uniform scale and translation taking each `from` point onto its paired `to`
 * point. Returns null when the points are degenerate.
 */
export function fitTransform(from: readonly Vec[], to: readonly Vec[]): Transform | null {
  const count = Math.min(from.length, to.length);
  if (count === 0) return null;
  let fromX = 0;
  let fromY = 0;
  let toX = 0;
  let toY = 0;
  for (let index = 0; index < count; index += 1) {
    fromX += (from[index] as Vec).x;
    fromY += (from[index] as Vec).y;
    toX += (to[index] as Vec).x;
    toY += (to[index] as Vec).y;
  }
  fromX /= count;
  fromY /= count;
  toX /= count;
  toY /= count;
  let dot = 0;
  let spread = 0;
  for (let index = 0; index < count; index += 1) {
    const ax = (from[index] as Vec).x - fromX;
    const ay = (from[index] as Vec).y - fromY;
    dot += ax * ((to[index] as Vec).x - toX) + ay * ((to[index] as Vec).y - toY);
    spread += ax * ax + ay * ay;
  }
  if (spread < 1e-9 || dot <= 0) return null;
  const scale = dot / spread;
  return { scale, dx: toX - scale * fromX, dy: toY - scale * fromY };
}

/**
 * Minimum-cost one-to-one assignment for a square cost matrix (Hungarian algorithm).
 * Returns, for each row, the column assigned to it.
 */
export function assign(costs: readonly (readonly number[])[]): number[] {
  const size = costs.length;
  const rowPotential = new Array<number>(size + 1).fill(0);
  const columnPotential = new Array<number>(size + 1).fill(0);
  const columnRow = new Array<number>(size + 1).fill(0);
  const cameFrom = new Array<number>(size + 1).fill(0);

  for (let row = 1; row <= size; row += 1) {
    columnRow[0] = row;
    let column = 0;
    const slack = new Array<number>(size + 1).fill(Infinity);
    const visited = new Array<boolean>(size + 1).fill(false);
    do {
      visited[column] = true;
      const currentRow = columnRow[column] as number;
      let delta = Infinity;
      let next = 0;
      for (let candidate = 1; candidate <= size; candidate += 1) {
        if (visited[candidate] === true) continue;
        const reduced =
          ((costs[currentRow - 1] as readonly number[])[candidate - 1] as number) -
          (rowPotential[currentRow] as number) -
          (columnPotential[candidate] as number);
        if (reduced < (slack[candidate] as number)) {
          slack[candidate] = reduced;
          cameFrom[candidate] = column;
        }
        if ((slack[candidate] as number) < delta) {
          delta = slack[candidate] as number;
          next = candidate;
        }
      }
      for (let index = 0; index <= size; index += 1) {
        if (visited[index] === true) {
          rowPotential[columnRow[index] as number] =
            (rowPotential[columnRow[index] as number] as number) + delta;
          columnPotential[index] = (columnPotential[index] as number) - delta;
        } else {
          slack[index] = (slack[index] as number) - delta;
        }
      }
      column = next;
    } while (columnRow[column] !== 0);
    do {
      const previous = cameFrom[column] as number;
      columnRow[column] = columnRow[previous] as number;
      column = previous;
    } while (column !== 0);
  }

  const assignment = new Array<number>(size).fill(0);
  for (let column = 1; column <= size; column += 1) {
    assignment[(columnRow[column] as number) - 1] = column - 1;
  }
  return assignment;
}
