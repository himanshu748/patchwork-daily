import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DayKey } from './daykey';
import { dayKeyFromOrdinal, dayOrdinal } from './daykey';
import { computeStreak, playedPreviousDay } from './streak';
import { PBT_RUNS, playedDaysArb } from './test/arbitraries';

/** Written from the Grace_Rule text of Requirement 15, independently of streak.ts. */
function referenceStreak(days: readonly DayKey[]): { current: number; best: number; grace: number[] } {
  const sorted = [...new Set(days.map(dayOrdinal))].sort((a, b) => a - b);
  let current = 0;
  let best = 0;
  const grace: number[] = [];
  sorted.forEach((o, i) => {
    if (i === 0) current = 1;
    else {
      const gap = o - (sorted[i - 1] as number);
      const recentGrace = grace.some((g) => o - g >= 1 && o - g <= 6);
      if (gap === 1) current += 1;
      else if (gap === 2 && !recentGrace) {
        current += 1;
        grace.push(o);
      } else current = 1;
    }
    best = Math.max(best, current);
  });
  return { current, best, grace };
}

function replayMax(days: readonly DayKey[]): number {
  const sorted = [...new Set(days.map(dayOrdinal))].sort((a, b) => a - b);
  let max = 0;
  for (let i = 1; i <= sorted.length; i++) max = Math.max(max, computeStreak(sorted.slice(0, i).map(dayKeyFromOrdinal)).current);
  return max;
}

describe('streak', () => {
  // Feature: patchwork-daily-mosaic, Property 39: Streak invariants
  it('Property 39: Streak invariants', () => {
    fc.assert(
      fc.property(playedDaysArb, (days) => {
        const s = computeStreak(days);
        const canonical = [...new Set(days)].sort((a, b) => dayOrdinal(a) - dayOrdinal(b));
        expect(computeStreak(canonical)).toEqual(s);
        if (days.length === 0) {
          expect(s).toEqual({ current: 0, best: 0, graceDays: [], lastDay: null });
          return;
        }
        expect(s.current).toBeGreaterThanOrEqual(1);
        expect(s.best).toBeGreaterThanOrEqual(s.current);
        expect(s.best).toBe(replayMax(days));
        const g = s.graceDays.map(dayOrdinal);
        for (let i = 1; i < g.length; i++) expect((g[i] as number) - (g[i - 1] as number)).toBeGreaterThanOrEqual(7);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 40: Streaks follow the Grace_Rule
  it('Property 40: Streaks follow the Grace_Rule', () => {
    fc.assert(
      fc.property(playedDaysArb, (days) => {
        const s = computeStreak(days);
        const r = referenceStreak(days);
        expect(s.current).toBe(r.current);
        expect(s.best).toBe(r.best);
        expect(s.graceDays.map(dayOrdinal)).toEqual(r.grace);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('follows worked example 1 row by row', () => {
    const rows: [string, number, number][] = [
      ['2026-11-30', 1, 1],
      ['2026-12-01', 2, 2],
      ['2026-12-03', 3, 3],
      ['2026-12-04', 4, 4],
    ];
    const played: DayKey[] = [];
    for (const [d, current, best] of rows) {
      played.push(d as DayKey);
      const s = computeStreak(played);
      expect([s.current, s.best]).toEqual([current, best]);
    }
    expect(computeStreak(played).graceDays).toEqual(['2026-12-03']);
  });

  it('follows worked example 2 row by row', () => {
    const played = ['2026-11-30', '2026-12-01', '2026-12-03', '2026-12-04'] as DayKey[];
    const rows: [string, number, number][] = [
      ['2026-12-06', 1, 4],
      ['2026-12-07', 2, 4],
      ['2026-12-10', 1, 4],
    ];
    for (const [d, current, best] of rows) {
      played.push(d as DayKey);
      const s = computeStreak(played);
      expect([s.current, s.best]).toEqual([current, best]);
    }
    expect(computeStreak(played).graceDays).toEqual(['2026-12-03']);
    expect(computeStreak(played).lastDay).toBe('2026-12-10');
  });

  it('knows whether the previous Day_Key was played', () => {
    const played = ['2026-12-01', '2026-12-03'] as DayKey[];
    expect(playedPreviousDay(played, '2026-12-02' as DayKey)).toBe(true);
    expect(playedPreviousDay(played, '2026-12-03' as DayKey)).toBe(false);
    expect(playedPreviousDay([], '2026-12-03' as DayKey)).toBe(false);
  });
});
