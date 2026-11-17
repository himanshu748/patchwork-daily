import { describe, expect, it } from 'vitest';
import type { CvdKind, PaletteEntry } from './palette';
import { PALETTE, THEME, checkPalette, checkTextContrast, contrastRatio, paletteValues, simulateCvd } from './palette';

const MODES = ['light', 'dark'] as const;
const KINDS: CvdKind[] = ['protan', 'deutan', 'tritan'];

describe('palette', () => {
  // Feature: patchwork-daily-mosaic, Property 66: Palette accessibility
  it('Property 66: Palette accessibility', () => {
    for (const mode of MODES) {
      expect(checkPalette(mode)).toEqual({ ok: true, failures: [] });
      expect(checkTextContrast(mode)).toEqual({ ok: true, failures: [] });
      const values = paletteValues(mode);
      for (let i = 0; i < 4; i++) {
        expect(contrastRatio(values[i] as `#${string}`, THEME[mode].emptyCell)).toBeGreaterThanOrEqual(3);
        for (let j = i + 1; j < 4; j++) {
          const a = values[i] as `#${string}`;
          const b = values[j] as `#${string}`;
          expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(1.5);
          for (const k of KINDS) expect(contrastRatio(simulateCvd(a, k), simulateCvd(b, k))).toBeGreaterThanOrEqual(1.5);
        }
      }
      for (const fg of [THEME[mode].ink, THEME[mode].inkMuted]) {
        for (const bg of [THEME[mode].paper, THEME[mode].emptyCell]) expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(new Set(PALETTE.map((p) => p.pattern)).size).toBe(4);
    expect(PALETTE.map((p) => p.id)).toEqual([0, 1, 2, 3]);
  });

  it('fails a deliberately bad palette', () => {
    const grey: PaletteEntry[] = PALETTE.map((p) => ({ ...p, light: '#777777', dark: '#777777' }));
    const res = checkPalette('light', grey);
    expect(res.ok).toBe(false);
    expect(res.failures.length).toBeGreaterThan(0);
    // Red and green that separate unsimulated but merge for deuteranopia.
    const redGreen: PaletteEntry[] = [
      { ...(PALETTE[0] as PaletteEntry), light: '#000000' },
      { ...(PALETTE[1] as PaletteEntry), light: '#d03030' },
      { ...(PALETTE[2] as PaletteEntry), light: '#3a8a3a' },
      { ...(PALETTE[3] as PaletteEntry), light: '#3030d0' },
    ];
    expect(checkPalette('light', redGreen).failures.some((f) => f.includes('deutan') || f.includes('protan'))).toBe(true);
    const lowText = checkTextContrast('light', PALETTE, { ...THEME.light, inkMuted: '#bbbbbb' });
    expect(lowText.ok).toBe(false);
  });

  it('computes WCAG contrast for known pairs', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(simulateCvd('#000000', 'deutan')).toBe('#000000');
    expect(simulateCvd('#ffffff', 'protan')).toBe('#ffffff');
  });
});
