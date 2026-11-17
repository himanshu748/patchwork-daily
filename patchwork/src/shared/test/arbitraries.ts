import fc from 'fast-check';
import type { DayKey, TileSize } from '../daykey';
import { dayKeyFromOrdinal, dayOrdinal, tileSizeFor } from '../daykey';
import type { PaletteId } from '../palette';
import { createPrng } from '../prng';
import type { MosaicSnapshot } from '../wire';
import { maskCount, packStitchedPixels } from '../wire';

/** Every generated property runs at least this many cases; a test may raise it, never lower it. */
export const PBT_RUNS = 100;

const ORD_MIN = dayOrdinal('2020-01-01' as DayKey);
const ORD_MAX = dayOrdinal('2099-12-31' as DayKey);

export const dayKeyArb: fc.Arbitrary<DayKey> = fc.integer({ min: ORD_MIN, max: ORD_MAX }).map(dayKeyFromOrdinal);

export const badDayKeyArb: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.constantFrom('', '2026-02-30', '2026-1-5', '2025-02-29', '2100-02-29', '2026-00-10', '2026-13-01', '2026-01-00', '2026-01-32', '20261-01-01', '026-01-01', '2026/01/01', ' 2026-01-01', '2026-01-01 ', '2026-04-31'),
  fc.tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 })).map(
    ([y, m, d]) => `${y}-${m}-${d}`,
  ),
  fc.tuple(fc.integer({ min: 1, max: 9999 }), fc.constantFrom(0, 13, 14, 99), fc.integer({ min: 1, max: 28 })).map(
    ([y, m, d]) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  ),
);

export const genOptsArb = fc.record({ seed: fc.integer({ min: 0, max: 999 }), motifIndex: fc.integer({ min: 0, max: 20 }) });

export const sizeArb: fc.Arbitrary<TileSize> = fc.constantFrom(5, 6, 7);

/** Every Cell filled with a probability from 0.1 to 0.9. */
export function binaryGridArb(n: TileSize): fc.Arbitrary<Uint8Array> {
  return fc
    .tuple(fc.integer({ min: 1, max: 9 }), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: n * n, maxLength: n * n }))
    .map(([p, xs]) => Uint8Array.from(xs, (x) => (x < p ? 1 : 0)));
}

export const sizedGridArb = sizeArb.chain((n) => binaryGridArb(n).map((grid) => ({ n, grid })));

export interface MosaicCase {
  readonly dayKey: DayKey;
  readonly side: number;
  readonly paper: PaletteId;
  readonly pixels: Uint8Array;
}

/**
 * Palette pixels of the right side for a random Day_Key: paper, then seeded rectangles, then seeded noise,
 * so cases range from mostly-unique blocky art to noise that needs Perturbation and fallback.
 */
export const mosaicArb: fc.Arbitrary<MosaicCase> = fc
  .record({
    dayKey: dayKeyArb,
    paper: fc.constantFrom<PaletteId>(0, 1, 2, 3),
    seed: fc.nat(),
    rects: fc.integer({ min: 0, max: 40 }),
    noise: fc.integer({ min: 0, max: 400 }),
  })
  .map(({ dayKey, paper, seed, rects, noise }) => {
    const side = 8 * tileSizeFor(dayKey);
    const prng = createPrng(seed);
    const pixels = new Uint8Array(side * side).fill(paper);
    for (let k = 0; k < rects; k++) {
      const r0 = prng.int(side);
      const c0 = prng.int(side);
      const h = 1 + prng.int(12);
      const w = 1 + prng.int(12);
      const colour = prng.int(4);
      for (let r = r0; r < Math.min(side, r0 + h); r++) for (let c = c0; c < Math.min(side, c0 + w); c++) pixels[r * side + c] = colour;
    }
    const count = Math.floor((side * side * noise) / 1000);
    for (let k = 0; k < count; k++) pixels[prng.int(side * side)] = prng.int(4);
    return { dayKey, side, paper, pixels };
  });

/** A Mosaic with a wrong side or one pixel value from 4 to 255. */
export const badMosaicArb = fc.oneof(
  fc.record({ dayKey: dayKeyArb, delta: fc.constantFrom(-16, -8, -1, 1, 8, 16), kind: fc.constant('dimensions' as const) }).map(({ dayKey, delta, kind }) => {
    const side = 8 * tileSizeFor(dayKey) + delta;
    return { dayKey, kind, mosaic: { side, pixels: new Uint8Array(side * side), paper: 0 as PaletteId } };
  }),
  fc
    .record({ dayKey: dayKeyArb, value: fc.integer({ min: 4, max: 255 }), at: fc.nat(), kind: fc.constant('content' as const) })
    .map(({ dayKey, value, at, kind }) => {
      const side = 8 * tileSizeFor(dayKey);
      const pixels = new Uint8Array(side * side);
      pixels[at % pixels.length] = value;
      return { dayKey, kind, mosaic: { side, pixels, paper: 0 as PaletteId } };
    }),
);

const nameCharArb = fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -'.split(''));
export const motifNameArb = fc
  .array(nameCharArb, { minLength: 1, maxLength: 40 })
  .map((cs) => cs.join(''))
  .filter((s) => s.trim().length > 0);

export const snapshotArb: fc.Arbitrary<{ snapshot: MosaicSnapshot; tiles: (Uint8Array | null)[] }> = fc
  .record({
    dayKey: dayKeyArb,
    dayNumber: fc.integer({ min: 1, max: 99_999 }),
    gen: fc.integer({ min: 0, max: 999 }),
    motifName: motifNameArb,
    stitched: fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
    allStitched: fc.boolean(),
    seed: fc.nat(),
    version: fc.nat(),
  })
  .map(({ dayKey, dayNumber, gen, motifName, stitched, allStitched, seed, version }) => {
    const size = tileSizeFor(dayKey);
    const prng = createPrng(seed);
    const tiles = stitched.map((s) => (s || allStitched ? Uint8Array.from({ length: size * size }, () => prng.int(4)) : null));
    const { mask, pixels } = packStitchedPixels(tiles, size);
    const total = maskCount(mask);
    const snapshot: MosaicSnapshot = {
      dayKey,
      dayNumber,
      gen,
      tileSize: size,
      motifName,
      stitchedTotal: total,
      stitchedMask: mask,
      solveCounts: tiles.map((t) => (t ? 1 : 0)),
      pixels,
      complete: total === 64,
      completeAtMs: null,
      version,
    };
    return { snapshot, tiles };
  });

/** Subsets of a 60-day span, shuffled, with duplicates. */
export const playedDaysArb: fc.Arbitrary<DayKey[]> = fc
  .record({ start: dayKeyArb, offsets: fc.array(fc.integer({ min: 0, max: 59 }), { maxLength: 80 }) })
  .map(({ start, offsets }) => offsets.map((o) => dayKeyFromOrdinal(dayOrdinal(start) + o)));

export const solveCountsArb = fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 20 })), {
  minLength: 64,
  maxLength: 64,
});
