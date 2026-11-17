import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TILE_COUNT, candidateFrom, pickTile } from './assignment';
import { PBT_RUNS, solveCountsArb } from './test/arbitraries';

describe('assignment', () => {
  // Feature: patchwork-daily-mosaic, Property 19: Tile choice rule
  it('Property 19: Tile choice rule', () => {
    fc.assert(
      fc.property(
        solveCountsArb,
        fc.integer({ min: 0, max: 63 }),
        fc.oneof(fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }), fc.constant(Array<boolean>(64).fill(true))),
        (counts, candidate, excludedFlags) => {
          const excluded = (t: number): boolean => excludedFlags[t] === true;
          const got = pickTile(counts, candidate, excluded);
          const open = counts.map((_, t) => t).filter((t) => !excluded(t));
          if (open.length === 0) {
            expect(got).toBeNull();
            return;
          }
          const min = Math.min(...open.map((t) => counts[t] as number));
          let expected = -1;
          for (let i = 0; i < TILE_COUNT && expected < 0; i++) {
            const t = (candidate + i) % TILE_COUNT;
            if (!excluded(t) && counts[t] === min) expected = t;
          }
          expect(got).toBe(expected);
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });

  it('maps counter values to candidates', () => {
    expect(candidateFrom(1)).toBe(0);
    expect(candidateFrom(64)).toBe(63);
    expect(candidateFrom(65)).toBe(0);
    expect(pickTile(Array<number>(64).fill(0), 10)).toBe(10);
    const counts = Array<number>(64).fill(1);
    counts[3] = 0;
    expect(pickTile(counts, 10)).toBe(3);
  });
});
