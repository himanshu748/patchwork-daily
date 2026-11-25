import { redis } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayKeyFromOrdinal, dayOrdinal, dayStartMs, tileSizeFor } from '../../shared/daykey';
import type { CellState } from '../../shared/grid';
import { encodeGrid, filledMask } from '../../shared/grid';
import { computeScore, solveMsFrom } from '../../shared/score';
import { PBT_RUNS } from '../../shared/pbt';
import { seedDay, solutionGrid, storedTile } from '../test/harness';
import { commitStitch } from './stitch';
import { F, K } from './keys';
import { countsFrom, intOr } from './redisx';
import { validateSubmission } from './validate';

const test = createDevvitTest();

let caseCounter = 0;
const BASE = dayOrdinal('2032-01-01' as DayKey);
function freshDay(size?: 5 | 6 | 7): DayKey {
  for (;;) {
    const d = dayKeyFromOrdinal(BASE + caseCounter++);
    if (size === undefined || tileSizeFor(d) === size) return d;
  }
}
function nowIn(d: DayKey): number {
  return dayStartMs(d) + 60_000;
}

async function holdScored(u: string, d: DayKey, t: number, at: number): Promise<void> {
  await redis.hSet(K.userDay(d, u), { [F.scored(0)]: JSON.stringify({ t, at }) });
}

/** All recorded state that a refused or rejected submission must leave unchanged. */
async function recordedState(u: string, d: DayKey): Promise<string> {
  const parts = [
    JSON.stringify(await redis.hGetAll(K.solves(d, 0))),
    JSON.stringify(await redis.hGetAll(K.first(d, 0))),
    String(await redis.zCard(K.lb(d))),
    JSON.stringify(await redis.hGetAll(K.timedist)),
    (await redis.hGetAll(K.userDay(d, u)))[F.help] ?? '',
    String(await redis.zCard(K.userDays(u))),
  ];
  return parts.join('|');
}

test('the four Validator cases of Req 28.7', async () => {
  const d = freshDay(5);
  await seedDay(d);
  const at = nowIn(d);
  await holdScored('t2_v', d, 4, at);
  const body = { dayKey: d, gen: 0, tileIndex: 4 };
  const before = await recordedState('t2_v', d);
  // 1. An exact match is accepted.
  expect((await validateSubmission('t2_v', d, { ...body, grid: solutionGrid(storedTile(d, 4)) })).status).toBe('accepted');
  // 2. A one-Cell mismatch is rejected.
  const wrong = { ...body, grid: wrongGridAt(d, 4, 0) };
  const w = await validateSubmission('t2_v', d, wrong);
  expect(w.status).toBe('rejected');
  // 3. A 6x6 grid on a 5x5 Day_Key is INVALID_GRID.
  const big = encodeGrid(new Array<CellState>(36).fill(0));
  const v3 = await validateSubmission('t2_v', d, { ...body, grid: big });
  expect(v3).toEqual({ status: 'error', code: 'INVALID_GRID' });
  // 4. A Tile_Index not assigned to the user is TILE_NOT_ASSIGNED.
  const v4 = await validateSubmission('t2_v', d, { ...body, tileIndex: 9, grid: solutionGrid(storedTile(d, 9)) });
  expect(v4).toEqual({ status: 'error', code: 'TILE_NOT_ASSIGNED' });
  // No rejected case raised a Solve_Count or recorded a Stitch.
  expect(await redis.hLen(K.solves(d, 0))).toBe(0);
  expect(await redis.hLen(K.first(d, 0))).toBe(0);
  // The one-Cell mismatch counted exactly one Mistake on the held scored Tile.
  expect(intOr((await redis.hGetAll(K.userDay(d, 't2_v')))[F.mistakes(0)], 0)).toBe(1);
  expect(await recordedState('t2_v', d)).toBe(before);
});

function wrongGridAt(d: DayKey, t: number, cell: number): string {
  const tile = storedTile(d, t);
  return encodeGrid(Array.from(tile.solution, (v, i): CellState => ((i === cell ? 1 - v : v) === 1 ? 1 : 0)));
}

// Feature: patchwork-daily-mosaic, Property 23: The Validator accepts exactly the stored Solution
test('Property 23: acceptance iff the filled Cells equal the Solution', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 63 }), fc.integer({ min: 0, max: 200 }), async (t, fillSeed) => {
      const d = freshDay();
      await seedDay(d);
      const n = tileSizeFor(d);
      const tile = storedTile(d, t);
      const cells = Array.from({ length: n * n }, (_, i): CellState => ((fillSeed >> (i % 9)) + i * 7 + fillSeed) % 3 as CellState);
      const grid = encodeGrid(cells);
      const filled = filledMask(cells);
      const matches = filled.every((v, i) => v === tile.solution[i]);
      await holdScored('t2_p23', d, t, nowIn(d));
      const v = await validateSubmission('t2_p23', d, { dayKey: d, gen: 0, tileIndex: t, grid });
      expect(v.status === 'accepted').toBe(matches);
      if (v.status === 'rejected') expect(v.countedMistake).toBe(true);
      expect(await redis.hLen(K.solves(d, 0))).toBe(0);
    }),
    { numRuns: PBT_RUNS },
  );
});

test('marked-X and empty Cells are the same to the Validator', async () => {
  const d = freshDay();
  await seedDay(d);
  const t = 2;
  const tile = storedTile(d, t);
  await holdScored('t2_x', d, t, nowIn(d));
  const withX = encodeGrid(Array.from(tile.solution, (v): CellState => (v === 1 ? 1 : 2)));
  const withEmpty = encodeGrid(Array.from(tile.solution, (v): CellState => (v === 1 ? 1 : 0)));
  for (const grid of [withX, withEmpty]) {
    const v = await validateSubmission('t2_x', d, { dayKey: d, gen: 0, tileIndex: t, grid });
    expect(v.status).toBe('accepted');
  }
  // A filled Cell marked X is wrong.
  const flipped = encodeGrid(Array.from(tile.solution, (v, i): CellState => (i === 0 ? (v === 1 ? 2 : 1) : v === 1 ? 1 : 0)));
  expect((await validateSubmission('t2_x', d, { dayKey: d, gen: 0, tileIndex: t, grid: flipped })).status).toBe('rejected');
});

// Feature: patchwork-daily-mosaic, Property 24: Rejected submissions record nothing
test('Property 24: every refusal leaves recorded state unchanged; only wrong Cells on the scored Tile cost a Mistake', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  await holdScored('t2_p24', d, 1, at);
  await redis.hSet(K.userDay(d, 't2_p24'), { [F.extra(0)]: JSON.stringify({ t: 2, at, k: 'extra' }) });
  const before = await recordedState('t2_p24', d);
  const refusals: [string, Record<string, unknown>, string | null][] = [
    ['wrong dayKey', { dayKey: '2032-12-31', gen: 0, tileIndex: 1, grid: solutionGrid(storedTile(d, 1)) }, 'DAY_MISMATCH'],
    ['wrong gen', { dayKey: d, gen: 7, tileIndex: 1, grid: solutionGrid(storedTile(d, 1)) }, 'MOSAIC_CHANGED'],
    ['tile out of range', { dayKey: d, gen: 0, tileIndex: 64, grid: '' }, 'TILE_NOT_ASSIGNED'],
    ['negative tile', { dayKey: d, gen: 0, tileIndex: -1, grid: '' }, 'TILE_NOT_ASSIGNED'],
    ['unassigned tile', { dayKey: d, gen: 0, tileIndex: 3, grid: solutionGrid(storedTile(d, 3)) }, 'TILE_NOT_ASSIGNED'],
    ['bad characters', { dayKey: d, gen: 0, tileIndex: 1, grid: 'x'.repeat(25) }, 'INVALID_GRID'],
    ['no grid', { dayKey: d, gen: 0, tileIndex: 1 }, 'INVALID_GRID'],
  ];
  for (const [label, body, code] of refusals) {
    const v = await validateSubmission('t2_p24', d, body);
    expect(v.status, label).toBe('error');
    if (v.status === 'error') expect(v.code, label).toBe(code);
  }
  // Anonymous and non-Patchwork submissions are refused before any read or write.
  expect(await validateSubmission(undefined, d, { dayKey: d, gen: 0, tileIndex: 1, grid: '' })).toEqual({ status: 'error', code: 'AUTH_REQUIRED' });
  expect(await validateSubmission('t2_p24', null, { dayKey: d, gen: 0, tileIndex: 1, grid: '' })).toEqual({ status: 'error', code: 'NOT_A_PATCHWORK_POST' });
  // A wrong grid on the Extra_Tile is rejected but counts no Mistake.
  const wrongExtra = await validateSubmission('t2_p24', d, { dayKey: d, gen: 0, tileIndex: 2, grid: wrongGridAt(d, 2, 0) });
  expect(wrongExtra).toEqual({ status: 'rejected', countedMistake: false });
  expect(await recordedState('t2_p24', d)).toBe(before);
  expect((await redis.hGetAll(K.userDay(d, 't2_p24')))[F.mistakes(0)]).toBeUndefined();
  // Two wrong grids on the held scored Tile count two Mistakes; the extra-tile rejection added none.
  await validateSubmission('t2_p24', d, { dayKey: d, gen: 0, tileIndex: 1, grid: wrongGridAt(d, 1, 0) });
  await validateSubmission('t2_p24', d, { dayKey: d, gen: 0, tileIndex: 1, grid: wrongGridAt(d, 1, 1) });
  expect(intOr((await redis.hGetAll(K.userDay(d, 't2_p24')))[F.mistakes(0)], 0)).toBe(2);
  expect(await redis.hLen(K.solves(d, 0))).toBe(0);
  expect(await redis.hLen(K.first(d, 0))).toBe(0);
});

// Feature: patchwork-daily-mosaic, Property 34: Scores use Server data only
test('Property 34: client-sent times, mistakes and scores are ignored', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  const accepted = at + 700;
  for (const [u, junk] of [
    ['t2_clean', {}],
    ['t2_junk', { solveMs: 5, mistakes: 99, score: 1_000_000, correct: true, assignedAtMs: 0 }],
  ] as const) {
    await holdScored(u, d, 8, at);
    // One wrong try first: the Server counts it, whatever the body says.
    await validateSubmission(u, d, { dayKey: d, gen: 0, tileIndex: 8, grid: wrongGridAt(d, 8, 3), ...junk });
    const v = await validateSubmission(u, d, { dayKey: d, gen: 0, tileIndex: 8, grid: solutionGrid(storedTile(d, 8)), ...junk });
    expect(v.status).toBe('accepted');
    if (v.status !== 'accepted') continue;
    const s = await commitStitch(u, v, accepted);
    const tile = storedTile(d, 8);
    const solveMs = solveMsFrom(at, accepted);
    expect(s.status).toBe('recorded');
    expect(s.status === 'recorded' && s.score?.solveMs).toBe(solveMs);
    expect(s.status === 'recorded' && s.score?.mistakes).toBe(1);
    expect(s.status === 'recorded' && s.score?.score).toBe(computeScore({ solveMs, mistakes: 1, parSeconds: tile.parSeconds as number }));
  }
  const clean = (await redis.hGetAll(K.userDay(d, 't2_clean')))[F.result];
  const junked = (await redis.hGetAll(K.userDay(d, 't2_junk')))[F.result];
  expect(junked).toBe(clean);
  expect(countsFrom(await redis.hGetAll(K.timedist), 64).reduce((a, b) => a + b, 0)).toBe(2);
});
