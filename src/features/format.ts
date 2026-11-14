import type { UnixMs } from '../domain/types';

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

export function formatDateTime(timestamp: UnixMs): string {
  return dateTimeFormatter.format(timestamp);
}

export function formatDate(timestamp: UnixMs): string {
  return dateFormatter.format(timestamp);
}
