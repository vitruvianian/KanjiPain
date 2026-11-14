import { useEffect, useState } from 'react';

import type { KanjiId } from '../domain/types';
import { loadReferenceStrokesWith } from './load';
import type { ReferenceStrokes } from './reference-data';

export type ReferenceStrokesState = ReferenceStrokes | 'loading' | 'unavailable';

const NO_EXTRA_IDS: readonly KanjiId[] = [];

/**
 * Reference strokes for checking drawings; `unavailable` when they could not be loaded.
 * `extraIds` are characters outside the bundled Jōyō set, such as a custom deck's.
 */
export function useReferenceStrokes(
  extraIds: readonly KanjiId[] = NO_EXTRA_IDS,
): ReferenceStrokesState {
  const [state, setState] = useState<ReferenceStrokesState>('loading');
  const extraKey = extraIds.join(',');

  useEffect(() => {
    let active = true;
    loadReferenceStrokesWith(extraKey === '' ? [] : extraKey.split(',')).then(
      (references) => {
        if (active) setState(references);
      },
      () => {
        if (active) setState('unavailable');
      },
    );
    return () => {
      active = false;
    };
  }, [extraKey]);

  return state;
}
