import { redis, reddit } from '@devvit/web/server';
import type { Comment, Post } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect, vi } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayEndMs, dayKeyFromOrdinal, dayOrdinal, dayStartMs } from '../../shared/daykey';
import { computeScore, solveMsFrom } from '../../shared/score';
import { PBT_RUNS } from '../../shared/pbt';
import { instrumentRedis, scheduled, seedDay, solutionGrid, storedTile, users } from '../test/harness';
import { runTick } from './daily';
import { switchGeneration } from './generation';
import { F, K, M } from './keys';
import { freshSnapshot } from './preview';
import { countsFrom, intOr } from './redisx';
import { commitStitch, parseResult } from './stitch';
import type { StitchOutcome } from './stitch';
import { validateSubmission } from './validate';
import type { ValidationOutcome } from './validate';

const test = createDevvitTest();

let caseCounter = 0;
const BASE = dayOrdinal('2031-01-01' as DayKey);
function freshDay(): DayKey {
  return dayKeyFromOrdinal(BASE + caseCounter++);
}
function nowIn(d: DayKey): number {
  return dayStartMs(d) + 60_000;
}

interface Sub {
  readonly v: ValidationOutcome;
  readonly s: StitchOutcome | null;
}

/** Runs the Validator and, when it accepts, the Stitch commit, exactly as the route does. */
async function submit(u: string, d: DayKey, t: number, nowMs: number, body?: Record<string, unknown>, g = 0): Promise<Sub> {
  // Generation 0 has seed 0; a regenerate keeps the motif and uses the generation number as the seed.
  const grid = solutionGrid(storedTile(d, t, g, 0));
  const v = await validateSubmission(u, d, { dayKey: d, gen: g, tileIndex: t, grid, ...body });
  if (v.status !== 'accepted') return { v, s: null };
  return { v, s: await commitStitch(u, v, nowMs) };
}

async function holdScored(u: string, d: DayKey, t: number, at: number): Promise<void> {
  await redis.hSet(K.userDay(d, u), { [F.scored(0)]: JSON.stringify({ t, at }) });
}
async function holdExtra(u: string, d: DayKey, t: number, at: number, g = 0): Promise<void> {
  await redis.hSet(K.userDay(d, u), { [F.extra(g)]: JSON.stringify({ t, at, k: 'extra' }) });
}

async function totals(d: DayKey, g = 0): Promise<{ solves: number[]; stitchedTotal: number; timedist: number }> {
  const solves = countsFrom(await redis.hGetAll(K.solves(d, g)), 64);
  return {
    solves,
    stitchedTotal: await redis.hLen(K.first(d, g)),
    timedist: countsFrom(await redis.hGetAll(K.timedist), 64).reduce((a, b) => a + b, 0),
  };
}

test('stitch example: a scored Stitch records result, leaderboard and played day', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  const accepted = at + 5_000;
  await holdScored('t2_a', d, 3, at);
  const { v, s } = await submit('t2_a', d, 3, accepted);
  expect(v.status).toBe('accepted');
  if (s?.status !== 'recorded') throw new Error(`expected recorded, got ${s?.status}`);
  const tile = storedTile(d, 3);
  const solveMs = solveMsFrom(at, accepted);
  expect(s.score?.solveMs).toBe(solveMs);
  expect(s.score?.score).toBe(computeScore({ solveMs, mistakes: 0, parSeconds: tile.parSeconds as number }));
  expect(s.solveCount).toBe(1);
  expect(await redis.zScore(K.lb(d), 't2_a')).toBe(s.score?.score);
  expect(await redis.zCard(K.userDays('t2_a'))).toBe(1);
  const ud = await redis.hGetAll(K.userDay(d, 't2_a'));
  expect(ud[F.help]).toBe('1');
  expect(parseResult(ud[F.result])?.tileIndex).toBe(3);
});

// Feature: patchwork-daily-mosaic, Property 25: Repeated matching submissions record one Stitch
test('Property 25: k repeated matching submissions record exactly one Stitch', async () => {
  const inst = instrumentRedis();
  await fc.assert(
    fc.asyncProperty(fc.scheduler(), fc.integer({ min: 1, max: 20 }), fc.integer({ min: 0, max: 63 }), async (s, k, t) => {
      const d = freshDay();
      await seedDay(d);
      const at = nowIn(d);
      await holdScored('t2_rep', d, t, at);
      inst.hook(scheduled(s));
      const subs = await s.waitFor(Promise.all(Array.from({ length: k }, () => submit('t2_rep', d, t, at + 2_000))));
      inst.hook(null);
      const recorded = subs.filter((x) => x.s?.status === 'recorded').length;
      const already = subs.filter((x) => x.s?.status === 'already-stitched').length;
      expect(recorded).toBe(1);
      expect(already).toBe(k - 1);
      expect((await totals(d)).solves[t]).toBe(1);
      expect(intOr((await redis.hGetAll(K.userDay(d, 't2_rep')))[F.help], 0)).toBe(1);
    }),
    { numRuns: PBT_RUNS },
  );
});

// Feature: patchwork-daily-mosaic, Property 26: Concurrent Stitches of one Tile by different users
test('Property 26: m concurrent Stitches of one Tile record m Solves and one First_Stitcher', async () => {
  const inst = instrumentRedis();
  await fc.assert(
    fc.asyncProperty(fc.scheduler(), fc.integer({ min: 2, max: 100 }), fc.integer({ min: 0, max: 63 }), async (s, m, t) => {
      const d = freshDay();
      await seedDay(d);
      const us = users(m, 'p26-');
      const at = nowIn(d);
      for (const u of us) await holdExtra(u, d, t, at);
      inst.hook(scheduled(s));
      const subs = await s.waitFor(Promise.all(us.map((u) => submit(u, d, t, at + 1_000))));
      inst.hook(null);
      expect(subs.every((x) => x.s?.status === 'recorded')).toBe(true);
      const after = await totals(d);
      expect(after.solves[t]).toBe(m);
      expect(after.stitchedTotal).toBe(1);
      const first = await redis.hGet(K.first(d, 0), String(t));
      expect(first).toBeDefined();
      expect(us).toContain(first as string);
    }),
    { numRuns: PBT_RUNS },
  );
});

// Feature: patchwork-daily-mosaic, Property 27: Counters agree after any sequence of Stitches
test('Property 27: Solve_Counts, Stitched_Total, Help_Counts and the snapshot agree', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ user: fc.integer({ min: 0, max: 7 }), tile: fc.integer({ min: 0, max: 63 }) }), {
        minLength: 1,
        maxLength: 24,
      }),
      async (ops) => {
        const d = freshDay();
        await seedDay(d);
        const at = nowIn(d);
        let i = 0;
        for (const op of ops) {
          const u = `t2_s${op.user}`;
          await holdExtra(u, d, op.tile, at + i++);
          await submit(u, d, op.tile, at + i++);
        }
        const distinct = new Map<string, Set<number>>();
        for (const op of ops) {
          const key = `t2_s${op.user}`;
          if (!distinct.has(key)) distinct.set(key, new Set());
          if (!distinct.get(key)?.has(op.tile)) distinct.get(key)?.add(op.tile);
        }
        const expectedSolves = new Array<number>(64).fill(0);
        let helpSum = 0;
        for (const set of distinct.values()) {
          helpSum += set.size;
          for (const t of set) expectedSolves[t] = (expectedSolves[t] ?? 0) + 1;
        }
        const after = await totals(d);
        expect(after.solves).toEqual(expectedSolves);
        const wantTotal = expectedSolves.filter((c) => c > 0).length;
        expect(after.stitchedTotal).toBe(wantTotal);
        let helpActual = 0;
        for (const u of distinct.keys()) helpActual += intOr((await redis.hGetAll(K.userDay(d, u)))[F.help], 0);
        expect(helpActual).toBe(helpSum);
        expect(after.solves.reduce((a, b) => a + b, 0)).toBe(helpSum);
        const snap = await freshSnapshot(d);
        expect(snap.stitchedTotal).toBe(wantTotal);
        expect(snap.solveCounts).toEqual(expectedSolves);
      },
    ),
    { numRuns: PBT_RUNS },
  );
});

// Feature: patchwork-daily-mosaic, Property 28: The completion time is written once
test('Property 28: the 64th Tile writes g0:done once; tick repairs a lost write', async () => {
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ id: 't1_sticky', distinguish: () => Promise.resolve() } as unknown as Comment);
  vi.spyOn(reddit, 'getPostById').mockResolvedValue({
    setPostData: () => Promise.resolve(),
    setTextFallback: () => Promise.resolve(),
  } as unknown as Post);
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  const us = users(64, 'p28-');
  let last = at;
  for (let t = 0; t < 64; t++) {
    const u = us[t] as string;
    await holdExtra(u, d, t, at + t);
    last = at + t + 500;
    await submit(u, d, t, last);
  }
  expect(await totals(d)).toMatchObject({ stitchedTotal: 64 });
  const done = await redis.hGet(K.meta(d), M.done(0));
  expect(done).toBe(String(last));
  // Later Stitches leave it unchanged.
  await submit(us[0] as string, d, 0, last + 9_000);
  expect(await redis.hGet(K.meta(d), M.done(0))).toBe(done);
  // A lost completion write is repaired by the next tick, then never moved.
  await redis.hDel(K.meta(d), [M.done(0)]);
  await redis.hSet(K.dirty, { [d]: String(last + 10_000) });
  const tickAt = dayStartMs(d) + 10 * 60_000;
  await runTick(tickAt);
  expect(await redis.hGet(K.meta(d), M.done(0))).toBe(String(tickAt));
  await redis.hSet(K.dirty, { [d]: String(tickAt + 1) });
  await runTick(tickAt + 30_000);
  expect(await redis.hGet(K.meta(d), M.done(0))).toBe(String(tickAt));
});

test('stitch example: one score per user per Day_Key across resubmits, extras and a regenerate', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  await holdScored('t2_one', d, 5, at);
  const first = await submit('t2_one', d, 5, at + 4_000);
  expect(first.s?.status).toBe('recorded');
  const recorded = (await redis.hGetAll(K.userDay(d, 't2_one')))[F.result];
  expect(recorded).toBeDefined();
  // Resubmit the scored Tile: already-stitched, nothing new.
  const again = await submit('t2_one', d, 5, at + 8_000);
  expect(again.s?.status).toBe('already-stitched');
  // An Extra_Tile Stitch raises Help_Count only.
  await holdExtra('t2_one', d, 6, at + 9_000);
  const extra = await submit('t2_one', d, 6, at + 10_000);
  if (extra.s?.status !== 'recorded') throw new Error(`expected recorded, got ${extra.s?.status}`);
  expect(extra.s.score).toBeNull();
  // A regenerate keeps the result, leaderboard entry and played day.
  const sw = await switchGeneration(d, 'regenerate');
  expect(sw.gen).toBe(1);
  await holdExtra('t2_one', d, 7, at + 11_000, 1);
  const body = { dayKey: d, gen: 1, tileIndex: 7, grid: solutionGrid(storedTile(d, 7)) };
  const v = await validateSubmission('t2_one', d, body);
  expect(v.status).toBe('accepted');
  if (v.status === 'accepted') expect((await commitStitch('t2_one', v, at + 12_000)).status).toBe('recorded');
  const ud = await redis.hGetAll(K.userDay(d, 't2_one'));
  expect(ud[F.result]).toBe(recorded);
  expect(ud[F.help]).toBe('3');
  expect(await redis.zCard(K.lb(d))).toBe(1);
  expect(await redis.zScore(K.lb(d), 't2_one')).toBe(parseResult(recorded)?.score);
  expect(countsFrom(await redis.hGetAll(K.timedist), 64).reduce((a, b) => a + b, 0)).toBe(1);
  expect(await redis.zCard(K.userDays('t2_one'))).toBe(1);
  // A resubmit of the old generation's Tile is refused: the mosaic changed (Req 22.10).
  const stale = await submit('t2_one', d, 5, at + 13_000);
  expect(stale.v.status).toBe('error');
  if (stale.v.status === 'error') expect(stale.v.code).toBe('MOSAIC_CHANGED');
});

// Feature: patchwork-daily-mosaic, Property 33: One score per user per Day_Key
test('Property 33: any op sequence records at most one result', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom('resubmit', 'extra', 'regen'), { minLength: 1, maxLength: 6 }),
      fc.integer({ min: 0, max: 63 }),
      async (rawOps, t0) => {
        // At most one regenerate per case; later ones become extra Tiles.
        let seenRegen = false;
        const ops = rawOps.map((op) => {
          if (op !== 'regen') return op;
          if (seenRegen) return 'extra';
          seenRegen = true;
          return op;
        });
        const d = freshDay();
        await seedDay(d);
        const u = 't2_p33';
        // pw:timedist and pw:u:{u}:days are global keys: they accumulate across cases, so compare deltas.
        const timedistBefore = countsFrom(await redis.hGetAll(K.timedist), 64).reduce((a, b) => a + b, 0);
        const daysBefore = await redis.zCard(K.userDays(u));
        const ud = () => K.userDay(d, u);
        const at = nowIn(d);
        let clock = at;
        const tick = (): number => (clock += 1_000);
        await holdScored(u, d, t0, tick());
        const first = await submit(u, d, t0, tick());
        expect(first.s?.status).toBe('recorded');
        let gen = 0;
        let help = 1;
        let stitches = 1;
        const stitched: Set<number>[] = [new Set([t0])];
        const lastInGen: (number | null)[] = [t0];
        const recorded = (await redis.hGetAll(ud()))[F.result];
        expect(recorded).toBeDefined();
        for (const op of ops) {
          if (op === 'resubmit') {
            // A resubmit targets the last Tile stitched in the active generation; before any, there is none.
            const lt = lastInGen[gen];
            if (lt === null || lt === undefined) continue;
            const r = await submit(u, d, lt, tick(), undefined, gen);
            expect(r.s?.status).toBe('already-stitched');
          } else if (op === 'extra') {
            const free = [...Array(64).keys()].filter((t) => !stitched[gen]?.has(t));
            if (free.length === 0) continue;
            const t = free[0] as number;
            await holdExtra(u, d, t, tick(), gen);
            if (gen === 0) {
              const r = await submit(u, d, t, tick());
              expect(r.s?.status).toBe('recorded');
            } else {
              // A regenerate keeps the motif and bumps the seed to the generation number.
              const v = await validateSubmission(u, d, { dayKey: d, gen, tileIndex: t, grid: solutionGrid(storedTile(d, t, gen, 0)) });
              expect(v.status).toBe('accepted');
              if (v.status === 'accepted') expect((await commitStitch(u, v, tick())).status).toBe('recorded');
            }
            stitched[gen]?.add(t);
            lastInGen[gen] = t;
            help += 1;
            stitches += 1;
          } else {
            gen = (await switchGeneration(d, 'regenerate')).gen;
            stitched[gen] = new Set();
            lastInGen[gen] = null;
          }
        }
        const udAll = await redis.hGetAll(ud());
        expect(udAll[F.result]).toBe(recorded);
        expect(intOr(udAll[F.help], 0)).toBe(help);
        expect(await redis.zCard(K.lb(d))).toBe(1);
        expect(await redis.zScore(K.lb(d), u)).toBe(parseResult(recorded)?.score);
        expect(countsFrom(await redis.hGetAll(K.timedist), 64).reduce((a, b) => a + b, 0)).toBe(timedistBefore + 1);
        expect(await redis.zCard(K.userDays(u))).toBe(daysBefore + 1);
        let solveSum = 0;
        for (let g = 0; g <= gen; g++) solveSum += countsFrom(await redis.hGetAll(K.solves(d, g)), 64).reduce((a, b) => a + b, 0);
        expect(solveSum).toBe(stitches);
      },
    ),
    { numRuns: PBT_RUNS },
  );
});

// Feature: patchwork-daily-mosaic, Property 35: Nothing is scored after the Day_Key ends
test('Property 35: late assignment and late Stitch record no score', async () => {
  const d = freshDay();
  await seedDay(d);
  const end = dayEndMs(d);
  // An open at or after dayEndMs assigns a late Tile and records no Scored_Attempt.
  const { assignForOpen } = await import('./assign');
  const late = await assignForOpen('t2_late', d, end);
  if (late.kind !== 'late') throw new Error(`expected late, got ${late.kind}`);
  const udLate = await redis.hGetAll(K.userDay(d, 't2_late'));
  expect(udLate[F.scored(0)]).toBeUndefined();
  expect(udLate[F.extra(0)]).toBeDefined();
  // The late Stitch counts but is never scored.
  const r = await submit('t2_late', d, late.tile.index, end + 1_000);
  if (r.s?.status !== 'recorded') throw new Error(`expected recorded, got ${r.s?.status}`);
  expect(r.s.score).toBeNull();
  expect((await totals(d)).solves[late.tile.index]).toBe(1);
  expect(await redis.zCard(K.lb(d))).toBe(0);
  expect((await totals(d)).timedist).toBe(0);
  expect(await redis.zCard(K.userDays('t2_late'))).toBe(0);
  expect((await redis.hGetAll(K.userDay(d, 't2_late')))[F.result]).toBeUndefined();
});

test('L6: an assignment at 23:59 submitted at 00:01 is not scored', async () => {
  const d = freshDay();
  await seedDay(d);
  const t = 11;
  const at = dayEndMs(d) - 60_000;
  await holdScored('t2_cutoff', d, t, at);
  const r = await submit('t2_cutoff', d, t, dayEndMs(d) + 60_000);
  if (r.s?.status !== 'recorded') throw new Error(`expected recorded, got ${r.s?.status}`);
  expect(r.s.score).toBeNull();
  expect(r.s.scoreNote).toBe('day-ended');
  const ud = await redis.hGetAll(K.userDay(d, 't2_cutoff'));
  expect(JSON.parse(ud[F.scoredDone] as string)).toMatchObject({ g: 0, t, n: 'day-ended' });
  expect(ud[F.result]).toBeUndefined();
  expect((await totals(d)).solves[t]).toBe(1);
  expect(await redis.zCard(K.lb(d))).toBe(0);
});

test('score unavailable when the stored Tile has no Par (Req 13.8)', async () => {
  const d = freshDay();
  await seedDay(d);
  const t = 9;
  const raw = JSON.parse((await redis.hGet(K.tiles(d, 0), String(t))) as string) as Record<string, unknown>;
  delete raw.t;
  await redis.hSet(K.tiles(d, 0), { [String(t)]: JSON.stringify(raw) });
  const at = nowIn(d);
  await holdScored('t2_nopar', d, t, at);
  const r = await submit('t2_nopar', d, t, at + 2_000);
  if (r.s?.status !== 'recorded') throw new Error(`expected recorded, got ${r.s?.status}`);
  expect(r.s.score).toBeNull();
  expect(r.s.scoreNote).toBe('unavailable');
  expect((await totals(d)).solves[t]).toBe(1);
  expect(await redis.zCard(K.lb(d))).toBe(0);
});
