import type { Clue, Clues } from './clues';

export interface GhostPlan {
  readonly row: number;
  /** Column indexes of the forced Cells, ascending; empty when no row forces a Cell. */
  readonly cells: readonly number[];
}

/**
 * Cells filled in both the leftmost and the rightmost placement of the Clue. A run of length L whose
 * leftmost start is `left` and rightmost start is `right` forces [right, left + L) whenever right < left + L.
 */
export function forcedCells(clue: Clue, n: number): number[] {
  const out: number[] = [];
  const runs = clue.length;
  let left = 0;
  let suffix = 0;
  for (let i = 0; i < runs; i++) suffix += clue[i] as number;
  for (let i = 0; i < runs; i++) {
    const len = clue[i] as number;
    suffix -= len;
    const right = n - suffix - (runs - 1 - i) - len;
    for (let c = right; c < left + len; c++) out.push(c);
    left += len + 1;
  }
  return out;
}

/**
 * The row whose Clue alone forces the most Cells (ties go to the lowest row), and those Cells.
 * Row 0 with no Cells when nothing is forced; the Ghost_Hand never reads the Solution (Req 10.10).
 */
export function planGhostRow(clues: Clues): GhostPlan {
  let bestRow = 0;
  let best: number[] = [];
  for (let r = 0; r < clues.size; r++) {
    const cells = forcedCells(clues.rows[r] ?? [], clues.size);
    if (cells.length > best.length) {
      best = cells;
      bestRow = r;
    }
  }
  return { row: bestRow, cells: best };
}
