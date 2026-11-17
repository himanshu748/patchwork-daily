import type { TileSize } from './daykey';
import type { SolveTrace } from './solver';

/** Coefficients of the Difficulty_Score; frozen after the step 2 calibration (D30). */
export const DIFFICULTY_COEFFICIENTS = {
  sizeStep: 10,
  unresolvedMax: 40,
  perExtraRound: 6,
  perBranchNode: 5,
  branchCap: 20,
} as const;

function clamp(lo: number, hi: number, v: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Integer from 1 to 100, built only from the solve trace and the Tile_Size. */
export function difficultyScore(size: TileSize, trace: SolveTrace): number {
  const k = DIFFICULTY_COEFFICIENTS;
  const cells = size * size;
  const unresolved = Math.max(0, cells - trace.firstRoundResolved);
  const raw =
    k.sizeStep * (size - 4) +
    Math.floor((k.unresolvedMax * unresolved + Math.floor(cells / 2)) / cells) +
    k.perExtraRound * Math.max(0, trace.rounds - 1) +
    Math.min(k.branchCap, k.perBranchNode * trace.branchNodes);
  return clamp(1, 100, raw);
}
