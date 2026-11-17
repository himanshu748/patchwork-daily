import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateEvent, ANALYTICS_EVENTS } from './analytics';
import { base64ToBytes, bytesToBase64 } from './base64';
import { EMOJI_MINE, EMOJI_OPEN, EMOJI_STITCHED, buildEmojiGrid, composeShareComment } from './emoji';
import { HEAT_BANDS, heatBand } from './heat';
import { flairStyle, flairTierFor } from './flair';
import { decodeGrid, encodeGrid, filledMask } from './grid';
import { maskFromTiles } from './wire';
import { PBT_RUNS } from './test/arbitraries';

describe('heat', () => {
  // Feature: patchwork-daily-mosaic, Property 53: Heat bands
  it('Property 53: Heat bands', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (n) => {
        const expected = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 7 ? 3 : 4;
        expect(heatBand(n)).toBe(expected);
        const def = HEAT_BANDS[expected];
        expect(def?.min).toBeLessThanOrEqual(n);
        if (def?.max !== null) expect(n).toBeLessThanOrEqual(def?.max as number);
      }),
      { examples: [[0], [1], [2], [3], [4], [7], [8]], numRuns: PBT_RUNS },
    );
    expect(new Set(HEAT_BANDS.map((b) => b.shade)).size).toBe(5);
    expect(new Set(HEAT_BANDS.map((b) => b.pattern)).size).toBe(5);
  });

  it('has the legend texts', () => {
    expect(HEAT_BANDS.map((b) => b.label)).toEqual(['0', '1', '2 to 3', '4 to 7', '8 or more']);
  });
});

describe('flair', () => {
  // Feature: patchwork-daily-mosaic, Property 42: Flair tier mapping
  it('Property 42: Flair tier mapping', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (s) => {
        const expected = s < 3 ? null : s <= 6 ? 'Thread' : s <= 29 ? 'Quilter' : 'Weaver';
        expect(flairTierFor(s)).toBe(expected);
      }),
      { examples: [[2], [3], [6], [7], [29], [30]], numRuns: PBT_RUNS },
    );
  });

  it('styles each tier from the Palette with readable text', () => {
    for (const tier of ['Thread', 'Quilter', 'Weaver'] as const) {
      const style = flairStyle(tier);
      expect(style.text).toBe(tier);
      expect(style.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(['dark', 'light']).toContain(style.textColor);
    }
    expect(flairStyle('Quilter').backgroundColor).toBe('#ce7955');
    expect(flairStyle('Thread').textColor).toBe('light');
  });
});

describe('emoji grid', () => {
  it('has 8 rows of 8 Tile symbols and one result line', () => {
    const mask = maskFromTiles((t) => t % 3 === 0);
    const grid = buildEmojiGrid({
      dayNumber: 4,
      tileSize: 6,
      solveSeconds: 41,
      parSeconds: 60,
      mistakes: 1,
      mistakeAllowance: 2,
      helpCount: 2,
      streak: 3,
      stitchedMask: mask,
      myTiles: [0, 5],
    });
    const lines = grid.split('\n');
    expect(lines.length).toBe(9);
    for (const row of lines.slice(0, 8)) {
      const symbols = [...row];
      expect(symbols.length).toBe(8);
      for (const s of symbols) expect([EMOJI_MINE, EMOJI_STITCHED, EMOJI_OPEN]).toContain(s);
    }
    expect([...(lines[0] as string)][0]).toBe(EMOJI_MINE);
    expect([...(lines[0] as string)][3]).toBe(EMOJI_STITCHED);
    expect([...(lines[0] as string)][1]).toBe(EMOJI_OPEN);
    expect(lines[8]).toBe('Patchwork Day 4 · 6×6 · 41s / 60s par · 1/2 mistakes · 2 stitches · 3-day streak');
    expect(composeShareComment('someone', grid)).toContain('u/someone');
  });
});

describe('analytics allowlist', () => {
  it('accepts the 7 events and rejects everything else', () => {
    for (const name of ANALYTICS_EVENTS) expect(validateEvent(name, { dayNumber: 1 })).not.toBeNull();
    expect(validateEvent('page_view', {})).toBeNull();
    expect(validateEvent('post_view', { username: 'x' })).toBeNull();
    expect(validateEvent('post_view', { dayKey: 'x'.repeat(65) })).toBeNull();
    expect(validateEvent('post_view', { dayNumber: '1' })).toBeNull();
    expect(validateEvent('post_view', { dayNumber: Number.NaN })).toBeNull();
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 1]));
    expect(validateEvent('post_view', eleven)).toBeNull();
  });
});

describe('grid and base64', () => {
  it('round-trips fill grids and rejects bad ones', () => {
    expect(encodeGrid([0, 1, 2, 1])).toBe('0121');
    expect(decodeGrid('0120101201012010120101201', 5)).not.toBeNull();
    expect(decodeGrid('012', 5)).toBeNull();
    expect(decodeGrid('0123010120101201012010120', 5)).toBeNull();
    expect(Array.from(filledMask([0, 1, 2, 1]))).toEqual([0, 1, 0, 1]);
  });

  it('round-trips base64', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        const text = bytesToBase64(bytes);
        expect(text).toBe(Buffer.from(bytes).toString('base64'));
        expect(base64ToBytes(text)).toEqual(bytes);
      }),
      { numRuns: PBT_RUNS },
    );
    for (const bad of ['A', 'AB=C', '@@@@', 'AB==AB==', 'AQ=']) expect(base64ToBytes(bad)).toBeNull();
  });
});
