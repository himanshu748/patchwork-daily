import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TileSize } from './daykey';
import type { Clue, RawClues } from './clues';
import { deriveClues, gridMatchesClues, lineClue } from './clues';
import { solveNonogram } from './solver';
import { PBT_RUNS, sizeArb, sizedGridArb } from './test/arbitraries';

/** All row patterns of length n that match the clue, by direct placement of the runs. */
function placements(clue: Clue, n: number): number[][] {
  const out: number[][] = [];
  const place = (k: number, pos: number, row: number[]): void => {
    if (k === clue.length) {
      out.push([...row, ...Array<number>(n - row.length).fill(0)]);
      return;
    }
    const run = clue[k] as number;
    const rest = clue.slice(k + 1).reduce((s, r) => s + r + 1, 0);
    for (let start = pos; start + run + rest <= n; start++) {
      const next = [...row, ...Array<number>(start - row.length).fill(0), ...Array<number>(run).fill(1)];
      if (k < clue.length - 1) next.push(0);
      place(k + 1, next.length, next);
    }
  };
  place(0, 0, []);
  return out;
}

/** Could a column whose first `cells.length` Cells are `cells` still end up matching `clue`? */
function prefixFits(cells: readonly number[], clue: Clue, n: number): boolean {
  const runs: number[] = [];
  let run = 0;
  for (const v of cells) {
    if (v === 1) run++;
    else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  for (let i = 0; i < runs.length; i++) if (runs[i] !== clue[i]) return false;
  const j = runs.length;
  if (run > 0) {
    const target = clue[j];
    if (target === undefined || run > target) return false;
  }
  const remaining = n - cells.length;
  let need = 0;
  if (run > 0) need += (clue[j] as number) - run;
  const after = clue.slice(run > 0 ? j + 1 : j);
  need += after.reduce((s, r) => s + r, 0) + after.length - (run > 0 ? 0 : after.length > 0 ? 1 : 0);
  return need <= remaining;
}

/** Independent row-by-row backtracking solver; stops after 2 solutions. */
function referenceSolutions(clues: RawClues): Uint8Array[] {
  const n = clues.size;
  const rowOptions = clues.rows.map((c) => placements(c, n));
  const found: Uint8Array[] = [];
  const rows: number[][] = [];
  const go = (r: number): void => {
    if (found.length >= 2) return;
    if (r === n) {
      found.push(Uint8Array.from(rows.flat()));
      return;
    }
    for (const option of rowOptions[r] ?? []) {
      rows.push(option);
      let ok = true;
      for (let c = 0; c < n && ok; c++) ok = prefixFits(rows.map((row) => row[c] as number), clues.cols[c] ?? [], n);
      if (ok) go(r + 1);
      rows.pop();
      if (found.length >= 2) return;
    }
  };
  go(0);
  return found;
}

const runListArb = (n: number) => fc.array(fc.integer({ min: 1, max: n }), { maxLength: Math.ceil(n / 2) + 1 });
const wellFormedArb: fc.Arbitrary<RawClues> = sizeArb.chain((n) =>
  fc.record({
    size: fc.constant(n),
    rows: fc.array(runListArb(n), { minLength: n, maxLength: n }),
    cols: fc.array(runListArb(n), { minLength: n, maxLength: n }),
  }),
);

const malformedArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.record({
    size: fc.integer({ min: -2, max: 12 }).filter((s) => s < 5 || s > 7),
    rows: fc.constant([] as number[][]),
    cols: fc.constant([] as number[][]),
  }),
  sizeArb.chain((n) =>
    fc.record({
      size: fc.constant(n),
      rows: fc.array(fc.constant([1]), { minLength: 0, maxLength: 10 }).filter((r) => r.length !== n),
      cols: fc.array(fc.constant([1]), { minLength: n, maxLength: n }),
    }),
  ),
  sizeArb.chain((n) =>
    fc.record({
      size: fc.constant(n),
      rows: fc.array(fc.constant([1]), { minLength: n, maxLength: n }),
      cols: fc.array(fc.constant([1]), { minLength: 0, maxLength: 10 }).filter((c) => c.length !== n),
    }),
  ),
  sizeArb.chain((n) =>
    fc
      .tuple(fc.constantFrom(0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY), fc.integer({ min: 0, max: n - 1 }), fc.boolean())
      .map(([bad, at, inRows]) => {
        const lines = (): number[][] => Array.from({ length: n }, () => [1]);
        const rows = lines();
        const cols = lines();
        (inRows ? rows : cols)[at] = [1, bad];
        return { size: n, rows, cols };
      }),
  ),
  fc.constantFrom(null, undefined, 5, 'clues', { size: 5 }, { size: 5, rows: 'x', cols: [] }, { size: '5', rows: [], cols: [] }),
);

describe('solver', () => {
  // Feature: patchwork-daily-mosaic, Property 14: Solver results are correct
  it('Property 14: Solver results are correct', () => {
    fc.assert(
      fc.property(sizedGridArb, ({ n, grid }) => {
        const clues = deriveClues(grid, n);
        const res = solveNonogram(clues);
        const reference = referenceSolutions(clues);
        if (res.kind === 'unique') {
          expect(gridMatchesClues(res.solution as unknown as ArrayLike<0 | 1>, clues)).toBe(true);
          expect(reference.length).toBe(1);
          expect(reference[0]).toEqual(res.solution);
        } else {
          expect(res.kind).toBe('multiple');
          if (res.kind !== 'multiple') return;
          const [a, b] = res.witnesses;
          expect(a).not.toEqual(b);
          expect(gridMatchesClues(a as unknown as ArrayLike<0 | 1>, clues)).toBe(true);
          expect(gridMatchesClues(b as unknown as ArrayLike<0 | 1>, clues)).toBe(true);
          expect(reference.length).toBe(2);
        }
      }),
      { numRuns: PBT_RUNS },
    );
    fc.assert(
      fc.property(sizeArb, fc.integer({ min: 0, max: 6 }), fc.boolean(), (n, at, overflow) => {
        const empty = (): number[][] => Array.from({ length: n }, () => []);
        const clues: RawClues = overflow
          ? { size: n, rows: empty().map((r, i) => (i === at % n ? [n, 1] : r)), cols: empty() }
          : { size: n, rows: empty().map((r, i) => (i === at % n ? [1] : r)), cols: empty() };
        expect(solveNonogram(clues).kind).toBe('unsolvable');
        expect(referenceSolutions(clues).length).toBe(0);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 15: Solver determinism and Difficulty_Score range
  it('Property 15: Solver determinism and Difficulty_Score range', () => {
    const fromGrids = sizedGridArb.map(({ n, grid }): RawClues => deriveClues(grid, n));
    fc.assert(
      fc.property(fc.oneof(fromGrids, wellFormedArb), (clues) => {
        const a = solveNonogram(clues);
        const b = solveNonogram(clues);
        expect(b.kind).toBe(a.kind);
        expect(a.kind).not.toBe('invalid');
        if (a.kind === 'unique' && b.kind === 'unique') {
          expect(b.solution).toEqual(a.solution);
          expect(b.difficulty).toBe(a.difficulty);
          expect(Number.isInteger(a.difficulty)).toBe(true);
          expect(a.difficulty).toBeGreaterThanOrEqual(1);
          expect(a.difficulty).toBeLessThanOrEqual(100);
        } else {
          expect('difficulty' in a).toBe(false);
          expect('solution' in a).toBe(false);
        }
        if (a.kind === 'multiple' && b.kind === 'multiple') expect(b.witnesses).toEqual(a.witnesses);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  // Feature: patchwork-daily-mosaic, Property 16: Malformed Clues are rejected without throwing
  it('Property 16: Malformed Clues are rejected without throwing', () => {
    fc.assert(
      fc.property(malformedArb, (raw) => {
        let res: ReturnType<typeof solveNonogram> | null = null;
        expect(() => {
          res = solveNonogram(raw as RawClues);
        }).not.toThrow();
        const r = res as unknown as ReturnType<typeof solveNonogram>;
        expect(r.kind).toBe('invalid');
        expect('solution' in r).toBe(false);
        expect('difficulty' in r).toBe(false);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('solves a known unique, a known multiple and a known unsolvable clue set', () => {
    const plus = Uint8Array.from('0010000100111110010000100'.split(''), Number);
    const unique = solveNonogram(deriveClues(plus, 5));
    expect(unique.kind).toBe('unique');
    if (unique.kind === 'unique') expect(unique.solution).toEqual(plus);

    const diagonal = new Uint8Array(25);
    diagonal[0] = 1;
    diagonal[6] = 1;
    const multiple = solveNonogram(deriveClues(diagonal, 5));
    expect(multiple.kind).toBe('multiple');

    const unsolvable = solveNonogram({ size: 5, rows: [[5], [], [], [], []], cols: [[], [], [], [], []] });
    expect(unsolvable.kind).toBe('unsolvable');
  });

  it('agrees with lineClue on every line of a derived Solution', () => {
    const n: TileSize = 6;
    const grid = Uint8Array.from({ length: 36 }, (_, i) => ((i * 5) % 7 < 3 ? 1 : 0));
    const clues = deriveClues(grid, n);
    for (let r = 0; r < n; r++) expect(clues.rows[r]).toEqual(lineClue(grid.slice(r * n, r * n + n)));
  });
});
