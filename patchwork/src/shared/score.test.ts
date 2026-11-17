import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MIN_SOLVE_MS, PAR_BASE, computeScore, parFor, solveMsFrom } from './score';
import { PBT_RUNS, sizeArb } from './test/arbitraries';

const difficultyArb = fc.integer({ min: 1, max: 100 });
const parSecondsArb = fc.integer({ min: 10, max: 600 });

describe('score', () => {
  // Feature: patchwork-daily-mosaic, Property 17: Par range and monotonicity
  it('Property 17: Par range and monotonicity', () => {
    fc.assert(
      fc.property(difficultyArb, difficultyArb, sizeArb, sizeArb, (d1, d2, n1, n2) => {
        const p = parFor(d1, n1);
        expect(Number.isInteger(p.seconds)).toBe(true);
        expect(p.seconds).toBeGreaterThanOrEqual(10);
        expect(p.seconds).toBeLessThanOrEqual(600);
        expect(Number.isInteger(p.mistakeAllowance)).toBe(true);
        expect(p.mistakeAllowance).toBeGreaterThanOrEqual(0);
        expect(p.mistakeAllowance).toBeLessThanOrEqual(5);
        const [lo, hi] = d1 <= d2 ? [d1, d2] : [d2, d1];
        expect(parFor(hi, n1).seconds).toBeGreaterThanOrEqual(parFor(lo, n1).seconds);
        const [small, large] = n1 <= n2 ? [n1, n2] : [n2, n1];
        expect(parFor(d1, large).seconds).toBeGreaterThanOrEqual(parFor(d1, small).seconds);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 31: Score bounds and monotonicity
  it('Property 31: Score bounds and monotonicity', () => {
    const msArb = fc.integer({ min: 0, max: 10_000_000 });
    const mistakesArb = fc.integer({ min: 0, max: 60 });
    fc.assert(
      fc.property(msArb, msArb, mistakesArb, mistakesArb, parSecondsArb, (ms1, ms2, m1, m2, par) => {
        const s = computeScore({ solveMs: ms1, mistakes: m1, parSeconds: par });
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBe(computeScore({ solveMs: Math.max(MIN_SOLVE_MS, ms1), mistakes: m1, parSeconds: par }));
        const [fast, slow] = ms1 <= ms2 ? [ms1, ms2] : [ms2, ms1];
        expect(computeScore({ solveMs: fast, mistakes: m1, parSeconds: par })).toBeGreaterThanOrEqual(
          computeScore({ solveMs: slow, mistakes: m1, parSeconds: par }),
        );
        const [few, many] = m1 <= m2 ? [m1, m2] : [m2, m1];
        expect(computeScore({ solveMs: ms1, mistakes: few, parSeconds: par })).toBeGreaterThanOrEqual(
          computeScore({ solveMs: ms1, mistakes: many, parSeconds: par }),
        );
      }),
      { numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 32: Scores compare across Tile_Sizes
  it('Property 32: Scores compare across Tile_Sizes', () => {
    fc.assert(
      fc.property(
        parSecondsArb,
        parSecondsArb,
        fc.integer({ min: 100, max: 100_000 }),
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 0, max: 20 }),
        (par1, par2, k, q, mistakes) => {
          // Equal ratios with integer milliseconds: solveMs is the Par seconds times one shared factor.
          const ms1 = par1 * k * q;
          const ms2 = par2 * k * q;
          expect(ms1 * par2).toBe(ms2 * par1);
          const a = computeScore({ solveMs: ms1, mistakes, parSeconds: par1 });
          const b = computeScore({ solveMs: ms2, mistakes, parSeconds: par2 });
          expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
          expect(computeScore({ solveMs: ms1, mistakes, parSeconds: par1 })).toBe(a);
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });

  it('applies the OQ-13 formula, the 1 s floor and the Par extremes', () => {
    expect(computeScore({ solveMs: 30_000, mistakes: 1, parSeconds: 60 })).toBe(1900);
    expect(computeScore({ solveMs: 60_000, mistakes: 0, parSeconds: 60 })).toBe(1000);
    expect(computeScore({ solveMs: 200, mistakes: 0, parSeconds: 22 })).toBe(22_000);
    expect(computeScore({ solveMs: 1_000_000, mistakes: 5, parSeconds: 22 })).toBe(0);
    expect(solveMsFrom(10_000, 10_400)).toBe(MIN_SOLVE_MS);
    expect(solveMsFrom(10_000, 25_000)).toBe(15_000);
    expect(parFor(1, 5).seconds).toBe(22);
    expect(parFor(100, 7).seconds).toBe(250);
    expect(PAR_BASE).toEqual({ 5: 20, 6: 35, 7: 50 });
  });
});
