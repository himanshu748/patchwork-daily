import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Clue } from './clues';
import { deriveClues, lineMatches } from './clues';
import type { CellState } from './grid';
import type { PlayAction, PlayState } from './play';
import { initialPlayState, moveFocus, playReducer, tapResult } from './play';
import { PBT_RUNS, cellStatesArb, sizeArb, sizedGridArb } from './test/arbitraries';

const keyArb = fc.constantFrom('Space', 'KeyX', 'Backspace', 'Delete') as fc.Arbitrary<'Space' | 'KeyX' | 'Backspace' | 'Delete'>;
const directionArb = fc.constantFrom('up', 'down', 'left', 'right') as fc.Arbitrary<'up' | 'down' | 'left' | 'right'>;

/** Runs of filled Cells, marked-X counted as unfilled, written from Req 10.8. */
function referenceRuns(states: ArrayLike<number>): number[] {
  const runs: number[] = [];
  let run = 0;
  for (let i = 0; i < states.length; i++) {
    if (states[i] === 1) run++;
    else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

function equalRuns(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The state a drag should show, modelled directly from the input table of the design. */
function modelDrag(
  before: Uint8Array,
  start: number,
  moves: readonly number[],
  longPressed: boolean,
  markMode: boolean,
  n: number,
): { cells: Uint8Array; axis: 'row' | 'col' | null } {
  const cells = before.slice();
  const sr = Math.floor(start / n);
  const sc = start % n;
  let axis: 'row' | 'col' | null = null;
  let current = start;
  for (const move of moves) {
    const r = Math.floor(move / n);
    const c = move % n;
    if (axis === null) {
      if (r === sr && c !== sc) axis = 'row';
      else if (c === sc && r !== sr) axis = 'col';
      else continue;
    } else if ((axis === 'row' && r !== sr) || (axis === 'col' && c !== sc)) continue;
    current = move;
  }
  const paint: CellState = longPressed ? 2 : tapResult(before[start] as CellState, markMode);
  if (longPressed) cells[start] = 2;
  if (axis === 'row') {
    const c = current % n;
    const [a, b] = sc <= c ? [sc, c] : [c, sc];
    for (let cc = a; cc <= b; cc++) cells[sr * n + cc] = paint;
  } else if (axis === 'col') {
    const r = Math.floor(current / n);
    const [a, b] = sr <= r ? [sr, r] : [r, sr];
    for (let rr = a; rr <= b; rr++) cells[rr * n + sc] = paint;
  }
  return { cells, axis };
}

function applySeq(state: PlayState, actions: readonly PlayAction[]): PlayState {
  let s = state;
  for (const a of actions) s = playReducer(s, a);
  return s;
}

describe('play', () => {
  // Feature: patchwork-daily-mosaic, Property 48: Cell input rules
  it('Property 48: Cell input rules', () => {
    fc.assert(
      fc.property(
        sizeArb,
        cellStatesArb(7),
        fc.integer({ min: 0, max: 48 }),
        fc.boolean(),
        keyArb,
        directionArb,
        (n, raw, at, markMode, key, direction) => {
          const cells = raw.slice(0, n * n);
          // Tap rule (Req 10.2, Req 10.3, Req 10.12).
          expect(tapResult(0, markMode)).toBe(markMode ? 2 : 1);
          expect(tapResult(1, markMode)).toBe(0);
          expect(tapResult(2, markMode)).toBe(0);
          // Key rule (Req 26.4): Space fills, X marks, Backspace and Delete clear.
          const s0 = initialPlayState(n, cells, markMode);
          const s1 = playReducer(s0, { type: 'key', key, cell: at % (n * n) });
          const expected = key === 'Space' ? 1 : key === 'KeyX' ? 2 : 0;
          expect(s1.cells[at % (n * n)]).toBe(expected);
          for (let c = 0; c < n * n; c++) {
            if (c !== at % (n * n)) expect(s1.cells[c]).toBe(cells[c]);
          }
          // Arrow focus (Req 26.3): one step, staying inside the Tile.
          const moved = moveFocus(at % (n * n), direction, n);
          const r0 = Math.floor((at % (n * n)) / n);
          const c0 = at % n;
          const r1 = Math.floor(moved / n);
          const c1 = moved % n;
          expect(r1).toBeGreaterThanOrEqual(0);
          expect(r1).toBeLessThan(n);
          expect(c1).toBeGreaterThanOrEqual(0);
          expect(c1).toBeLessThan(n);
          expect(Math.abs(r1 - r0) + Math.abs(c1 - c0)).toBeLessThanOrEqual(1);
          if (direction === 'up') expect(r1).toBe(Math.max(0, r0 - 1));
          if (direction === 'down') expect(r1).toBe(Math.min(n - 1, r0 + 1));
          if (direction === 'left') expect(c1).toBe(Math.max(0, c0 - 1));
          if (direction === 'right') expect(c1).toBe(Math.min(n - 1, c0 + 1));
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 49: Long-press and drag
  it('Property 49: Long-press and drag', () => {
    fc.assert(
      fc.property(
        sizeArb,
        cellStatesArb(7),
        fc.integer({ min: 0, max: 48 }),
        fc.boolean(),
        fc.boolean(),
        fc.array(fc.integer({ min: 0, max: 48 }), { maxLength: 10 }),
        (n, raw, at, markMode, longPress, rawMoves) => {
          const cells = raw.slice(0, n * n);
          const start = at % (n * n);
          const moves = rawMoves.map((m) => m % (n * n));
          const actions: PlayAction[] = [{ type: 'press', cell: start }];
          if (longPress) actions.push({ type: 'longPress', cell: start });
          for (const m of moves) actions.push({ type: 'dragTo', cell: m });
          const held = applySeq(initialPlayState(n, cells, markMode), actions);
          const model = modelDrag(cells, start, moves, longPress, markMode, n);
          expect(held.cells).toEqual(model.cells);
          expect(held.drag?.axis ?? null).toBe(model.axis);
          // Every Cell outside the painted segment keeps its state from before the drag.
          for (let c = 0; c < n * n; c++) {
            if (model.cells[c] === (cells[c] as number)) continue;
            const r = Math.floor(c / n);
            const col = c % n;
            const onAxis = model.axis === 'row' ? r === Math.floor(start / n) : col === start % n;
            expect(onAxis || c === start).toBe(true);
          }
          const released = playReducer(held, { type: 'release' });
          expect(released.drag).toBeNull();
          if (longPress) {
            // Req 10.4: the start Cell is marked-X and the release applies no tap rule.
            expect(released.cells).toEqual(held.cells);
            expect(released.cells[start]).toBe(2);
          } else if (model.axis === null) {
            // A plain press and release is a tap, applied on release (Req 10.5).
            const tap = cells.slice();
            tap[start] = tapResult(tap[start] as CellState, markMode);
            expect(released.cells).toEqual(tap);
          } else {
            expect(released.cells).toEqual(held.cells);
          }
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 50: Satisfied lines and a single submit
  it('Property 50: Satisfied lines and a single submit', () => {
    fc.assert(
      fc.property(
        cellStatesArb(7).map((c) => c.slice(0, 7)),
        fc.array(fc.integer({ min: 1, max: 7 }), { maxLength: 4 }),
        (states, clue) => {
          const runs = referenceRuns(states);
          expect(lineMatches(states as unknown as CellState[], clue)).toBe(equalRuns(runs, clue));
        },
      ),
      { numRuns: PBT_RUNS },
    );

    // Every real Tile has at least one filled Cell (Req 4.9); an empty Tile would match before any input.
    const tileArb = sizedGridArb.filter(({ grid }) => grid.some((v) => v === 1));
    fc.assert(
      fc.property(tileArb, fc.array(fc.boolean(), { minLength: 1, maxLength: 49 }), fc.integer({ min: 0, max: 8 }), ({ n, grid }, fill, extra) => {
        const clues = deriveClues(grid, n);
        const cells = new Uint8Array(n * n);
        const toFill: number[] = [];
        for (let c = 0; c < n * n; c++) if (grid[c] === 1 && fill[c % fill.length]) toFill.push(c);
        // Wrong guesses first, then the solution's filled Cells in order, then extra inputs.
        const actions: PlayAction[] = [];
        for (let c = 0; c < Math.min(extra, n * n); c++) if (grid[c] === 0) actions.push({ type: 'key', key: 'Space', cell: c });
        for (const c of toFill) actions.push({ type: 'key', key: 'Space', cell: c });
        for (let c = 0; c < Math.min(extra, n * n); c++) if (grid[c] === 0) actions.push({ type: 'key', key: 'Backspace', cell: c });
        for (let c = 0; c < n * n; c++) if (grid[c] === 1) actions.push({ type: 'key', key: 'Space', cell: c });
        actions.push({ type: 'key', key: 'Space', cell: 0 }, { type: 'tap', cell: 1 }, { type: 'key', key: 'KeyX', cell: 2 });

        let s = initialPlayState(n, cells);
        let sawSubmit = false;
        let firstMatchSeen = false;
        let lockedCells: Uint8Array | null = null;
        for (const a of actions) {
          const before = s;
          s = playReducer(s, a, clues);
          const matches = equalRunsAll(s.cells, grid);
          if (firstMatchSeen) {
            // After the first match the grid is locked: Cell input changes nothing (Req 10.9, Req 16.4).
            expect(s.cells).toEqual(lockedCells as Uint8Array);
            expect(s.submit).toBe(true);
          } else if (matches) {
            firstMatchSeen = true;
            sawSubmit = true;
            lockedCells = s.cells.slice();
            expect(s.submit).toBe(true);
            expect(s.locked).toBe(true);
            expect(before.submit).toBe(false);
          } else {
            expect(s.submit).toBe(false);
          }
        }
        // The final state is solved, so a submit was requested exactly once.
        expect(sawSubmit).toBe(true);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('restores the Cells a drag leaves behind when it turns back', () => {
    let s = initialPlayState(5);
    s = applySeq(s, [{ type: 'press', cell: 0 }, { type: 'dragTo', cell: 1 }, { type: 'dragTo', cell: 2 }]);
    expect(Array.from(s.cells.slice(0, 3))).toEqual([1, 1, 1]);
    s = playReducer(s, { type: 'dragTo', cell: 1 });
    expect(Array.from(s.cells.slice(0, 3))).toEqual([1, 1, 0]);
    s = playReducer(s, { type: 'dragTo', cell: 0 });
    expect(Array.from(s.cells.slice(0, 3))).toEqual([1, 0, 0]);
    s = playReducer(s, { type: 'release' });
    expect(Array.from(s.cells.slice(0, 3))).toEqual([1, 0, 0]);
    // A long-press drag paints marked-X (Req 10.4, Req 10.6).
    let m = initialPlayState(5);
    m = applySeq(m, [{ type: 'press', cell: 10 }, { type: 'longPress', cell: 10 }, { type: 'dragTo', cell: 15 }, { type: 'release' }]);
    expect(m.cells[10]).toBe(2);
    expect(m.cells[15]).toBe(2);
    expect(m.cells[5]).toBe(0);
    expect(m.cells[0]).toBe(0);
  });

  it('cancels a pending tap without filling the final square or submitting', () => {
    const solution = new Uint8Array(25);
    solution[0] = 1;
    const clues = deriveClues(solution, 5);

    const pressed = playReducer(initialPlayState(5), { type: 'press', cell: 0 }, clues);
    const canceled = playReducer(pressed, { type: 'cancelPress' }, clues);
    expect(canceled.drag).toBeNull();
    expect(canceled.cells[0]).toBe(0);
    expect(canceled.submit).toBe(false);
    expect(canceled.locked).toBe(false);

    const nextPress = playReducer(canceled, { type: 'press', cell: 0 }, clues);
    const released = playReducer(nextPress, { type: 'release' }, clues);
    expect(released.cells[0]).toBe(1);
    expect(released.submit).toBe(true);
  });

  it('ignores Cell input while locked and unlocks on reset', () => {
    const grid = new Uint8Array(25);
    grid[0] = 1;
    const clues = deriveClues(grid, 5);
    let s = initialPlayState(5);
    s = playReducer(s, { type: 'key', key: 'Space', cell: 0 }, clues);
    expect(s.submit).toBe(true);
    expect(s.locked).toBe(true);
    const after = playReducer(s, { type: 'key', key: 'Backspace', cell: 0 }, clues);
    expect(after.cells).toEqual(s.cells);
    const reset = playReducer(after, { type: 'reset', cells: new Uint8Array(25) }, clues);
    expect(reset.locked).toBe(false);
    expect(reset.submit).toBe(false);
  });
});

/** Compares Cell states against a binary solution. */
function equalRunsAll(cells: Uint8Array, grid: Uint8Array): boolean {
  for (let i = 0; i < grid.length; i++) {
    const filled = cells[i] === 1;
    if (filled !== (grid[i] === 1)) return false;
  }
  return true;
}

export type { Clue };
