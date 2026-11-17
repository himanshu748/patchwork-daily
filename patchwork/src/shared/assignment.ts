export const TILE_COUNT = 64;

/** Assignment_Counter value (1, 2, 3, ...) to its candidate Tile_Index. */
export function candidateFrom(counterValue: number): number {
  return (((counterValue - 1) % TILE_COUNT) + TILE_COUNT) % TILE_COUNT;
}

/**
 * The lowest Solve_Count wins; among equal counts the first Tile met counting up from the candidate
 * (wrapping from 63 to 0) wins. Null only when every Tile is excluded.
 */
export function pickTile(
  solveCounts: readonly number[],
  candidate: number,
  excluded: (tile: number) => boolean = () => false,
): number | null {
  let best: number | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (let i = 0; i < TILE_COUNT; i++) {
    const t = (candidate + i) % TILE_COUNT;
    if (excluded(t)) continue;
    const count = solveCounts[t] ?? 0;
    if (count < bestCount) {
      best = t;
      bestCount = count;
    }
  }
  return best;
}
