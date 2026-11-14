import { useEffect, useState } from 'react';

import type { UnixMs } from '../domain/types';

/**
 * A coarse clock for screens that display due counts. Review scheduling itself
 * always reads the system clock inside the services.
 */
export function useNow(intervalMs = 60_000): UnixMs {
  const [now, setNow] = useState<UnixMs>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return now;
}
