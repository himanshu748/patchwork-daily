import { redis } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayKeyFromOrdinal, dayOrdinal, dayStartMs } from '../../shared/daykey';
import { PBT_RUNS } from '../../shared/pbt';
import type { Hook } from '../test/harness';
import { instrumentRedis, seedDay, solutionGrid, storedTile } from '../test/harness';
import { assignForOpen, parseHeld } from './assign';
import { F, K } from './keys';
import { countsFrom, intOr, setCommandTimeout } from './redisx';
import { commitStitch } from './stitch';
import { validateSubmission } from './validate';

const test = createDevvitTest();

let caseCounter = 0;
const BASE = dayOrdinal('2037-01-01' as DayKey);
function freshDay(): DayKey {
  return dayKeyFromOrdinal(BASE + caseCounter++);
}
function nowIn(d: DayKey): number {
  return dayStartMs(d) + 60_000;
}

/** Fails every command from the k-th (0-based) onward. */
function errorFrom(k: number): Hook {
  let i = 0;
  return () => {
    if (i++ >= k) throw new Error('injected failure');
  };
}

const inst = instrumentRedis();
let assignCmds = 0;
let submitCmds = 0;

async function holdScored(u: string, d: DayKey, t: number, at: number): Promise<void> {
  await redis.hSet(K.userDay(d, u), { [F.scored(0)]: JSON.stringify({ t, at }) });
}

async function submit(u: string, d: DayKey, t: number, nowMs: number) {
  const v = await validateSubmission(u, d, { dayKey: d, gen: 0, tileIndex: t, grid: solutionGrid(storedTile(d, t)) });
  if (v.status !== 'accepted') throw new Error(`expected accepted, got ${v.status}`);
  return commitStitch(u, v, nowMs);
}

test('learn the command counts of one assignment and one scored Stitch', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  let mark = inst.log.length;
  const a = await assignForOpen('t2_learn', d, at);
  assignCmds = inst.log.length - mark;
  expect(a.kind).toBe('scored');
  expect(assignCmds).toBeGreaterThan(5);
  await holdScored('t2_learn2', d, 7, at);
  mark = inst.log.length;
  const s = await submit('t2_learn2', d, 7, at + 1_000);
  submitCmds = inst.log.length - mark;
  expect(s.status).toBe('recorded');
  expect(submitCmds).toBeGreaterThan(8);
});

test('D18: a failure after the counter increment skips one counter value and records no attempt', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  const solvesKey = K.solves(d, 0);
  inst.hook((method, args) => {
    if (method === 'hGetAll' && args[0] === solvesKey) {
      inst.hook(null);
      throw new Error('redis down');
    }
  });
  await expect(assignForOpen('t2_d18', d, at)).rejects.toThrow('redis down');
  inst.hook(null);
  expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(1);
  expect(await redis.hGet(K.userDay(d, 't2_d18'), F.scored(0))).toBeUndefined();
  // The retry assigns from the next counter value; the skipped one is never reused.
  const retry = await assignForOpen('t2_d18', d, at + 1_000);
  if (retry.kind !== 'scored') throw new Error('expected scored');
  expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(2);
  expect(retry.tile.index).toBe(1);
});

test('D41: a failure after the Scored_Attempt write keeps the attempt timed from the first assignment', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  inst.hook((method) => {
    if (method === 'expire') {
      inst.hook(null);
      throw new Error('redis down');
    }
  });
  await expect(assignForOpen('t2_d41', d, at)).rejects.toThrow('redis down');
  inst.hook(null);
  const held = parseHeld(await redis.hGet(K.userDay(d, 't2_d41'), F.scored(0)));
  expect(held).not.toBeNull();
  expect(held?.at).toBe(at);
  const retry = await assignForOpen('t2_d41', d, at + 30_000);
  if (retry.kind !== 'scored') throw new Error('expected scored');
  expect(retry.tile.index).toBe(held?.t);
  expect(retry.assignedAtMs).toBe(at);
  expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(1);
});

test('a Redis timeout during the Stitch transaction is not saved, and a retry records once', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  await holdScored('t2_slow', d, 3, at);
  const before = setCommandTimeout(30);
  try {
    inst.hook((method) => (method === 'exec' ? 'hang' : undefined));
    const s = await submit('t2_slow', d, 3, at + 1_000);
    expect(s.status).toBe('not-saved');
  } finally {
    inst.hook(null);
    setCommandTimeout(before);
  }
  expect(await redis.hLen(K.solves(d, 0))).toBe(0);
  const retry = await submit('t2_slow', d, 3, at + 2_000);
  expect(retry.status).toBe('recorded');
  expect(intOr(await redis.hGet(K.solves(d, 0), '3'), 0)).toBe(1);
});

test('a null exec twice is not saved and changes nothing', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  await holdScored('t2_null', d, 4, at);
  inst.hook((method) => (method === 'exec' ? { value: null } : undefined));
  const s = await submit('t2_null', d, 4, at + 1_000);
  inst.hook(null);
  expect(s.status).toBe('not-saved');
  expect(await redis.hLen(K.solves(d, 0))).toBe(0);
  expect(await redis.hLen(K.first(d, 0))).toBe(0);
  expect(intOr((await redis.hGetAll(K.userDay(d, 't2_null')))[F.help], 0)).toBe(0);
  const retry = await submit('t2_null', d, 4, at + 2_000);
  expect(retry.status).toBe('recorded');
  expect(intOr(await redis.hGet(K.solves(d, 0), '4'), 0)).toBe(1);
});

test('a failure after a successful exec never turns the saved Stitch into an error (C7)', async () => {
  const d = freshDay();
  await seedDay(d);
  const at = nowIn(d);
  await holdScored('t2_c7', d, 5, at);
  let execSeen = false;
  inst.hook((method) => {
    if (method === 'exec') {
      execSeen = true;
      return;
    }
    if (execSeen) throw new Error('c7 down');
  });
  const s = await submit('t2_c7', d, 5, at + 1_000);
  inst.hook(null);
  expect(s.status).toBe('recorded');
  if (s.status === 'recorded') {
    expect(s.stitchedTotal).toBeNull();
    expect(s.streak).toBeNull();
  }
  expect(intOr(await redis.hGet(K.solves(d, 0), '5'), 0)).toBe(1);
  expect(intOr((await redis.hGetAll(K.userDay(d, 't2_c7')))[F.help], 0)).toBe(1);
});

// Feature: patchwork-daily-mosaic, Property 30: A failed Redis call changes nothing
test('Property 30 (assignment): any injected failure is retryable and leaves at most the documented residue', async () => {
  const tdBefore = countsFrom(await redis.hGetAll(K.timedist), 64).reduce((a, b) => a + b, 0);
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: assignCmds - 1 }), async (k) => {
      const d = freshDay();
      await seedDay(d);
      const u = `t2_p30_${k}_${caseCounter}`;
      const at = nowIn(d);
      inst.hook(errorFrom(k));
      await expect(assignForOpen(u, d, at)).rejects.toThrow('injected failure');
      inst.hook(null);
      expect(await redis.hLen(K.solves(d, 0))).toBe(0);
      expect(await redis.hLen(K.first(d, 0))).toBe(0);
      expect(await redis.zCard(K.lb(d))).toBe(0);
      expect(countsFrom(await redis.hGetAll(K.timedist), 64).reduce((a, b) => a + b, 0)).toBe(tdBefore);
      const ctr = intOr(await redis.get(K.ctr(d, 0)), 0);
      const held = parseHeld(await redis.hGet(K.userDay(d, u), F.scored(0)));
      // The only allowed residue: one skipped counter value (D18), plus a recorded attempt (D41).
      expect([0, 1]).toContain(ctr);
      if (held) expect(ctr).toBe(1);
      const retry = await assignForOpen(u, d, at + 1_000);
      if (retry.kind !== 'scored') throw new Error('expected scored');
      if (held) {
        expect(retry.tile.index).toBe(held.t);
        expect(retry.assignedAtMs).toBe(held.at);
      }
    }),
    { numRuns: PBT_RUNS },
  );
});

// Feature: patchwork-daily-mosaic, Property 30: A failed Redis call changes nothing
test('Property 30 (stitch): any injected failure is not-saved with state unchanged, or saved', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: submitCmds - 1 }), fc.integer({ min: 0, max: 63 }), async (k, t) => {
      const d = freshDay();
      await seedDay(d);
      const u = `t2_p30s_${k}_${caseCounter}`;
      const at = nowIn(d);
      await holdScored(u, d, t, at);
      inst.hook(errorFrom(k));
      let thrown = false;
      let outcome: Awaited<ReturnType<typeof submit>> | null = null;
      try {
        outcome = await submit(u, d, t, at + 1_000);
      } catch {
        thrown = true;
      }
      inst.hook(null);
      const ud = await redis.hGetAll(K.userDay(d, u));
      const failed = thrown || outcome?.status === 'not-saved';
      if (failed) {
        expect(ud[F.stitched(0, t)]).toBeUndefined();
        expect(await redis.hLen(K.solves(d, 0))).toBe(0);
        expect(await redis.hLen(K.first(d, 0))).toBe(0);
        expect(await redis.zCard(K.lb(d))).toBe(0);
        expect(intOr(ud[F.help], 0)).toBe(0);
        expect(ud[F.result]).toBeUndefined();
        expect(await redis.zCard(K.userDays(u))).toBe(0);
      } else {
        expect(outcome?.status).toBe('recorded');
        expect(ud[F.stitched(0, t)]).toBe('1');
        expect(intOr(await redis.hGet(K.solves(d, 0), String(t)), 0)).toBe(1);
      }
      // A clean retry ends with exactly one Stitch recorded.
      const retry = await submit(u, d, t, at + 2_000);
      expect(['recorded', 'already-stitched']).toContain(retry.status);
      expect(intOr(await redis.hGet(K.solves(d, 0), String(t)), 0)).toBe(1);
      expect(intOr((await redis.hGetAll(K.userDay(d, u)))[F.help], 0)).toBe(1);
    }),
    { numRuns: PBT_RUNS },
  );
});
