import type { TileSize } from './daykey';
import type { CellState } from './grid';

/** Run lengths of filled Cells; [] for an empty line. */
export type Clue = readonly number[];
export interface Clues {
  readonly size: TileSize;
  readonly rows: readonly Clue[];
  readonly cols: readonly Clue[];
}
export interface RawClues {
  readonly size: number;
  readonly rows: readonly (readonly number[])[];
  readonly cols: readonly (readonly number[])[];
}

/** 1 means filled; every other value is unfilled. */
export function lineClue(cells: ArrayLike<number>): Clue {
  const runs: number[] = [];
  let run = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === 1) run++;
    else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

function rowOf(grid: ArrayLike<number>, size: number, r: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < size; c++) out.push(grid[r * size + c] ?? 0);
  return out;
}

function colOf(grid: ArrayLike<number>, size: number, c: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < size; r++) out.push(grid[r * size + c] ?? 0);
  return out;
}

export function deriveClues(solution: ArrayLike<number>, size: TileSize): Clues {
  const rows: Clue[] = [];
  const cols: Clue[] = [];
  for (let i = 0; i < size; i++) {
    rows.push(lineClue(rowOf(solution, size, i)));
    cols.push(lineClue(colOf(solution, size, i)));
  }
  return { size, rows, cols };
}

export function clueEqual(a: Clue, b: Clue): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Marked-X counts as unfilled. */
export function lineMatches(states: ArrayLike<CellState>, clue: Clue): boolean {
  return clueEqual(lineClue(states), clue);
}

export function gridMatchesClues(states: ArrayLike<CellState>, clues: Clues): boolean {
  const n = clues.size;
  if (states.length !== n * n) return false;
  for (let i = 0; i < n; i++) {
    if (!clueEqual(lineClue(rowOf(states, n, i)), clues.rows[i] ?? [])) return false;
    if (!clueEqual(lineClue(colOf(states, n, i)), clues.cols[i] ?? [])) return false;
  }
  return true;
}

export function cluesEqual(a: Clues, b: Clues): boolean {
  if (a.size !== b.size || a.rows.length !== b.rows.length || a.cols.length !== b.cols.length) return false;
  for (let i = 0; i < a.rows.length; i++) if (!clueEqual(a.rows[i] ?? [], b.rows[i] ?? [])) return false;
  for (let i = 0; i < a.cols.length; i++) if (!clueEqual(a.cols[i] ?? [], b.cols[i] ?? [])) return false;
  return true;
}
