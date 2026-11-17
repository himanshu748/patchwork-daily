import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DayKey } from './daykey';
import { addDays, dayNumber, dayOrdinal, tileSizeFor, utcWeekday } from './daykey';
import { CANDIDATE_SETTINGS, buildCandidate, buildDay, generateMosaic, postTitle, previousDaySum } from './mosaic';
import { ADJECTIVES, FAMILIES, MOTIFS, isValidMotifName, symmetryAxes } from './motifs';
import { PBT_RUNS, dayKeyArb, genOptsArb } from './test/arbitraries';
import { sliceDigest } from './test/digest';

const MOSAIC_TIMEOUT = 120_000;

describe('mosaic', () => {
  // Feature: patchwork-daily-mosaic, Property 3: Generation is deterministic
  it(
    'Property 3: Generation is deterministic',
    () => {
      fc.assert(
        fc.property(dayKeyArb, genOptsArb, (d, opts) => {
          const a = buildDay(d, opts);
          const b = buildDay(d, opts);
          const m = generateMosaic(d, opts);
          expect(b.mosaic.pixels).toEqual(a.mosaic.pixels);
          expect(m.pixels).toEqual(a.mosaic.pixels);
          expect(b.mosaic.motifName).toBe(a.mosaic.motifName);
          expect(m.motifName).toBe(a.mosaic.motifName);
          expect(b.mosaic.source).toEqual(a.mosaic.source);
          expect(sliceDigest(b.slice.tiles)).toBe(sliceDigest(a.slice.tiles));
          expect(b.meanDifficulty).toBe(a.meanDifficulty);
        }),
        { numRuns: PBT_RUNS },
      );
    },
    MOSAIC_TIMEOUT,
  );

  // Feature: patchwork-daily-mosaic, Property 4: Every pixel is a Palette colour
  it(
    'Property 4: Every pixel is a Palette colour',
    () => {
      fc.assert(
        fc.property(dayKeyArb, genOptsArb, (d, opts) => {
          const { mosaic, slice } = buildDay(d, opts);
          expect(mosaic.side).toBe(8 * tileSizeFor(d));
          expect(mosaic.pixels.length).toBe(mosaic.side * mosaic.side);
          expect(mosaic.pixels.every((p) => p <= 3)).toBe(true);
          for (const t of slice.tiles) expect(t.pixels.every((p) => p <= 3)).toBe(true);
        }),
        { numRuns: PBT_RUNS },
      );
    },
    MOSAIC_TIMEOUT,
  );

  // Feature: patchwork-daily-mosaic, Property 5: Procedural Motifs are symmetric
  it(
    'Property 5: Procedural Motifs are symmetric',
    () => {
      for (const f of FAMILIES) expect(MOTIFS.some((m) => m.family === f)).toBe(true);
      fc.assert(
        fc.property(dayKeyArb, genOptsArb, (d, opts) => {
          const m = generateMosaic(d, opts);
          const motif = MOTIFS.find((x) => x.id === m.source.motifId);
          expect(motif).toBeDefined();
          if (!motif) return;
          expect(FAMILIES).toContain(m.family);
          expect(m.family).toBe(motif.family);
          expect(motif.axes.length).toBeGreaterThanOrEqual(1);
          const axes = symmetryAxes(m.pixels, m.side);
          for (const axis of motif.axes) expect(axes).toContain(axis);
        }),
        { numRuns: PBT_RUNS },
      );
    },
    MOSAIC_TIMEOUT,
  );

  // Feature: patchwork-daily-mosaic, Property 6: Consecutive days differ
  it(
    'Property 6: Consecutive days differ',
    () => {
      fc.assert(
        fc.property(dayKeyArb, (d) => {
          const next = addDays(d, 1);
          const a = generateMosaic(d);
          const b = generateMosaic(next);
          expect(a.pixels[0]).toBe(((dayOrdinal(d) % 4) + 4) % 4);
          expect(b.pixels[0]).toBe(((dayOrdinal(next) % 4) + 4) % 4);
          expect(a.side !== b.side || a.pixels[0] !== b.pixels[0]).toBe(true);
        }),
        { numRuns: PBT_RUNS },
      );
    },
    MOSAIC_TIMEOUT,
  );

  // Feature: patchwork-daily-mosaic, Property 7: Motif names and post titles
  it(
    'Property 7: Motif names and post titles',
    () => {
      fc.assert(
        fc.property(dayKeyArb, genOptsArb, fc.integer({ min: 0, max: 3000 }), (d, opts, back) => {
          const m = generateMosaic(d, opts);
          expect(isValidMotifName(m.motifName)).toBe(true);
          const start = addDays(d, -back);
          const n = dayNumber(d, start);
          expect(n).toBe(back + 1);
          expect(postTitle(n, m.motifName)).toBe(`Day ${String(back + 1)} · ${m.motifName}`);
          expect(postTitle(n, m.motifName)).toMatch(/^Day [1-9]\d* · [A-Za-z0-9 -]{1,40}$/);
        }),
        { numRuns: PBT_RUNS },
      );
    },
    MOSAIC_TIMEOUT,
  );

  it('accepts every adjective and noun pair as a Motif name', () => {
    for (const adjective of ADJECTIVES) for (const motif of MOTIFS) expect(isValidMotifName(`${adjective} ${motif.noun}`)).toBe(true);
    for (const bad of ['', '   ', 'a'.repeat(41), 'Star·Glyph', 'Café', 'x\ny']) expect(isValidMotifName(bad)).toBe(false);
  });

  it('has one Motif family per Day_Key ordinal mod 3 at motif index 0', () => {
    for (let k = 0; k < 9; k++) {
      const d = addDays('2026-11-30' as DayKey, k);
      expect(generateMosaic(d).family).toBe(FAMILIES[dayOrdinal(d) % 3]);
    }
  });

  it('picks candidates by the calibrated weekly rule', () => {
    const week = Array.from({ length: 7 }, (_, k) => addDays('2027-01-04' as DayKey, k));
    for (const d of week) {
      const built = buildDay(d);
      const sums = CANDIDATE_SETTINGS.map((s, v) => buildCandidate(d, 0, 0, v, s).difficultySum);
      const prev = previousDaySum(d);
      if (utcWeekday(d) === 1) {
        expect(prev).toBeNull();
        expect(built.difficultySum).toBe(Math.min(...sums));
      } else {
        expect(prev).not.toBeNull();
        const strict = utcWeekday(d) === 4;
        const meeting = sums.filter((s) => (strict ? s > (prev as number) : s >= (prev as number)));
        expect(built.difficultySum).toBe(meeting.length > 0 ? Math.min(...meeting) : Math.max(...sums));
        expect(prev).toBe(buildDay(addDays(d, -1)).difficultySum);
      }
      expect(CANDIDATE_SETTINGS[built.mosaic.source.variant]).toBeDefined();
    }
  });

  it('keeps one Motif across the candidates of a day and changes it on skip', () => {
    const d = '2026-12-02' as DayKey;
    const ids = CANDIDATE_SETTINGS.map((s, v) => buildCandidate(d, 0, 0, v, s).mosaic.source.motifId);
    expect(new Set(ids).size).toBe(1);
    expect(generateMosaic(d, { motifIndex: 1 }).source.motifId).not.toBe(ids[0]);
  });
});
