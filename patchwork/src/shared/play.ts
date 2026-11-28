import type { TileSize } from './daykey';
import type { Clues } from './clues';
import { gridMatchesClues } from './clues';
import type { CellState } from './grid';

export type { CellState } from './grid';

/** Empty becomes filled (marked-X in mark mode); filled and marked-X become empty (Req 10.2, Req 10.3, Req 10.12). */
export function tapResult(current: CellState, markMode: boolean): CellState {
  if (current === 0) return markMode ? 2 : 1;
  return 0;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Moves focus one Cell; it stays put at the Tile edge (Req 26.3). */
export function moveFocus(cell: number, direction: Direction, size: TileSize): number {
  const r = Math.floor(cell / size);
  const c = cell % size;
  const nr = direction === 'up' ? Math.max(0, r - 1) : direction === 'down' ? Math.min(size - 1, r + 1) : r;
  const nc = direction === 'left' ? Math.max(0, c - 1) : direction === 'right' ? Math.min(size - 1, c + 1) : c;
  return nr * size + nc;
}

export type PlayAction =
  | { readonly type: 'press'; readonly cell: number }
  | { readonly type: 'tap'; readonly cell: number }
  | { readonly type: 'longPress'; readonly cell: number }
  | { readonly type: 'dragTo'; readonly cell: number }
  | { readonly type: 'release' }
  | { readonly type: 'cancelPress' }
  | { readonly type: 'key'; readonly key: 'Space' | 'KeyX' | 'Backspace' | 'Delete'; readonly cell: number }
  | { readonly type: 'markMode'; readonly on: boolean }
  | { readonly type: 'reset'; readonly cells: Uint8Array };

export interface DragState {
  readonly start: number;
  /** Fixed by the first move into the start Cell's row or column. */
  readonly axis: 'row' | 'col' | null;
  /** The start Cell's resulting state, painted along the axis. */
  readonly paint: CellState;
  /** True once the 400 ms mark set the start Cell to marked-X. */
  readonly longPressed: boolean;
  /** Cell states from before the press, so Cells left behind can be restored. */
  readonly before: Uint8Array;
}

export interface PlayState {
  readonly size: TileSize;
  readonly cells: Uint8Array;
  readonly markMode: boolean;
  /** While submitting or animating every Cell input is ignored (Req 10.9, Req 16.4). */
  readonly locked: boolean;
  /** Set once, on the first state in which every line matches its Clue (Req 10.8). */
  readonly submit: boolean;
  readonly drag: DragState | null;
}

export function initialPlayState(size: TileSize, cells?: Uint8Array, markMode = false): PlayState {
  const initial = cells ?? new Uint8Array(size * size);
  if (initial.length !== size * size) throw new RangeError(`Play grid must have ${size * size} Cells`);
  return { size, cells: initial.slice(), markMode, locked: false, submit: false, drag: null };
}

/** Sets `submit` exactly once, on the first state in which every line matches; that state locks the grid. */
function finish(state: PlayState, clues: Clues | undefined): PlayState {
  if (!clues || state.submit || state.locked) return state;
  // The reducer only ever writes 0, 1 or 2, so the cells are CellStates.
  if (gridMatchesClues(state.cells as unknown as ArrayLike<CellState>, clues)) {
    return { ...state, submit: true, locked: true, drag: null };
  }
  return state;
}

export function playReducer(state: PlayState, action: PlayAction, clues?: Clues): PlayState {
  const n = state.size;
  const valid = (cell: number): boolean => Number.isInteger(cell) && cell >= 0 && cell < n * n;

  if (action.type === 'reset') {
    if (action.cells.length !== n * n || action.cells.some((v) => v !== 0 && v !== 1 && v !== 2)) return state;
    return finish(
      { ...state, cells: action.cells.slice(), locked: false, submit: false, drag: null },
      clues,
    );
  }
  if (action.type === 'markMode') return { ...state, markMode: action.on };
  if (state.locked) return state;

  switch (action.type) {
    case 'press': {
      if (!valid(action.cell) || state.drag !== null) return state;
      const paint = tapResult(state.cells[action.cell] as CellState, state.markMode);
      const drag: DragState = { start: action.cell, axis: null, paint, longPressed: false, before: state.cells.slice() };
      return { ...state, drag };
    }
    case 'tap': {
      // The client reports a clean tap (down and up on one Cell, no drag) without a press first.
      if (!valid(action.cell) || state.drag !== null) return state;
      const cells = state.cells.slice();
      cells[action.cell] = tapResult(cells[action.cell] as CellState, state.markMode);
      return finish({ ...state, cells }, clues);
    }
    case 'longPress': {
      const d = state.drag;
      if (d === null || d.start !== action.cell || d.axis !== null) return state;
      const cells = state.cells.slice();
      cells[d.start] = 2;
      return { ...state, cells, drag: { ...d, paint: 2, longPressed: true } };
    }
    case 'dragTo': {
      const d = state.drag;
      if (d === null || !valid(action.cell)) return state;
      const sr = Math.floor(d.start / n);
      const sc = d.start % n;
      const r = Math.floor(action.cell / n);
      const c = action.cell % n;
      const axis = d.axis ?? (r === sr && c !== sc ? 'row' : c === sc && r !== sr ? 'col' : null);
      // A diagonal first move fixes nothing; a move off the fixed axis is ignored until release (Req 10.6).
      if (axis === null) return state;
      if ((axis === 'row' && r !== sr) || (axis === 'col' && c !== sc)) {
        return d.axis === null ? { ...state, drag: { ...d, axis } } : state;
      }
      const cells = d.before.slice();
      if (d.longPressed) cells[d.start] = 2;
      if (axis === 'row') {
        const [a, b] = sc <= c ? [sc, c] : [c, sc];
        for (let cc = a; cc <= b; cc++) cells[sr * n + cc] = d.paint;
      } else {
        const [a, b] = sr <= r ? [sr, r] : [r, sr];
        for (let rr = a; rr <= b; rr++) cells[rr * n + sc] = d.paint;
      }
      return finish({ ...state, cells, drag: { ...d, axis } }, clues);
    }
    case 'cancelPress':
      // A canceled pointer never completes a pending tap. Applied drag edits keep their result.
      return state.drag === null ? state : { ...state, drag: null };
    case 'release': {
      const d = state.drag;
      if (d === null) return state;
      if (d.axis === null && !d.longPressed) {
        // A plain press and release is a tap, applied on release (Req 10.5).
        const cells = state.cells.slice();
        cells[d.start] = d.paint;
        return finish({ ...state, cells, drag: null }, clues);
      }
      // After a long-press or a drag the release applies no tap rule (Req 10.4).
      return finish({ ...state, drag: null }, clues);
    }
    case 'key': {
      if (!valid(action.cell) || state.drag !== null) return state;
      const cells = state.cells.slice();
      cells[action.cell] = action.key === 'Space' ? 1 : action.key === 'KeyX' ? 2 : 0;
      return finish({ ...state, cells }, clues);
    }
  }
}
