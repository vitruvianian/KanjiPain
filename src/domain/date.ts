import type { UnixMs } from './types';

function padTwo(value: number): string {
  return value.toString().padStart(2, '0');
}

export function localDayKey(timestamp: UnixMs): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError('A local day key requires a valid timestamp.');
  }

  return `${String(date.getFullYear())}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
}
