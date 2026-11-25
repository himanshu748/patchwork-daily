import { redis } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayStartMs } from '../../shared/daykey';
import { maskCount, unpackStitchedPixels } from '../../shared/wire';
import { as, seedDay, solutionGrid, storedTile, users } from '../test/harness';
import { assignForOpen } from './assign';
import { readEndCard } from './endcard';
import { F, K } from './keys';
import { cachedSnapshot, freshSnapshot, postDataOf, realtimeMessage } from './preview';
import { apiRoutes } from '../routes/api';
import { commitStitch } from './stitch';
import { validateSubmission } from './validate';

const test = createDevvitTest();
const D = '2033-04-04' as DayKey;
const NOW = dayStartMs(D) + 60_000;

/**
 * Asserts no unstitched Tile's Solution hex or pixel string appears as a field value in the payload. The
 * quoted form is checked because short hex strings legitimately occur inside the 16-character stitched mask;
 * a real leak would be its own JSON string value (design.md Property 22).
 */
function expectNoLeak(payload: string, except: readonly number[] = []): void {
  for (let t = 0; t < 64; t++) {
    if (except.includes(t)) continue;
    const tile = storedTile(D, t);
    expect(payload).not.toContain(`"${tile.solutionHex}"`);
    expect(payload).not.toContain(`"${tile.pixels}"`);
  }
}

// Feature: patchwork-daily-mosaic, Property 22: Clues only before a Stitch
test('Property 22: assign, mosaic, postData and realtime carry Clues only until a Stitch', async () => {
  await seedDay(D);
  const r = await assignForOpen('t2_a', D, NOW);
  if (r.kind !== 'scored') throw new Error('expected scored');
  expect([...Object.keys(r.tile)].sort()).toEqual(['colClues', 'gen', 'index', 'rowClues', 'size']);
  const snap = await freshSnapshot(D);
  expect(snap.stitchedTotal).toBe(0);
  expect(snap.pixels).toBe('');
  expect(maskCount(snap.stitchedMask)).toBe(0);
  expectNoLeak(JSON.stringify({ assign: r, snap, post: postDataOf(snap), rt: realtimeMessage(snap) }));

  // A Stitch reveals exactly that Tile's pixels, and only in the submitter's response.
  await redis.hSet(K.userDay(D, 't2_a'), { [F.scored(0)]: JSON.stringify({ t: 5, at: NOW }) });
  const v = await validateSubmission('t2_a', D, { dayKey: D, gen: 0, tileIndex: 5, grid: solutionGrid(storedTile(D, 5)) });
  expect(v.status).toBe('accepted');
  if (v.status !== 'accepted') return;
  await commitStitch('t2_a', v, NOW + 2_000);

  const snap2 = await freshSnapshot(D);
  expect(snap2.stitchedTotal).toBe(1);
  const tiles = unpackStitchedPixels(snap2.stitchedMask, snap2.pixels, snap2.tileSize);
  expect(tiles?.map((x) => x !== null)).toEqual(Array.from({ length: 64 }, (_, i) => i === 5));
  expectNoLeak(JSON.stringify({ snap: snap2, post: postDataOf(snap2), rt: realtimeMessage(snap2) }), [5]);
});

test('the submit response carries the stitched Tile data to the stitcher only', async ({ headers }) => {
  const postId = await seedDay(D);
  await redis.hSet(K.userDay(D, 't2_a'), { [F.scored(0)]: JSON.stringify({ t: 5, at: NOW }) });
  const res = await as(headers, { userId: 't2_a', postId }, () =>
    apiRoutes.request('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dayKey: D, gen: 0, tileIndex: 5, grid: solutionGrid(storedTile(D, 5)) }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.ok).toBe(true);
  expect(body.solutionMask).toBe(storedTile(D, 5).solutionHex);
  expect(body.tilePixels).toBe(storedTile(D, 5).pixels);
  // Another user's mosaic view still hides every other Tile.
  const snap = await freshSnapshot(D);
  expectNoLeak(JSON.stringify({ snap, post: postDataOf(snap) }), [5]);
});

type Flow = readonly [unknown, unknown, unknown];

async function oneUserFlow(u: string): Promise<Flow> {
  const assigned = await assignForOpen(u, D, NOW);
  if (assigned.kind !== 'scored') throw new Error('expected scored');
  const v = await validateSubmission(u, D, {
    dayKey: D,
    gen: 0,
    tileIndex: assigned.tile.index,
    grid: solutionGrid(storedTile(D, assigned.tile.index)),
  });
  if (v.status !== 'accepted') throw new Error('expected accepted');
  const submitted = await commitStitch(u, v, NOW + 3_000);
  const card = await readEndCard(u, D, NOW + 4_000);
  return [assigned, submitted, card] as const;
}

let solo: Flow | null = null;

test('Property 67 part 1: a user flow with no other user present (baseline)', async () => {
  await seedDay(D);
  solo = await oneUserFlow('t2_solo');
  expect(solo[1]).toMatchObject({ status: 'recorded' });
});

// Feature: patchwork-daily-mosaic, Property 67: Viewing changes nothing
test('Property 67 part 2: concurrent viewers change neither state nor responses', async () => {
  await seedDay(D);
  const dump = async (): Promise<string> =>
    JSON.stringify([
      await redis.hGetAll(K.meta(D)),
      await redis.hLen(K.tiles(D, 0)),
      await redis.get(K.ctr(D, 0)),
      await redis.hGetAll(K.solves(D, 0)),
      await redis.hGetAll(K.first(D, 0)),
      await redis.zRange(K.lb(D), 0, -1, { by: 'rank' }),
      await redis.hGetAll(K.timedist),
      await redis.hGetAll(K.helpers(D)),
      await redis.hGetAll(K.userDay(D, 't2_solo')),
      await redis.hGetAll(K.dirty),
    ]);
  const viewers = users(30, 't2_view-').flatMap((u) => [
    () => freshSnapshot(D),
    () => cachedSnapshot(D),
    () => readEndCard(u, D, NOW + 1_000),
    () => assignForOpen(undefined, D, NOW + 1_000),
  ]);
  await dump();
  const loaded = await oneUserFlow('t2_solo');
  await Promise.all(viewers.map((read) => read()));
  const beforeMid = await dump();
  await Promise.all(viewers.map((read) => read()));
  expect(await dump()).toBe(beforeMid);
  expect(loaded).toEqual(solo);
});
