import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PERCENTILE_MIN_ENTRIES, TIME_BUCKETS, bucketFor, percentileFor } from './timedist';
import { PBT_RUNS } from './test/arbitraries';

/** Nearest integer to 100 × (S + (E - 1) / 2) / N, halves up, found by comparing exact integer fractions. */
function expectedPercentile(s: number, e: number, n: number): number {
  // Twice the value is 100 × (2S + E - 1) / N; the answer k is the smallest k with 2k + 1 > that.
  const twiceNumerator = 100 * (2 * s + e - 1);
  for (let k = 0; k <= 100; k++) if ((2 * k + 1) * n > twiceNumerator) return k;
  return 100;
}

describe('timedist', () => {
  // Feature: patchwork-daily-mosaic, Property 36: Time_Distribution bucket
  it('Property 36: Time_Distribution bucket', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 10_000_000 }), fc.integer({ min: 10, max: 600 }), (ms, par) => {
        const b = bucketFor(ms, par);
        expect(Number.isInteger(b)).toBe(true);
        if (ms >= 5 * par * 1000) {
          expect(b).toBe(50);
        } else {
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(49);
          // b / 10 <= ms / (par × 1000) < (b + 1) / 10, cross-multiplied.
          expect(b * par * 100).toBeLessThanOrEqual(ms);
          expect(ms).toBeLessThan((b + 1) * par * 100);
        }
      }),
      { examples: [[5000, 10], [4999, 10], [1000, 10]], numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 37: Percentile formula and threshold
  it('Property 37: Percentile formula and threshold', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 500 })), {
          minLength: TIME_BUCKETS,
          maxLength: TIME_BUCKETS,
        }),
        fc.integer({ min: 0, max: TIME_BUCKETS - 1 }),
        (raw, b) => {
          const counts = raw.slice();
          if ((counts[b] as number) < 1) counts[b] = 1;
          const n = counts.reduce((x, y) => x + y, 0);
          const s = counts.slice(b + 1).reduce((x, y) => x + y, 0);
          const e = counts[b] as number;
          const got = percentileFor(counts, b);
          if (n < PERCENTILE_MIN_ENTRIES) expect(got).toBeNull();
          else {
            expect(got).toBe(expectedPercentile(s, e, n));
            expect(got).toBeGreaterThanOrEqual(0);
            expect(got).toBeLessThanOrEqual(100);
          }
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });

  it('gives 65 for the worked example, null for N = 9 and bucket 50 for a ratio of 5.0', () => {
    const counts = Array<number>(TIME_BUCKETS).fill(0);
    counts[7] = 3;
    counts[8] = 12;
    counts[3] = 5;
    expect(percentileFor(counts, 7)).toBe(65);
    const nine = Array<number>(TIME_BUCKETS).fill(0);
    nine[2] = 9;
    expect(percentileFor(nine, 2)).toBeNull();
    expect(bucketFor(150_000, 30)).toBe(50);
    expect(bucketFor(149_999, 30)).toBe(49);
  });
});
