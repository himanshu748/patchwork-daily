import { redis, reddit } from '@devvit/web/server';
import type { Comment, Post, User } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect, vi } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayKeyFromMs, dayKeyFromOrdinal, dayOrdinal } from '../../shared/daykey';
import { PBT_RUNS } from '../../shared/pbt';
import { as, seedDay } from '../test/harness';
import { buildGeneration, ensureTiles, switchGeneration } from './generation';
import { F, K, M } from './keys';
import { MOD_CHECK_FAILED_TEXT, MOD_REQUIRED_TEXT, internalRoutes } from '../routes/internal';
import { instrumentRedis } from '../test/harness';

const test = createDevvitTest();

let caseCounter = 0;
const BASE = dayOrdinal('2039-01-01' as DayKey);
function freshDay(): DayKey {
  return dayKeyFromOrdinal(BASE + caseCounter++);
}
const inst = instrumentRedis();

function toastText(body: Record<string, unknown>): string {
  const t = body.showToast;
  return typeof t === 'string' ? t : ((t as { text?: string })?.text ?? '');
}

async function post(path: string, headers: Record<string, string | undefined>, userId: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await as(headers, { userId }, () =>
    internalRoutes.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );
  return (await res.json()) as Record<string, unknown>;
}

function mockPerms(perms: readonly string[]): void {
  vi.spyOn(reddit, 'getUserById').mockResolvedValue({
    getModPermissionsForSubreddit: () => Promise.resolve([...perms]),
  } as unknown as User);
}

test('switch examples: regenerate bumps the seed, skip advances the motif, both deterministic', async () => {
  const d = freshDay();
  await seedDay(d);
  const regen = await switchGeneration(d, 'regenerate');
  expect(regen.gen).toBe(1);
  const expected = buildGeneration(d, { seed: 1, motifIndex: 0 });
  expect(await redis.hGetAll(K.tiles(d, 1))).toEqual(expected.records);
  expect((await redis.hGetAll(K.meta(d)))[M.activeGen]).toBe('1');
  // A rerun of the generator with the recorded spec reproduces the stored Tiles.
  const meta = await redis.hGetAll(K.meta(d));
  const again = buildGeneration(d, { seed: Number(meta[M.seed(1)]), motifIndex: Number(meta[M.motifIndex(1)]) });
  expect(again.records).toEqual(expected.records);

  const d2 = freshDay();
  await seedDay(d2);
  const skip = await switchGeneration(d2, 'skip');
  expect(skip.gen).toBe(1);
  expect(await redis.hGetAll(K.tiles(d2, 1))).toEqual(buildGeneration(d2, { seed: 0, motifIndex: 1 }).records);
});

test('a UGC Sunday regenerates to a procedural Mosaic (Decision D33)', async () => {
  const d = freshDay();
  await seedDay(d);
  await redis.hSet(K.meta(d), { [M.source(0)]: 'ugc' });
  await switchGeneration(d, 'regenerate');
  expect((await redis.hGetAll(K.meta(d)))[M.source(1)]).toBe('procedural');
});

// Feature: patchwork-daily-mosaic, Property 61: Generation switch
test('Property 61: a failed switch leaves the previous generation and every record untouched', async () => {
  // Learn the command count of one clean switch.
  const learnDay = freshDay();
  await seedDay(learnDay);
  let mark = inst.log.length;
  await switchGeneration(learnDay, 'regenerate');
  const switchCmds = inst.log.length - mark;
  expect(switchCmds).toBeGreaterThan(3);

  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: switchCmds - 1 }), async (k) => {
      const d = freshDay();
      await seedDay(d);
      // Records that must survive a failed switch. The user is unique per case because play history is global.
      const user = `t2_keep_${caseCounter}`;
      const ud = K.userDay(d, user);
      await redis.hSet(ud, { [F.result]: '{"score":500,"solveMs":3000}', [F.scoredDone]: '{"g":0,"t":2}', [F.help]: '2', [F.stitched(0, 2)]: '1' });
      await redis.zAdd(K.lb(d), { member: user, score: 500 });
      await redis.zAdd(K.userDays(user), { member: d, score: dayOrdinal(d) });
      await redis.hSet(K.solves(d, 0), { '2': '1' });
      await redis.set(K.ctr(d, 0), '5');
      let i = 0;
      inst.hook(() => {
        if (i++ === k) throw new Error('injected failure');
      });
      await expect(switchGeneration(d, 'regenerate')).rejects.toThrow('injected failure');
      inst.hook(null);
      const meta = await redis.hGetAll(K.meta(d));
      expect(meta[M.activeGen]).toBe('0');
      expect(await redis.hLen(K.tiles(d, 1))).toBe(0);
      expect(await redis.hLen(K.tiles(d, 0))).toBe(64);
      expect(await redis.hGetAll(K.solves(d, 0))).toEqual({ '2': '1' });
      expect(await redis.get(K.ctr(d, 0))).toBe('5');
      expect((await redis.hGetAll(ud))[F.result]).toBe('{"score":500,"solveMs":3000}');
      expect(await redis.zScore(K.lb(d), user)).toBe(500);
      expect(await redis.zCard(K.userDays(user))).toBe(1);
      // A clean retry switches normally.
      const retry = await switchGeneration(d, 'regenerate');
      expect(await redis.hLen(K.tiles(d, retry.gen))).toBe(64);
      expect((await redis.hGetAll(K.meta(d)))[M.activeGen]).toBe(String(retry.gen));
    }),
    { numRuns: PBT_RUNS },
  );
});

// Feature: patchwork-daily-mosaic, Property 61: Generation switch
test('Property 61 (route): a non-moderator changes nothing; a moderator sees the confirm form', async ({ headers }) => {
  const today = dayKeyFromMs(Date.now());
  await seedDay(today);
  mockPerms([]);
  const denied = await post('/menu/regenerate', headers, 't2_random', {});
  expect(toastText(denied)).toBe(MOD_REQUIRED_TEXT);
  expect((await redis.hGetAll(K.meta(today)))[M.activeGen]).toBe('0');

  mockPerms(['posts']);
  const allowed = await post('/menu/regenerate', headers, 't2_mod', {});
  const form = allowed.showForm as { name: string };
  expect(form.name).toBe('regenerateConfirm');
  expect((await redis.hGetAll(K.meta(today)))[M.activeGen]).toBe('0');

  vi.spyOn(reddit, 'getUserById').mockRejectedValue(new Error('reddit down'));
  const failed = await post('/menu/regenerate', headers, 't2_mod', {});
  expect(toastText(failed)).toBe(MOD_CHECK_FAILED_TEXT);
});

test('route example: a confirmed regenerate switches the generation and refreshes the preview', async ({ headers }) => {
  const today = dayKeyFromMs(Date.now());
  await seedDay(today);
  mockPerms(['all']);
  vi.spyOn(reddit, 'getPostById').mockResolvedValue({
    setPostData: () => Promise.resolve(),
    setTextFallback: () => Promise.resolve(),
  } as unknown as Post);
  const res = await post('/form/regenerate', headers, 't2_mod', { confirm: true });
  const meta = await redis.hGetAll(K.meta(today));
  expect(meta[M.activeGen]).toBe('1');
  expect(toastText(res)).toContain('Regenerated');
  expect(toastText(res)).toContain(today);
  // Without the tick box nothing changes.
  mockPerms(['all']);
  const res2 = await post('/form/skip', headers, 't2_mod', { confirm: false });
  expect(toastText(res2)).toContain('Nothing changed');
  expect((await redis.hGetAll(K.meta(today)))[M.activeGen]).toBe('1');
});

test('Decision D21: regenerate on a Day_Key without a post creates it', async ({ headers }) => {
  const today = dayKeyFromMs(Date.now());
  mockPerms(['all']);
  vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue({ id: 't3_created', delete: () => Promise.resolve() } as unknown as Post);
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ id: 't1_c', distinguish: () => Promise.resolve() } as unknown as Comment);
  const res = await post('/form/regenerate', headers, 't2_mod', { confirm: true });
  expect(toastText(res)).toContain(`Posted today's mosaic for ${today}`);
  expect(await redis.hGet(K.days, today)).toBe('t3_created');
  expect(await redis.hLen(K.tiles(today, 0))).toBe(64);
});

// Feature: patchwork-daily-mosaic, Property 64: Tiles are generated once per generation
test('Property 64: concurrent requests store the generation once and every reader agrees', async () => {
  const d = freshDay();
  const spec = { seed: 0, motifIndex: 0 };
  const first = await Promise.all(Array.from({ length: 5 }, () => ensureTiles(d, 0, spec)));
  expect(first.filter((s) => s === 'stored')).toHaveLength(1);
  expect(first.every((s) => ['stored', 'present', 'busy'].includes(s))).toBe(true);
  const stored = await redis.hGetAll(K.tiles(d, 0));
  expect(Object.keys(stored)).toHaveLength(64);
  expect(stored).toEqual(buildGeneration(d, spec).records);
  // Once stored, every later call sees the same records and runs no generation.
  const second = await Promise.all(Array.from({ length: 5 }, () => ensureTiles(d, 0, spec)));
  expect(second).toEqual(['present', 'present', 'present', 'present', 'present']);
  expect(await redis.hGetAll(K.tiles(d, 0))).toEqual(stored);
});

test('the 64 Tiles are stored before the generation is switched', async () => {
  const d = freshDay();
  await seedDay(d);
  const mark = inst.log.length;
  await switchGeneration(d, 'regenerate');
  const calls = inst.log.slice(mark);
  const tilesWrite = calls.findIndex((c) => c.method === 'hSet' && c.key === K.tiles(d, 1));
  const metaWrites = calls.map((c, i) => (c.method === 'hSet' && c.key === K.meta(d) ? i : -1)).filter((i) => i >= 0);
  expect(tilesWrite).toBeGreaterThanOrEqual(0);
  expect(metaWrites.length).toBeGreaterThanOrEqual(2);
  expect(tilesWrite).toBeLessThan(metaWrites[metaWrites.length - 1] as number);
});
