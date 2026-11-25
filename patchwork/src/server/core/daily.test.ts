import { redis, reddit } from '@devvit/web/server';
import type { Comment, Post } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect, vi } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayKeyFromOrdinal, dayOrdinal, dayStartMs, tileSizeFor } from '../../shared/daykey';
import { PBT_RUNS } from '../../shared/pbt';
import type { Hook } from '../test/harness';
import { instrumentRedis } from '../test/harness';
import { CREATION_WINDOW_MS, ensureDailyPost } from './daily';
import type { DailyOrigin, DailyOutcome } from './daily';
import { K, M } from './keys';

const test = createDevvitTest();

// Monday-sized (5x5) days keep the builds cheap; cases step a week at a time.
let caseCounter = 0;
const BASE = (() => {
  let o = dayOrdinal('2038-01-01' as DayKey);
  while (tileSizeFor(dayKeyFromOrdinal(o)) !== 5) o++;
  return o;
})();
function freshDay(): DayKey {
  const d = dayKeyFromOrdinal(BASE + caseCounter * 7);
  caseCounter++;
  return d;
}

interface RedditMock {
  readonly postCalls: number;
  readonly tilesAtCall: number[];
  readonly deleted: string[];
  readonly distinguish: ReturnType<typeof vi.fn>;
}

function mockReddit(failOn: readonly boolean[], d: DayKey): RedditMock {
  const state = { postCalls: 0, tilesAtCall: [] as number[], deleted: [] as string[], distinguish: vi.fn(() => Promise.resolve()) };
  vi.spyOn(reddit, 'submitCustomPost').mockImplementation(async () => {
    state.postCalls++;
    state.tilesAtCall.push(await redis.hLen(K.tiles(d, 0)));
    if (failOn[state.postCalls - 1] === true) throw new Error('reddit down');
    return {
      id: 't3_daily1',
      delete: () => {
        state.deleted.push('t3_daily1');
        return Promise.resolve();
      },
    } as unknown as Post;
  });
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ id: 't1_sticky', distinguish: state.distinguish } as unknown as Comment);
  return state;
}

test('concurrent cron and tick runs create exactly one post, with the stickied comment distinguished', async () => {
  const d = freshDay();
  const now = dayStartMs(d) + 60_000;
  const m = mockReddit([], d);
  const origins: DailyOrigin[] = ['cron', 'tick', 'tick', 'cron'];
  const outcomes = await Promise.all(origins.map((o) => ensureDailyPost(d, o, now)));
  expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
  expect(outcomes.every((o) => ['created', 'exists', 'in-progress'].includes(o))).toBe(true);
  expect(m.postCalls).toBe(1);
  expect(m.tilesAtCall).toEqual([64]);
  expect(await redis.hGet(K.days, d)).toBe('t3_daily1');
  expect(await redis.hGet(K.posts, 't3_daily1')).toBe(d);
  expect(await redis.hLen(K.tiles(d, 0))).toBe(64);
  const meta = await redis.hGetAll(K.meta(d));
  expect(meta[M.postId]).toBe('t3_daily1');
  expect(meta[M.dayNumber]).toBe('1');
  expect(meta[M.activeGen]).toBe('0');
  expect(m.distinguish).toHaveBeenCalledWith(true);
  expect(meta[M.sticky]).toBe('t1_sticky');
  expect(await ensureDailyPost(d, 'cron', now)).toBe('exists');
  expect(m.postCalls).toBe(1);
});

test('a Day_Key before the effective Start_Date stores nothing (Req 7.8)', async () => {
  const d = freshDay();
  const later = dayKeyFromOrdinal(dayOrdinal(d) + 1);
  await redis.hSet(K.install, { date: later });
  const m = mockReddit([], d);
  expect(await ensureDailyPost(d, 'cron', dayStartMs(d) + 60_000)).toBe('before-start');
  expect(m.postCalls).toBe(0);
  expect(await redis.hLen(K.meta(d))).toBe(0);
  expect(await redis.hLen(K.tiles(d, 0))).toBe(0);
  expect(await redis.hLen(K.days)).toBe(0);
});

test('the creation window closes for automatic runs but not for a moderator', async () => {
  const d = freshDay();
  const m = mockReddit([], d);
  const after = dayStartMs(d) + CREATION_WINDOW_MS + 1;
  expect(await ensureDailyPost(d, 'cron', after)).toBe('window-closed');
  expect(await ensureDailyPost(d, 'tick', after)).toBe('window-closed');
  expect(m.postCalls).toBe(0);
  expect(await ensureDailyPost(d, 'moderator', after)).toBe('created');
  expect(m.postCalls).toBe(1);
});

test('a held claim reports in-progress', async () => {
  const d = freshDay();
  mockReddit([], d);
  await redis.set(K.postClaim(d), 'someone-else');
  expect(await ensureDailyPost(d, 'cron', dayStartMs(d) + 60_000)).toBe('in-progress');
});

test('three failed attempts leave no post and no Tile or meta keys', async () => {
  const d = freshDay();
  const now = dayStartMs(d) + 60_000;
  const m = mockReddit([true, true, true], d);
  const outcomes: DailyOutcome[] = [];
  for (let i = 0; i < 5; i++) outcomes.push(await ensureDailyPost(d, 'cron', now));
  expect(outcomes).toEqual(['failed', 'failed', 'failed', 'attempts-exhausted', 'attempts-exhausted']);
  expect(m.postCalls).toBe(3);
  expect(await redis.hLen(K.meta(d))).toBe(0);
  expect(await redis.hLen(K.tiles(d, 0))).toBe(0);
  expect(await redis.hLen(K.days)).toBe(0);
});

test('a failed mapping write deletes the orphan post and every key of the Day_Key', async () => {
  const d = freshDay();
  const m = mockReddit([], d);
  const inst = instrumentRedis();
  const postsKey = K.posts;
  const failFirstPostsWrite: Hook = (method, args) => {
    if (method === 'hSet' && args[0] === postsKey) {
      inst.hook(null);
      throw new Error('redis down');
    }
  };
  inst.hook(failFirstPostsWrite);
  expect(await ensureDailyPost(d, 'cron', dayStartMs(d) + 60_000)).toBe('failed');
  expect(m.postCalls).toBe(1);
  expect(m.deleted).toEqual(['t3_daily1']);
  expect(await redis.hLen(K.posts)).toBe(0);
  expect(await redis.hLen(K.days)).toBe(0);
  expect(await redis.hLen(K.meta(d))).toBe(0);
  expect(await redis.hLen(K.tiles(d, 0))).toBe(0);
});

// Feature: patchwork-daily-mosaic, Property 63: Exactly one daily post, and a clean state after failure
test(
  'Property 63: concurrent runs and Reddit failures create at most one post in at most 3 attempts',
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 2, max: 4 }),
        fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
        async (rounds, width, failOn) => {
          const d = freshDay();
          const now = dayStartMs(d) + 60_000;
          const m = mockReddit(failOn, d);
          let created = 0;
          for (let r = 0; r < rounds; r++) {
            const outcomes = await Promise.all(
              Array.from({ length: width }, (_, i) => ensureDailyPost(d, i % 2 === 0 ? 'cron' : 'tick', now)),
            );
            created += outcomes.filter((o) => o === 'created').length;
          }
          expect(m.postCalls).toBeLessThanOrEqual(3);
          if (created === 0) {
            // Every attempt failed: nothing of the Day_Key remains.
            expect(m.postCalls).toBe(Math.min(rounds, 3));
            expect(await redis.hLen(K.meta(d))).toBe(0);
            expect(await redis.hLen(K.tiles(d, 0))).toBe(0);
            expect(await redis.hGet(K.days, d)).toBeUndefined();
          } else {
            expect(created).toBe(1);
            expect(m.tilesAtCall.every((n) => n >= 64)).toBe(true);
            expect(await redis.hGet(K.days, d)).toBe('t3_daily1');
            expect(await redis.hGet(K.posts, 't3_daily1')).toBe(d);
            expect((await redis.hGetAll(K.meta(d)))[M.postId]).toBe('t3_daily1');
            expect(await redis.hLen(K.tiles(d, 0))).toBe(64);
          }
        },
      ),
      { numRuns: PBT_RUNS },
    );
  },
  120_000,
);
