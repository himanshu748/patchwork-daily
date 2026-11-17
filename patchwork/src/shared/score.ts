import type { TileSize } from './daykey';

export interface Par {
  readonly seconds: number;
  readonly mistakeAllowance: number;
}

/** Par base seconds per Tile_Size; frozen after the step 2 calibration (D30). */
export const PAR_BASE: Readonly<Record<TileSize, number>> = { 5: 20, 6: 35, 7: 50 };
export const MIN_SOLVE_MS = 1000;

function clamp(lo: number, hi: number, v: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function parFor(difficulty: number, size: TileSize): Par {
  const d = clamp(1, 100, Math.round(difficulty));
  return {
    seconds: clamp(10, 600, PAR_BASE[size] + 2 * d),
    mistakeAllowance: clamp(0, 5, Math.floor(d / 25) + (size - 5)),
  };
}

export function solveMsFrom(assignedAtMs: number, acceptedAtMs: number): number {
  return Math.max(MIN_SOLVE_MS, acceptedAtMs - assignedAtMs);
}

/** Higher is better. Depends on time only through parSeconds / solveMs, so it compares across Tile_Sizes. */
export function computeScore(input: { readonly solveMs: number; readonly mistakes: number; readonly parSeconds: number }): number {
  const solveMs = Math.max(MIN_SOLVE_MS, Math.floor(input.solveMs));
  const mistakes = Math.max(0, Math.floor(input.mistakes));
  return Math.max(0, Math.floor((1_000_000 * input.parSeconds) / solveMs) - 100 * mistakes);
}
