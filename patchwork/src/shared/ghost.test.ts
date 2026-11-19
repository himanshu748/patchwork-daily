import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Clue } from './clues';
import { deriveClues } from './clues';
import { forcedCells, planGhostRow } from './ghost';
import { PBT_RUNS, sizedGridArb } from './test/arbitraries';

/** Every placement of the Clue in a line of length n, by direct run placement. */
function placements(clue: Clue, n: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  const row = new Uint8Array(n);
  const go = (k: number, pos: number): void => {
    if (k === clue.length) {
      out.push(row.slice());
      return;
    }
    const run = clue[k] as number;
    const rest = clue.slice(k + 1).reduce((s, r) => s + r + 1, 0);
    for (let start = pos; start + run + rest <= n; start++) {
      row.fill(0, pos, start);
      row.fill(1, start, start + run);
      go(k + 1, start + run + 1);
      row.fill(0, start, start + run);
    }
  };
  go(0, 0);
  return out;
}

describe('ghost', () => {
  // Feature: patchwork-daily-mosaic, Property 51: The Ghost_Hand shows only forced Cells
  it('Property 51: The Ghost_Hand shows only forced Cells', () => {
    fc.assert(
      fc.property(sizedGridArb, ({ n, grid }) => {
        const clues = deriveClues(grid, n);
        const plan = planGhostRow(clues);
        expect(plan.row).toBeGreaterThanOrEqual(0);
        expect(plan.row).toBeLessThan(n);
        const clue = clues.rows[plan.row] as Clue;
        const all = placements(clue, n);
        expect(all.length).toBeGreaterThan(0);
        for (const c of plan.cells) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThan(n);
          for (const p of all) expect(p[c], `cell ${c} of row ${plan.row} filled in every placement`).toBe(1);
        }
        // The plan holds every forced Cell of that row, and no other row forces more.
        expect(plan.cells).toEqual(forcedCells(clue, n));
        for (let r = 0; r < n; r++) expect(forcedCells(clues.rows[r] as Clue, n).length).toBeLessThanOrEqual(plan.cells.length);
        const sorted = [...plan.cells];
        expect(sorted.sort((a, b) => a - b)).toEqual(plan.cells);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('gives row 0 with no Cells when no Clue forces a Cell', () => {
    const clues = deriveClues(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 5);
    expect(planGhostRow(clues)).toEqual({ row: 0, cells: [] });
    expect(forcedCells([1], 5)).toEqual([]);
    expect(forcedCells([1, 1], 5)).toEqual([]);
    expect(forcedCells([3], 5)).toEqual([2]);
    expect(forcedCells([5], 5)).toEqual([0, 1, 2, 3, 4]);
    expect(forcedCells([2, 2], 5)).toEqual([0, 1, 3, 4]);
    expect(forcedCells([2], 5)).toEqual([]);
    expect(forcedCells([], 5)).toEqual([]);
  });
});
