import type { Tile } from '../slicer';
import { fnv1a32 } from '../prng';

/** Stable text form of a slice, for equality checks and snapshots. */
export function tileDigestText(t: Tile): string {
  const p = t.perturbation;
  return [
    t.index,
    t.size,
    t.clues.rows.map((r) => r.join('.')).join('/'),
    t.clues.cols.map((r) => r.join('.')).join('/'),
    t.solution.join(''),
    t.pixels.join(''),
    t.difficulty,
    t.par.seconds,
    t.par.mistakeAllowance,
    p.kind,
    p.foreground,
    p.attempts,
    p.changedCells.join('.'),
    p.fallbackIndex ?? '-',
  ].join(';');
}

export function sliceDigest(tiles: readonly Tile[]): string {
  return fnv1a32(tiles.map(tileDigestText).join('\n')).toString(16).padStart(8, '0');
}

export function pixelsDigest(pixels: Uint8Array): string {
  return fnv1a32(pixels.join('')).toString(16).padStart(8, '0');
}
