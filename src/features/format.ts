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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function oneDecimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * A length of time in the short form flashcard apps put on their answer buttons:
 * "<1m", "10m", "5h", "4d", "2.3mo", "1.2y".
 */
export function formatInterval(milliseconds: number): string {
  if (milliseconds < MINUTE) return '<1m';
  if (milliseconds < HOUR) return `${String(Math.round(milliseconds / MINUTE))}m`;
  if (milliseconds < DAY) return `${String(Math.round(milliseconds / HOUR))}h`;
  if (milliseconds < MONTH) return `${String(Math.round(milliseconds / DAY))}d`;
  if (milliseconds < YEAR) return `${oneDecimal(milliseconds / MONTH)}mo`;
  return `${oneDecimal(milliseconds / YEAR)}y`;
}

function count(value: number, unit: string): string {
  return `${String(value)} ${unit}${value === 1 ? '' : 's'}`;
}

/** How far away a moment is, in words: "in 4 days", "in about 2.3 months", "now". */
export function formatDueIn(dueAt: UnixMs, now: UnixMs): string {
  const remaining = dueAt - now;
  if (remaining <= 0) return 'now';
  if (remaining < MINUTE) return 'in less than a minute';
  if (remaining < HOUR) return `in ${count(Math.round(remaining / MINUTE), 'minute')}`;
  if (remaining < DAY) return `in ${count(Math.round(remaining / HOUR), 'hour')}`;
  if (remaining < MONTH) return `in ${count(Math.round(remaining / DAY), 'day')}`;
  if (remaining < YEAR) return `in about ${oneDecimal(remaining / MONTH)} months`;
  return `in about ${oneDecimal(remaining / YEAR)} years`;
}
