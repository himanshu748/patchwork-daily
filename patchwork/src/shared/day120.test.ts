import { describe, expect, it } from 'vitest';
import type { DayKey } from './daykey';
import { addDays, utcWeekday } from './daykey';
import { buildDay } from './mosaic';
import type { PerturbationKind } from './slicer';
import { sliceToTiles } from './slicer';
import { solveNonogram } from './solver';

const WINDOW_START = '2026-11-30' as DayKey;
const WINDOW_DAYS = 120;
const MAX_SOLVE_MS = 50;
const MAX_SLICE_MS = 5000;

describe('120-day window', () => {
  const days = Array.from({ length: WINDOW_DAYS }, (_, k) => addDays(WINDOW_START, k));
  const sums = new Map<DayKey, number>();
  let longestSolve = 0;
  let longestSlice = 0;
  const kinds: Record<PerturbationKind, number> = { unchanged: 0, perturbed: 0, fallback: 0 };

  it(
    'has 7,680 uniquely solvable Tiles within the time limits (Req 28.3, Req 4.4, Req 4.10, Req 5.5)',
    () => {
      expect(days[0]).toBe('2026-11-30');
      expect(days[WINDOW_DAYS - 1]).toBe('2027-03-29');
      expect(utcWeekday(days[WINDOW_DAYS - 1] as DayKey)).toBe(1);
      // Untimed warm-up so start-up compilation is not counted.
      buildDay('2026-11-23');
      let tiles = 0;
      for (const d of days) {
        const built = buildDay(d);
        sums.set(d, built.difficultySum);
        const t0 = performance.now();
        const again = sliceToTiles(built.mosaic, d);
        longestSlice = Math.max(longestSlice, performance.now() - t0);
        expect(again.ok).toBe(true);
        for (const tile of built.slice.tiles) {
          kinds[tile.perturbation.kind]++;
          const s0 = performance.now();
          const res = solveNonogram(tile.clues);
          longestSolve = Math.max(longestSolve, performance.now() - s0);
          expect(res.kind).toBe('unique');
          if (res.kind === 'unique') expect(res.solution).toEqual(tile.solution);
          tiles++;
        }
      }
      expect(tiles).toBe(7680);
      expect(longestSolve).toBeLessThan(MAX_SOLVE_MS);
      expect(longestSlice).toBeLessThan(MAX_SLICE_MS);
      console.log(
        `day120: ${tiles} Tiles unique; longest solveNonogram ${longestSolve.toFixed(2)} ms; longest sliceToTiles ${longestSlice.toFixed(1)} ms; ` +
          `Tiles unchanged ${kinds.unchanged}, perturbed ${kinds.perturbed}, fallback ${kinds.fallback}`,
      );
    },
    120_000,
  );

  // Feature: patchwork-daily-mosaic, Property 18: Weekly difficulty curve
  it('Property 18: Weekly difficulty curve', () => {
    expect(sums.size).toBe(WINDOW_DAYS);
    const weeks = Math.floor(WINDOW_DAYS / 7);
    expect(weeks).toBe(17);
    const means: number[][] = [];
    for (let w = 0; w < weeks; w++) {
      const week = Array.from({ length: 7 }, (_, k) => sums.get(days[w * 7 + k] as DayKey) as number);
      for (let k = 1; k < 7; k++) expect(20 * (week[k] as number)).toBeGreaterThanOrEqual(19 * (week[k - 1] as number));
      expect(week[6] as number).toBeGreaterThan(week[0] as number);
      expect(week[3] as number).toBeGreaterThan(week[2] as number);
      means.push(week.map((s) => s / 64));
    }
    const avg = [0, 1, 2, 3, 4, 5, 6].map((k) => means.reduce((s, row) => s + (row[k] as number), 0) / weeks);
    console.log(`day120: mean Difficulty_Score per Tile, Monday to Sunday, averaged over ${weeks} weeks: ${avg.map((v) => v.toFixed(1)).join(', ')}`);
  });
});
