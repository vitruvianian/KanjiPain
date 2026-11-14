import type { UnixMs } from './types';

export interface Clock {
  now(): UnixMs;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
