import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DayKey, TileSize } from './daykey';
import { addDays, tileSizeFor } from './daykey';
import { cluesEqual, deriveClues } from './clues';
import { buildDay } from './mosaic';
import { FALLBACK_PATTERNS, InvalidMosaicError, PERTURBATION_ATTEMPTS, sliceToTiles, tileOrigin } from './slicer';
import type { SliceOk, Tile } from './slicer';
import { solveNonogram } from './solver';
import type { MosaicCase } from './test/arbitraries';
import { PBT_RUNS, badMosaicArb, mosaicArb } from './test/arbitraries';
import { sliceDigest, tileDigestText } from './test/digest';

const SLICE_TIMEOUT = 120_000;

function sliceOk(m: MosaicCase): SliceOk {
  const res = sliceToTiles(m, m.dayKey);
  if (!res.ok) throw new Error('Slicing with fallback allowed must resolve');
  return res;
}

function slicedPixels(m: MosaicCase, index: number, n: TileSize): Uint8Array {
  const { row0, col0 } = tileOrigin(index, n);
  const px = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) px[r * n + c] = m.pixels[(row0 + r) * m.side + col0 + c] as number;
  return px;
}

function filledCount(t: Tile): number {
  return t.solution.reduce((s, v) => s + v, 0);
}

describe('slicer', () => {
  // Feature: patchwork-daily-mosaic, Property 8: Tile geometry and final pixels
  it(
    'Property 8: Tile geometry and final pixels',
    () => {
      fc.assert(
        fc.property(mosaicArb, (m) => {
          const n = tileSizeFor(m.dayKey);
          const { tiles } = sliceOk(m);
          expect(tiles.map((t) => t.index)).toEqual(Array.from({ length: 64 }, (_, i) => i));
          for (const t of tiles) {
            expect(t.size).toBe(n);
            expect(t.solution.length).toBe(n * n);
            expect(t.pixels.length).toBe(n * n);
            expect(t.clues.rows.length).toBe(n);
            expect(t.clues.cols.length).toBe(n);
            if (t.perturbation.kind === 'unchanged') expect(t.pixels).toEqual(slicedPixels(m, t.index, n));
            const fg = t.perturbation.foreground;
            for (let c = 0; c < n * n; c++) expect(((fg >> (t.pixels[c] as number)) & 1) === 1).toBe(t.solution[c] === 1);
          }
        }),
        { numRuns: PBT_RUNS },
      );
    },
    SLICE_TIMEOUT,
  );

  // Feature: patchwork-daily-mosaic, Property 9: Slicing is deterministic
  it(
    'Property 9: Slicing is deterministic',
    () => {
      fc.assert(
        fc.property(mosaicArb, (m) => {
          const a = sliceOk(m);
          const b = sliceOk({ ...m, pixels: m.pixels.slice() });
          expect(b.tiles.map(tileDigestText)).toEqual(a.tiles.map(tileDigestText));
        }),
        { numRuns: PBT_RUNS },
      );
      const days = Array.from({ length: 14 }, (_, k) => addDays('2026-11-30' as DayKey, k));
      const digests = Object.fromEntries(days.map((d) => [d, sliceDigest(buildDay(d).slice.tiles)]));
      expect(digests).toMatchSnapshot();
    },
    SLICE_TIMEOUT,
  );

  // Feature: patchwork-daily-mosaic, Property 10: Every Tile is unique and its Clues round-trip
  it(
    'Property 10: Every Tile is unique and its Clues round-trip',
    () => {
      fc.assert(
        fc.property(mosaicArb, (m) => {
          for (const t of sliceOk(m).tiles) {
            const res = solveNonogram(t.clues);
            expect(res.kind).toBe('unique');
            if (res.kind !== 'unique') return;
            expect(res.solution).toEqual(t.solution);
            expect(cluesEqual(deriveClues(res.solution, t.size), t.clues)).toBe(true);
          }
        }),
        { numRuns: PBT_RUNS },
      );
    },
    SLICE_TIMEOUT,
  );

  // Feature: patchwork-daily-mosaic, Property 11: No uniform Tiles
  it(
    'Property 11: No uniform Tiles',
    () => {
      fc.assert(
        fc.property(mosaicArb, fc.boolean(), (m, allowFallback) => {
          const res = sliceToTiles(m, m.dayKey, { allowFallback });
          if (!res.ok) {
            expect(allowFallback).toBe(false);
            return;
          }
          for (const t of res.tiles) {
            const filled = filledCount(t);
            expect(filled).toBeGreaterThanOrEqual(1);
            expect(filled).toBeLessThanOrEqual(t.size * t.size - 1);
          }
        }),
        { numRuns: PBT_RUNS },
      );
    },
    SLICE_TIMEOUT,
  );

  // Feature: patchwork-daily-mosaic, Property 12: Perturbation stays within its bounds
  it(
    'Property 12: Perturbation stays within its bounds',
    () => {
      fc.assert(
        fc.property(mosaicArb, mosaicArb, fc.integer({ min: 0, max: 63 }), (m, other, i) => {
          const n = tileSizeFor(m.dayKey);
          const { tiles } = sliceOk(m);
          for (const t of tiles) {
            const p = t.perturbation;
            const original = slicedPixels(m, t.index, n);
            const differing = Array.from({ length: n * n }, (_, c) => c).filter((c) => t.pixels[c] !== original[c]);
            if (p.kind === 'unchanged') {
              expect(p.attempts).toBe(0);
              expect(differing).toEqual([]);
            } else if (p.kind === 'perturbed') {
              expect(p.attempts).toBeGreaterThanOrEqual(1);
              expect(p.attempts).toBeLessThanOrEqual(PERTURBATION_ATTEMPTS);
              expect(p.changedCells.length).toBeGreaterThanOrEqual(1);
              expect(p.changedCells.length).toBeLessThanOrEqual(3);
              expect(differing).toEqual(p.changedCells);
            } else {
              expect(p.attempts).toBe(PERTURBATION_ATTEMPTS);
              expect(p.fallbackIndex).not.toBeNull();
              expect(p.fallbackIndex as number).toBeLessThan(FALLBACK_PATTERNS[n].length);
              expect(differing).toEqual(p.changedCells);
            }
          }
          // Copy Tile i of m into another Mosaic with the same paper and Day_Key: Tile i must not change.
          const pixels = new Uint8Array(m.side * m.side);
          for (let k = 0; k < pixels.length; k++) pixels[k] = (other.pixels[k % other.pixels.length] as number) & 3;
          const { row0, col0 } = tileOrigin(i, n);
          for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) pixels[(row0 + r) * m.side + col0 + c] = m.pixels[(row0 + r) * m.side + col0 + c] as number;
          const twin = sliceOk({ ...m, pixels });
          expect(tileDigestText(twin.tiles[i] as Tile)).toBe(tileDigestText(tiles[i] as Tile));
        }),
        { numRuns: PBT_RUNS },
      );
    },
    SLICE_TIMEOUT,
  );

  // Feature: patchwork-daily-mosaic, Property 13: Invalid Mosaics are rejected
  it('Property 13: Invalid Mosaics are rejected', () => {
    fc.assert(
      fc.property(badMosaicArb, ({ dayKey, kind, mosaic }) => {
        let thrown: unknown = null;
        let result: unknown = null;
        try {
          result = sliceToTiles(mosaic, dayKey);
        } catch (e) {
          thrown = e;
        }
        expect(result).toBeNull();
        expect(thrown).toBeInstanceOf(InvalidMosaicError);
        expect((thrown as InvalidMosaicError).kind).toBe(kind);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('draws generated Mosaics that reach every perturbation kind', () => {
    const kinds = { unchanged: 0, perturbed: 0, fallback: 0 };
    for (const m of fc.sample(mosaicArb, { numRuns: PBT_RUNS, seed: 20261130 })) {
      for (const t of sliceOk(m).tiles) kinds[t.perturbation.kind]++;
    }
    expect(kinds.unchanged).toBeGreaterThan(0);
    expect(kinds.perturbed).toBeGreaterThan(0);
    expect(kinds.fallback).toBeGreaterThan(0);
  });

  it('has fallback patterns that are unique and not uniform', () => {
    for (const n of [5, 6, 7] as const) {
      expect(FALLBACK_PATTERNS[n].length).toBeGreaterThanOrEqual(8);
      for (const pattern of FALLBACK_PATTERNS[n]) {
        expect(pattern.length).toBe(n * n);
        const filled = pattern.reduce((s, v) => s + v, 0);
        expect(filled).toBeGreaterThan(0);
        expect(filled).toBeLessThan(n * n);
        const res = solveNonogram(deriveClues(pattern, n));
        expect(res.kind).toBe('unique');
      }
    }
  });

  it('perturbs a uniform Tile', () => {
    const d = '2026-11-30' as DayKey;
    const pixels = new Uint8Array(40 * 40).fill(2);
    const res = sliceToTiles({ side: 40, pixels, paper: 2 }, d);
    if (!res.ok) throw new Error('unresolved');
    for (const t of res.tiles) {
      expect(t.perturbation.kind).not.toBe('unchanged');
      const filled = filledCount(t);
      expect(filled).toBeGreaterThan(0);
      expect(filled).toBeLessThan(25);
    }
    expect(res.tiles.some((t) => t.perturbation.kind === 'perturbed')).toBe(true);
  });

  it('never uses a fallback when fallback is not allowed', () => {
    const d = '2026-12-06' as DayKey;
    const pixels = new Uint8Array(56 * 56);
    for (let k = 0; k < pixels.length; k++) pixels[k] = (k * 7919) % 4;
    const res = sliceToTiles({ side: 56, pixels, paper: 0 }, d, { allowFallback: false });
    if (res.ok) expect(res.tiles.every((t) => t.perturbation.kind !== 'fallback')).toBe(true);
    else expect(res.tileIndexes.length).toBeGreaterThan(0);
  });
});
