import { afterAll, describe, expect, it } from 'vitest';

import { localDayKey } from '../../src/domain/date';

const originalTimezone = process.env.TZ;

afterAll(() => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
});

describe('localDayKey', () => {
  it('uses the device calendar day rather than the UTC day', () => {
    process.env.TZ = 'America/Los_Angeles';
    const earlyUtcNewYear = Date.UTC(2026, 0, 1, 1, 30);

    expect(new Date(earlyUtcNewYear).toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(localDayKey(earlyUtcNewYear)).toBe('2025-12-31');
  });

  it('zero-pads month and day values', () => {
    process.env.TZ = 'Asia/Tokyo';
    const timestamp = new Date(2026, 2, 4, 12).getTime();

    expect(localDayKey(timestamp)).toBe('2026-03-04');
  });

  it('rejects invalid timestamps', () => {
    expect(() => localDayKey(Number.NaN)).toThrow(RangeError);
  });
});
