import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MosaicSnapshot } from './wire';
import {
  POST_DATA_MAX_BYTES,
  decodePostWire,
  encodePostWire,
  isNewerSnapshot,
  maskCount,
  packStitchedPixels,
  postWireBytes,
  unpackStitchedPixels,
  utf8Length,
} from './wire';
import { PBT_RUNS, snapshotArb } from './test/arbitraries';

describe('wire', () => {
  // Feature: patchwork-daily-mosaic, Property 46: `postData` stays small and round-trips
  it('Property 46: `postData` stays small and round-trips', () => {
    fc.assert(
      fc.property(snapshotArb, ({ snapshot, tiles }) => {
        const wire = encodePostWire(snapshot);
        expect(postWireBytes(wire)).toBeLessThanOrEqual(POST_DATA_MAX_BYTES);
        const decoded = decodePostWire(JSON.parse(JSON.stringify(wire)));
        expect(decoded).toEqual(wire);
        expect(wire.d).toBe(snapshot.dayKey);
        expect(wire.n).toBe(snapshot.dayNumber);
        expect(wire.g).toBe(snapshot.gen);
        expect(wire.m).toBe(snapshot.motifName);
        expect(wire.z).toBe(snapshot.tileSize);
        expect(wire.s).toBe(maskCount(wire.k));
        expect(wire.c).toBe(wire.s === 64 ? 1 : 0);
        const unpacked = unpackStitchedPixels(wire.k, wire.p, wire.z);
        expect(unpacked).not.toBeNull();
        expect(unpacked).toEqual(tiles.map((t) => t ?? null));
      }),
      { numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 54: Live updates never go backwards
  it('Property 54: Live updates never go backwards', () => {
    const pairArb = fc.record({ gen: fc.integer({ min: 0, max: 5 }), version: fc.integer({ min: 0, max: 64 }) });
    fc.assert(
      fc.property(fc.array(pairArb, { minLength: 1, maxLength: 40 }), (deliveries) => {
        let held: { gen: number; version: number } | null = null;
        for (const incoming of deliveries) if (isNewerSnapshot(held, incoming)) held = incoming;
        const best = deliveries.reduce((a, b) => (b.gen > a.gen || (b.gen === a.gen && b.version > a.version) ? b : a));
        expect(held).toEqual(best);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('keeps the largest case under 2,000 bytes', () => {
    const tiles = Array.from({ length: 64 }, (_, t) => Uint8Array.from({ length: 49 }, (_, c) => (t + c) % 4));
    const { mask, pixels } = packStitchedPixels(tiles, 7);
    const snapshot: MosaicSnapshot = {
      dayKey: '2027-03-28',
      dayNumber: 99_999,
      gen: 999,
      tileSize: 7,
      motifName: 'Abcdefghij Abcdefghij Abcdefghij Abcdefg',
      stitchedTotal: 64,
      stitchedMask: mask,
      solveCounts: Array<number>(64).fill(1),
      pixels,
      complete: true,
      completeAtMs: null,
      version: 64,
    };
    expect(snapshot.motifName.length).toBe(40);
    const wire = encodePostWire(snapshot);
    const bytes = postWireBytes(wire);
    console.log(`wire: largest postData case is ${bytes} bytes`);
    expect(wire.c).toBe(1);
    expect(bytes).toBeLessThanOrEqual(POST_DATA_MAX_BYTES);
  });

  it('rejects malformed postData', () => {
    const { mask, pixels } = packStitchedPixels(Array<Uint8Array | null>(64).fill(null), 5);
    const good = { v: 1, d: '2026-11-30', n: 1, m: 'Amber Pinwheel', z: 5, g: 0, s: 0, k: mask, p: pixels, c: 0 };
    expect(decodePostWire(good)).toEqual(good);
    for (const bad of [
      null,
      'x',
      { ...good, v: 2 },
      { ...good, d: '2026-02-30' },
      { ...good, z: 6 },
      { ...good, s: 1 },
      { ...good, c: 1 },
      { ...good, k: 'zz' },
      { ...good, m: 'Bad·Name' },
      { ...good, n: 0 },
      { ...good, g: 1000 },
      { ...good, p: 'AAAA' },
    ]) {
      expect(decodePostWire(bad)).toBeNull();
    }
  });

  it('counts UTF-8 bytes like TextEncoder', () => {
    for (const s of ['abc', '·', '🟩', 'Day 1 · Amber', '']) expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
  });
});
