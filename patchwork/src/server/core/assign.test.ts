import { redis } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect } from 'vitest';
import { candidateFrom, pickTile } from '../../shared/assignment';
import type { DayKey } from '../../shared/daykey';
import { dayKeyFromOrdinal, dayOrdinal, dayStartMs } from '../../shared/daykey';
import { PBT_RUNS } from '../../shared/pbt';
import { instrumentRedis, scheduled, seedDay, users } from '../test/harness';
import { assignExtra, assignForOpen, parseHeld } from './assign';
import { F, K } from './keys';
import { intOr } from './redisx';

const test = createDevvitTest();

let caseCounter = 0;
const BASE = dayOrdinal('2030-01-01' as DayKey);
function freshDay(): DayKey {
  return dayKeyFromOrdinal(BASE + caseCounter++);
}
function nowIn(d: DayKey): number {
  return dayStartMs(d) + 60_000;
}

async function heldTile(d: DayKey, u: string, g = 0): Promise<number | null> {
  return parseHeld(await redis.hGet(K.userDay(d, u), F.scored(g)))?.t ?? null;
}

/** One request per user; returns the 'scored' results in user order. */
async function openForAll(us: string[], d: DayKey, s?: fc.Scheduler): Promise<number[]> {
  const calls = us.map((u) => assignForOpen(u, d, nowIn(d)));
  const results = s ? await s.waitFor(Promise.all(calls)) : await Promise.all(calls);
  return results.map((r) => {
    if (r.kind !== 'scored') throw new Error(`expected scored, got ${r.kind}`);
    return r.tile.index;
  });
}

test('assignment examples: N = 1, 63, 64 and 65 with one request per user', async () => {
  for (const n of [1, 63, 64, 65]) {
    const d = freshDay();
    await seedDay(d);
    const us = users(n, `ex${n}-`);
    const tiles = await openForAll(us, d);
    for (let i = 0; i < n; i++) expect(await heldTile(d, us[i] as string)).toBe(tiles[i]);
    expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(n);
    // The first 64 assignments by counter value cover 64 distinct Tile_Indexes; later counters wrap.
    const expected = Array.from({ length: n }, (_, i) => candidateFrom(i + 1)).sort((a, b) => a - b);
    expect([...tiles].sort((a, b) => a - b)).toEqual(expected);
    expect(await redis.hLen(K.solves(d, 0))).toBe(0);
  }
});

// Feature: patchwork-daily-mosaic, Property 20: Concurrent Scored_Attempt assignment
test('Property 20: concurrent assignment gives every user one stable Tile', async () => {
  const inst = instrumentRedis();
  await fc.assert(
    fc.asyncProperty(fc.scheduler(), fc.integer({ min: 1, max: 120 }), async (s, n) => {
      const d = freshDay();
      await seedDay(d);
      const us = users(n, 'p20-');
      inst.hook(scheduled(s));
      const tiles = await openForAll(us, d, s);
      inst.hook(null);
      for (let i = 0; i < n; i++) expect(await heldTile(d, us[i] as string)).toBe(tiles[i]);
      expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(n);
      const expected = Array.from({ length: n }, (_, i) => candidateFrom(i + 1)).sort((a, b) => a - b);
      expect([...tiles].sort((a, b) => a - b)).toEqual(expected);
      expect(await redis.hLen(K.solves(d, 0))).toBe(0);
      // A repeated open names the same Tile and does not touch the counter.
      for (let i = 0; i < n; i++) expect(await heldTile(d, us[i] as string)).toBe(tiles[i]);
      for (const u of us.slice(0, 3)) {
        const again = await assignForOpen(u, d, nowIn(d) + 5_000);
        if (!('tile' in again)) throw new Error(`expected a tile, got ${again.kind}`);
        expect(again.tile.index).toBe(tiles[us.indexOf(u)]);
      }
      expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(n);
    }),
    { numRuns: PBT_RUNS },
  );
});

test.each([100, 1000])('Property 20 example: N = %i concurrent users', async (n) => {
  const d = freshDay();
  await seedDay(d);
  const us = users(n, `big${n}-`);
  const tiles = await openForAll(us, d);
  expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(n);
  const expected = Array.from({ length: n }, (_, i) => candidateFrom(i + 1)).sort((a, b) => a - b);
  expect([...tiles].sort((a, b) => a - b)).toEqual(expected);
  for (let i = 0; i < n; i += 97) expect(await heldTile(d, us[i] as string)).toBe(tiles[i]);
});

test('a practice open writes nothing (Decision D11)', async () => {
  const d = freshDay();
  await seedDay(d);
  await redis.incrBy(K.ctr(d, 0), 5);
  const r = await assignForOpen(undefined, d, nowIn(d));
  if (r.kind !== 'practice') throw new Error(`expected practice, got ${r.kind}`);
  expect(r.tile.index).toBe(candidateFrom(6));
  expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(5);
  expect(await redis.hLen(K.solves(d, 0))).toBe(0);
  expect(await redis.hLen(K.first(d, 0))).toBe(0);
});

test('extra examples: scored-first, and complete writes nothing', async () => {
  const d = freshDay();
  await seedDay(d);
  const ud = (u: string): string => K.userDay(d, u);
  // A held but unstitched Scored_Attempt: SCORED_FIRST names its Tile_Index.
  await redis.hSet(ud('t2_a'), { [F.scored(0)]: JSON.stringify({ t: 7, at: 1 }) });
  const held = await assignExtra('t2_a', d, nowIn(d));
  expect(held).toEqual({ kind: 'scored-first', tileIndex: 7 });
  // No Scored_Attempt at all: SCORED_FIRST without a Tile_Index.
  const fresh = await assignExtra('t2_b', d, nowIn(d));
  expect(fresh).toEqual({ kind: 'scored-first', tileIndex: null });
  // All 64 stitched: complete, counter unchanged, no Extra_Tile recorded.
  const done: Record<string, string> = { [F.scoredDone]: JSON.stringify({ g: 0, t: 0 }) };
  for (let t = 0; t < 64; t++) done[F.stitched(0, t)] = '1';
  await redis.hSet(ud('t2_c'), done);
  const before = intOr(await redis.get(K.ctr(d, 0)), 0);
  expect(await assignExtra('t2_c', d, nowIn(d))).toEqual({ kind: 'complete' });
  expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(before);
  expect(await redis.hGet(ud('t2_c'), F.extra(0))).toBeUndefined();
});

// Feature: patchwork-daily-mosaic, Property 21: Extra_Tile assignment
test('Property 21: extra tiles follow pickTile with the stitched Tiles excluded', async () => {
  const inst = instrumentRedis();
  await fc.assert(
    fc.asyncProperty(
      fc.scheduler(),
      fc.uniqueArray(fc.integer({ min: 0, max: 63 }), { minLength: 0, maxLength: 63 }),
      fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 64, maxLength: 64 }),
      fc.integer({ min: 0, max: 200 }),
      fc.boolean(),
      async (s, stitched, solveCounts, ctr, past) => {
        const d = freshDay();
        await seedDay(d);
        const u = 't2_extra';
        const ud = K.userDay(d, u);
        const fields: Record<string, string> = { [F.scoredDone]: JSON.stringify({ g: 0, t: stitched[0] ?? 0 }) };
        for (const t of stitched) fields[F.stitched(0, t)] = '1';
        await redis.hSet(ud, fields);
        const solves: Record<string, string> = {};
        solveCounts.forEach((c, t) => {
          if (c > 0) solves[String(t)] = String(c);
        });
        if (Object.keys(solves).length > 0) await redis.hSet(K.solves(d, 0), solves);
        await redis.set(K.ctr(d, 0), String(ctr));
        const nowMs = past ? dayStartMs(d) + 86_400_001 : nowIn(d);
        inst.hook(scheduled(s));
        const r = await s.waitFor(assignExtra(u, d, nowMs));
        inst.hook(null);
        if (stitched.length === 64) {
          expect(r.kind).toBe('complete');
          return;
        }
        if (r.kind !== 'extra' && r.kind !== 'late') throw new Error(`unexpected ${r.kind}`);
        expect(r.kind).toBe(past ? 'late' : 'extra');
        const expected = pickTile(solveCounts, candidateFrom(ctr + 1), (t) => stitched.includes(t));
        expect(expected).not.toBeNull();
        expect(r.tile.index).toBe(expected);
        expect(stitched).not.toContain(r.tile.index);
        expect(intOr(await redis.get(K.ctr(d, 0)), 0)).toBe(ctr + 1);
        const recorded = parseHeld(await redis.hGet(ud, F.extra(0)));
        expect(recorded?.t).toBe(r.tile.index);
        expect(recorded?.k).toBe(past ? 'late' : 'extra');
      },
    ),
    { numRuns: PBT_RUNS },
  );
});
