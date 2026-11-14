import { ReferenceStrokes } from './reference-data';

let pending: Promise<ReferenceStrokes> | null = null;

/**
 * Loads the reference stroke data once, as its own chunk. A failed load is not cached, so a
 * later call tries again.
 */
export function loadReferenceStrokes(): Promise<ReferenceStrokes> {
  pending ??= import('../data/strokes.generated.json')
    .then((module) => new ReferenceStrokes(module.default))
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
