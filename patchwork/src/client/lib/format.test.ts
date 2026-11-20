import { describe, expect, it } from 'vitest';
import { deriveClues } from '../../shared/clues';
import type { TileSize } from '../../shared/daykey';
import { CELL_MIN_PX, formatCountdown, formatDuration, launchStatus, maxRowClueWidth, playLayout } from './format';

const SIZES: readonly TileSize[] = [5, 6, 7];

describe('format', () => {
  it('formats durations and countdowns', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(61_000)).toBe('1:01');
    expect(formatDuration(3_600_000 + 5_000)).toBe('1:00:05');
    expect(formatCountdown(-1)).toBe('00:00:00');
    expect(formatCountdown(1)).toBe('00:00:01');
    expect(formatCountdown(86_400_000)).toBe('24:00:00');
    expect(launchStatus(12, 40)).toBe('Day 12 · 40/64 stitched');
  });

  it('fits every Tile_Size at 360 px with Cells of at least 44 px (Req 10.7, Req 26.7)', () => {
    for (const n of SIZES) {
      const layout = playLayout(n, 360);
      expect(layout.cell).toBeGreaterThanOrEqual(CELL_MIN_PX);
      expect(layout.width).toBeLessThanOrEqual(360);
    }
    expect(playLayout(7, 360).cell).toBe(44);
  });

  it('reserves room for the longest possible row Clue', () => {
    for (const n of SIZES) {
      // Alternating filled and empty Cells give the most numbers a row Clue can have.
      const row = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : 0));
      const grid = Uint8Array.from(Array.from({ length: n }, () => row).flat());
      const longest = deriveClues(grid, n).rows[0]!;
      expect(longest.length).toBe(Math.ceil(n / 2));
      expect(maxRowClueWidth(n)).toBeGreaterThanOrEqual(longest.length * 7 + (longest.length - 1) * 4);
    }
  });
});
