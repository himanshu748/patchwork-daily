import type { TileSize } from './daykey';
import type { RawClues } from './clues';
import { difficultyScore } from './difficulty';

export interface SolveTrace {
  /** Propagation rounds before any search, including the final round that changed nothing. */
  readonly rounds: number;
  /** Cells known after the first propagation round. */
  readonly firstRoundResolved: number;
  /** Line candidates tried by the search. */
  readonly branchNodes: number;
}

export type SolveResult =
  | { readonly kind: 'unique'; readonly solution: Uint8Array; readonly difficulty: number; readonly trace: SolveTrace }
  | { readonly kind: 'multiple'; readonly witnesses: readonly [Uint8Array, Uint8Array] }
  | { readonly kind: 'unsolvable' }
  | { readonly kind: 'invalid'; readonly reason: 'size' | 'clue-count' | 'run-length' };

// Bit i of a line mask is Cell i of that line (column i of a row, row i of a column).
const lineTables = new Map<number, Map<string, Int32Array>>();

function maskRuns(mask: number, n: number): string {
  const runs: number[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    if ((mask >> i) & 1) run++;
    else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs.join(',');
}

function tableFor(n: number): Map<string, Int32Array> {
  const cached = lineTables.get(n);
  if (cached) return cached;
  const groups = new Map<string, number[]>();
  for (let mask = 0; mask < 1 << n; mask++) {
    const key = maskRuns(mask, n);
    const list = groups.get(key);
    if (list) list.push(mask);
    else groups.set(key, [mask]);
  }
  const table = new Map<string, Int32Array>();
  for (const [key, list] of groups) table.set(key, Int32Array.from(list));
  lineTables.set(n, table);
  return table;
}

interface State {
  rowCands: Int32Array[];
  colCands: Int32Array[];
  rowFilled: Int32Array;
  rowEmpty: Int32Array;
  colFilled: Int32Array;
  colEmpty: Int32Array;
}

function cloneState(s: State): State {
  return {
    rowCands: s.rowCands.slice(),
    colCands: s.colCands.slice(),
    rowFilled: s.rowFilled.slice(),
    rowEmpty: s.rowEmpty.slice(),
    colFilled: s.colFilled.slice(),
    colEmpty: s.colEmpty.slice(),
  };
}

function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

function knownCells(s: State, n: number): number {
  let k = 0;
  for (let r = 0; r < n; r++) k += popcount((s.rowFilled[r] ?? 0) | (s.rowEmpty[r] ?? 0));
  return k;
}

/**
 * Filters one line's candidates against the known Cells and records newly forced Cells.
 * Returns false on a contradiction (no candidate left).
 */
function filterLine(
  cands: Int32Array[],
  filled: Int32Array,
  empty: Int32Array,
  crossFilled: Int32Array,
  crossEmpty: Int32Array,
  crossDirty: Uint8Array,
  i: number,
  full: number,
): { ok: boolean; changed: boolean } {
  const f = filled[i] ?? 0;
  const e = empty[i] ?? 0;
  const list = cands[i] as Int32Array;
  let and = full;
  let or = 0;
  let keptCount = 0;
  const kept = new Int32Array(list.length);
  for (let k = 0; k < list.length; k++) {
    const m = list[k] as number;
    if ((m & f) === f && (m & e) === 0) {
      kept[keptCount++] = m;
      and &= m;
      or |= m;
    }
  }
  if (keptCount === 0) return { ok: false, changed: false };
  if (keptCount !== list.length) cands[i] = kept.slice(0, keptCount);
  const newFilled = and & ~f;
  const newEmpty = ~or & full & ~e;
  if ((newFilled | newEmpty) === 0) return { ok: true, changed: false };
  filled[i] = f | newFilled;
  empty[i] = e | newEmpty;
  const bit = 1 << i;
  for (let j = 0; newFilled >> j; j++) {
    if ((newFilled >> j) & 1) {
      crossFilled[j] = (crossFilled[j] ?? 0) | bit;
      crossDirty[j] = 1;
    }
  }
  for (let j = 0; newEmpty >> j; j++) {
    if ((newEmpty >> j) & 1) {
      crossEmpty[j] = (crossEmpty[j] ?? 0) | bit;
      crossDirty[j] = 1;
    }
  }
  return { ok: true, changed: true };
}

/** Runs line propagation to a fixed point. Returns the number of rounds, or -1 on a contradiction. */
function propagate(
  s: State,
  n: number,
  rowDirty: Uint8Array,
  colDirty: Uint8Array,
  onFirstRound?: (known: number) => void,
): number {
  const full = (1 << n) - 1;
  let rounds = 0;
  for (;;) {
    let touched = false;
    let changed = false;
    for (let r = 0; r < n; r++) {
      if (!rowDirty[r]) continue;
      rowDirty[r] = 0;
      touched = true;
      const res = filterLine(s.rowCands, s.rowFilled, s.rowEmpty, s.colFilled, s.colEmpty, colDirty, r, full);
      if (!res.ok) return -1;
      if (res.changed) changed = true;
    }
    for (let c = 0; c < n; c++) {
      if (!colDirty[c]) continue;
      colDirty[c] = 0;
      touched = true;
      const res = filterLine(s.colCands, s.colFilled, s.colEmpty, s.rowFilled, s.rowEmpty, rowDirty, c, full);
      if (!res.ok) return -1;
      if (res.changed) changed = true;
    }
    if (!touched) return rounds;
    rounds++;
    if (rounds === 1 && onFirstRound) onFirstRound(knownCells(s, n));
    if (!changed) return rounds;
  }
}

function solutionOf(s: State, n: number): Uint8Array {
  const out = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    const f = s.rowFilled[r] ?? 0;
    for (let c = 0; c < n; c++) out[r * n + c] = (f >> c) & 1;
  }
  return out;
}

interface SearchOut {
  solutions: Uint8Array[];
  nodes: number;
}

function search(s: State, n: number, out: SearchOut): void {
  let bestLine = -1;
  let bestIsRow = true;
  let bestCount = Number.POSITIVE_INFINITY;
  for (let r = 0; r < n; r++) {
    const len = (s.rowCands[r] as Int32Array).length;
    if (len > 1 && len < bestCount) {
      bestCount = len;
      bestLine = r;
      bestIsRow = true;
    }
  }
  for (let c = 0; c < n; c++) {
    const len = (s.colCands[c] as Int32Array).length;
    if (len > 1 && len < bestCount) {
      bestCount = len;
      bestLine = c;
      bestIsRow = false;
    }
  }
  if (bestLine === -1) {
    out.solutions.push(solutionOf(s, n));
    return;
  }
  const full = (1 << n) - 1;
  const cands = (bestIsRow ? s.rowCands[bestLine] : s.colCands[bestLine]) as Int32Array;
  for (let k = 0; k < cands.length; k++) {
    const m = cands[k] as number;
    out.nodes++;
    const next = cloneState(s);
    const rowDirty = new Uint8Array(n);
    const colDirty = new Uint8Array(n);
    if (bestIsRow) {
      next.rowCands[bestLine] = Int32Array.of(m);
      next.rowFilled[bestLine] = m;
      next.rowEmpty[bestLine] = ~m & full;
      for (let c = 0; c < n; c++) {
        if ((m >> c) & 1) next.colFilled[c] = (next.colFilled[c] ?? 0) | (1 << bestLine);
        else next.colEmpty[c] = (next.colEmpty[c] ?? 0) | (1 << bestLine);
      }
      colDirty.fill(1);
    } else {
      next.colCands[bestLine] = Int32Array.of(m);
      next.colFilled[bestLine] = m;
      next.colEmpty[bestLine] = ~m & full;
      for (let r = 0; r < n; r++) {
        if ((m >> r) & 1) next.rowFilled[r] = (next.rowFilled[r] ?? 0) | (1 << bestLine);
        else next.rowEmpty[r] = (next.rowEmpty[r] ?? 0) | (1 << bestLine);
      }
      rowDirty.fill(1);
    }
    if (propagate(next, n, rowDirty, colDirty) >= 0) search(next, n, out);
    if (out.solutions.length >= 2) return;
  }
}

type Checked =
  | { readonly ok: true; readonly n: TileSize; readonly rows: readonly (readonly number[])[]; readonly cols: readonly (readonly number[])[] }
  | { readonly ok: false; readonly reason: 'size' | 'clue-count' | 'run-length' };

function checkClues(clues: RawClues): Checked {
  if (typeof clues !== 'object' || clues === null) return { ok: false, reason: 'size' };
  const n = clues.size;
  if (n !== 5 && n !== 6 && n !== 7) return { ok: false, reason: 'size' };
  const { rows, cols } = clues;
  if (!Array.isArray(rows) || !Array.isArray(cols) || rows.length !== n || cols.length !== n) {
    return { ok: false, reason: 'clue-count' };
  }
  for (const line of [...rows, ...cols] as unknown[]) {
    if (!Array.isArray(line)) return { ok: false, reason: 'clue-count' };
    for (const run of line as unknown[]) {
      if (typeof run !== 'number' || !Number.isInteger(run) || run < 1) return { ok: false, reason: 'run-length' };
    }
  }
  return { ok: true, n, rows, cols };
}

/** Proves uniqueness. Never throws; malformed input returns `invalid`. */
export function solveNonogram(clues: RawClues): SolveResult {
  let checked: Checked;
  try {
    checked = checkClues(clues);
  } catch {
    return { kind: 'invalid', reason: 'size' };
  }
  if (!checked.ok) return { kind: 'invalid', reason: checked.reason };
  const { n, rows, cols } = checked;
  const table = tableFor(n);
  const rowCands: Int32Array[] = [];
  const colCands: Int32Array[] = [];
  for (const line of rows) {
    const cands = table.get(line.join(','));
    if (!cands) return { kind: 'unsolvable' };
    rowCands.push(cands);
  }
  for (const line of cols) {
    const cands = table.get(line.join(','));
    if (!cands) return { kind: 'unsolvable' };
    colCands.push(cands);
  }
  const state: State = {
    rowCands,
    colCands,
    rowFilled: new Int32Array(n),
    rowEmpty: new Int32Array(n),
    colFilled: new Int32Array(n),
    colEmpty: new Int32Array(n),
  };
  let firstRoundResolved = 0;
  const rounds = propagate(state, n, new Uint8Array(n).fill(1), new Uint8Array(n).fill(1), (known) => {
    firstRoundResolved = known;
  });
  if (rounds < 0) return { kind: 'unsolvable' };
  const out: SearchOut = { solutions: [], nodes: 0 };
  search(state, n, out);
  const [first, second] = out.solutions;
  if (!first) return { kind: 'unsolvable' };
  if (second) return { kind: 'multiple', witnesses: [first, second] };
  const trace: SolveTrace = { rounds, firstRoundResolved, branchNodes: out.nodes };
  return { kind: 'unique', solution: first, difficulty: difficultyScore(n, trace), trace };
}
