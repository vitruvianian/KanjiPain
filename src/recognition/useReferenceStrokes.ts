import { useEffect, useState } from 'react';

import { loadReferenceStrokes } from './load';
import type { ReferenceStrokes } from './reference-data';

export type ReferenceStrokesState = ReferenceStrokes | 'loading' | 'unavailable';

/** Reference strokes for checking drawings; `unavailable` when they could not be loaded. */
export function useReferenceStrokes(): ReferenceStrokesState {
  const [state, setState] = useState<ReferenceStrokesState>('loading');

  useEffect(() => {
    let active = true;
    loadReferenceStrokes().then(
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
  }, []);

  return state;
}
