import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DayKey } from './daykey';
import {
  InvalidDayKeyError,
  MS_PER_DAY,
  addDays,
  dayKeyFromMs,
  dayKeyFromOrdinal,
  dayNumber,
  dayOrdinal,
  msUntilNextUtcMidnight,
  parseDayKey,
  tileSizeFor,
  utcWeekday,
  voteCloseMs,
  voteWeekMonday,
} from './daykey';
import { generateMosaic } from './mosaic';
import { PBT_RUNS, badDayKeyArb, dayKeyArb } from './test/arbitraries';
import { pixelsDigest } from './test/digest';

/** Independent check with the built-in UTC calendar (tests may use Date; shared code may not). */
function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function jsWeekday(d: DayKey): number {
  const dt = new Date(0);
  dt.setUTCFullYear(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return dt.getUTCDay();
}

describe('daykey', () => {
  // Feature: patchwork-daily-mosaic, Property 1: Day_Key validation
  it('Property 1: Day_Key validation', () => {
    fc.assert(
      fc.property(fc.oneof(badDayKeyArb, dayKeyArb.map(String)), (s) => {
        const parsed = parseDayKey(s);
        expect(parsed !== null).toBe(isRealDate(s));
        if (parsed === null) {
          expect(() => generateMosaic(s)).toThrow(InvalidDayKeyError);
        } else {
          expect(dayKeyFromOrdinal(dayOrdinal(parsed))).toBe(s);
        }
      }),
      { numRuns: PBT_RUNS },
    );
    fc.assert(
      fc.property(fc.integer({ min: -719_162, max: 2_932_896 }), (o) => {
        const key = parseDayKey(dayKeyFromOrdinal(o));
        expect(key).not.toBeNull();
        expect(dayOrdinal(key as DayKey)).toBe(o);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 2: Tile_Size and Mosaic side follow the UTC weekday only
  it('Property 2: Tile_Size and Mosaic side follow the UTC weekday only', () => {
    fc.assert(
      fc.property(dayKeyArb, (d) => {
        const wd = jsWeekday(d);
        expect(utcWeekday(d)).toBe(wd);
        expect(tileSizeFor(d)).toBe(wd >= 1 && wd <= 3 ? 5 : wd === 4 || wd === 5 ? 6 : 7);
      }),
      { numRuns: PBT_RUNS },
    );
    // Generation is the expensive part, so the time-zone half runs one Day_Key per weekday under 4 zones.
    const week = Array.from({ length: 7 }, (_, k) => addDays('2026-11-30' as DayKey, k));
    const saved = process.env.TZ;
    const digests = new Map<string, string>();
    try {
      for (const tz of ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Kolkata']) {
        process.env.TZ = tz;
        for (const d of week) {
          const m = generateMosaic(d);
          expect(m.side).toBe(8 * tileSizeFor(d));
          expect(m.pixels.length).toBe(m.side * m.side);
          const digest = `${pixelsDigest(m.pixels)} ${m.motifName}`;
          const before = digests.get(d);
          if (before === undefined) digests.set(d, digest);
          else expect(digest).toBe(before);
        }
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  // Feature: patchwork-daily-mosaic, Property 52: Countdown target
  it('Property 52: Countdown target', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), (now) => {
        const left = msUntilNextUtcMidnight(now);
        expect(left).toBeGreaterThanOrEqual(1);
        expect(left).toBeLessThanOrEqual(MS_PER_DAY);
        expect((now + left) % MS_PER_DAY).toBe(0);
      }),
      { examples: [[0], [MS_PER_DAY - 1], [MS_PER_DAY]], numRuns: PBT_RUNS },
    );
  });

  it('rejects the Req 3.9 examples and accepts leap days', () => {
    for (const s of ['2026-02-30', '2026-1-5', '', '2026-13-01', '2025-02-29', '2100-02-29']) expect(parseDayKey(s)).toBeNull();
    for (const s of ['2028-02-29', '2000-02-29', '2026-12-31']) expect(parseDayKey(s)).toBe(s);
    expect(() => generateMosaic('2026-02-30')).toThrow(InvalidDayKeyError);
  });

  it('gives the weekday and Tile_Size of one known week', () => {
    const week = Array.from({ length: 7 }, (_, k) => addDays('2026-11-30' as DayKey, k));
    expect(week).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
    expect(week.map(utcWeekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(week.map(tileSizeFor)).toEqual([5, 5, 5, 6, 6, 7, 7]);
  });

  it('computes Day_Number, vote week and vote close', () => {
    const d = '2026-12-03' as DayKey;
    expect(dayNumber(d, '2026-11-30' as DayKey)).toBe(4);
    expect(dayNumber(d, d)).toBe(1);
    expect(voteWeekMonday(d)).toBe('2026-11-30');
    expect(voteWeekMonday('2026-12-06' as DayKey)).toBe('2026-11-30');
    expect(voteWeekMonday('2026-11-30' as DayKey)).toBe('2026-11-30');
    expect(voteCloseMs('2026-11-30' as DayKey)).toBe(Date.UTC(2026, 11, 5, 12));
    expect(dayKeyFromMs(Date.UTC(2026, 11, 5, 23, 59, 59, 999))).toBe('2026-12-05');
    expect(dayKeyFromMs(Date.UTC(2026, 11, 6))).toBe('2026-12-06');
  });
});
