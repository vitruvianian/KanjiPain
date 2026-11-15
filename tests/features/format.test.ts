import { describe, expect, it } from 'vitest';

import { formatDueIn, formatInterval } from '../../src/features/format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('interval formatting', () => {
  it('writes short intervals for grade buttons', () => {
    expect(formatInterval(20_000)).toBe('<1m');
    expect(formatInterval(10 * MINUTE)).toBe('10m');
    expect(formatInterval(5 * HOUR)).toBe('5h');
    expect(formatInterval(DAY)).toBe('1d');
    expect(formatInterval(29 * DAY)).toBe('29d');
    expect(formatInterval(69 * DAY)).toBe('2.3mo');
    expect(formatInterval(90 * DAY)).toBe('3mo');
    expect(formatInterval(438 * DAY)).toBe('1.2y');
  });

  it('writes distances to a due date in words', () => {
    const now = 1_800_000_000_000;
    expect(formatDueIn(now - 1, now)).toBe('now');
    expect(formatDueIn(now + 20_000, now)).toBe('in less than a minute');
    expect(formatDueIn(now + MINUTE, now)).toBe('in 1 minute');
    expect(formatDueIn(now + 5 * HOUR, now)).toBe('in 5 hours');
    expect(formatDueIn(now + DAY, now)).toBe('in 1 day');
    expect(formatDueIn(now + 4 * DAY, now)).toBe('in 4 days');
    expect(formatDueIn(now + 69 * DAY, now)).toBe('in about 2.3 months');
    expect(formatDueIn(now + 730 * DAY, now)).toBe('in about 2 years');
  });
});
