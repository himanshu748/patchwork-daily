import { redis, reddit } from '@devvit/web/server';
import type { Post } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect, vi } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayNumber, dayStartMs } from '../../shared/daykey';
import { START_DATE, seedDay } from '../test/harness';
import { K, M } from './keys';
import { broadcastAfterStitch, freshSnapshot, refreshPreview, textFallback } from './preview';

const test = createDevvitTest();
const D = '2036-05-05' as DayKey;
const NOW = dayStartMs(D) + 60_000;

function fakePost(): { setPostData: ReturnType<typeof vi.fn>; setTextFallback: ReturnType<typeof vi.fn> } {
  const post = {
    setPostData: vi.fn(() => Promise.resolve()),
    setTextFallback: vi.fn(() => Promise.resolve()),
  };
  vi.spyOn(reddit, 'getPostById').mockResolvedValue(post as unknown as Post);
  return post;
}

async function stitch(t: number): Promise<void> {
  await redis.hIncrBy(K.solves(D, 0), String(t), 1);
  await redis.hSetNX(K.first(D, 0), String(t), 't2_someone');
}

test('the text fallback reads **Day N · S/64 stitched**', async () => {
  await seedDay(D);
  const snap = await freshSnapshot(D);
  expect(textFallback(snap)).toBe(`**Day ${dayNumber(D, START_DATE)} · 0/64 stitched**\n\nPatchwork plays in the Reddit app and on new Reddit.`);
});

// Feature: patchwork-daily-mosaic, Property 65: A preview failure never loses a Stitch
test('Property 65: a failed preview write leaves the Stitch and the marker for the next tick', async () => {
  await seedDay(D);
  const post = fakePost();
  await stitch(4);
  expect(await refreshPreview(D)).toBe('updated');
  expect(post.setPostData).toHaveBeenCalledTimes(1);
  const data = post.setPostData.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(data.s).toBe(1);
  expect(post.setTextFallback).toHaveBeenCalledTimes(1);
  expect((post.setTextFallback.mock.calls[0]?.[0] as { text: string }).text).toContain(`**Day ${dayNumber(D, START_DATE)} · 1/64 stitched**`);
  expect(await redis.hGet(K.meta(D), M.previewS)).toBe('0:1');
  // No movement: nothing written.
  expect(await refreshPreview(D)).toBe('unchanged');
  expect(post.setPostData).toHaveBeenCalledTimes(1);
  // A failure keeps the Stitch and the previous marker.
  await stitch(9);
  post.setPostData.mockRejectedValueOnce(new Error('reddit down'));
  expect(await refreshPreview(D)).toBe('failed');
  expect(await redis.hGet(K.meta(D), M.previewS)).toBe('0:1');
  expect(await redis.hGet(K.solves(D, 0), '9')).toBe('1');
  expect(await redis.hLen(K.first(D, 0))).toBe(2);
  // The next tick without a failure catches up.
  expect(await refreshPreview(D)).toBe('updated');
  expect(await redis.hGet(K.meta(D), M.previewS)).toBe('0:2');
});

test('at most one realtime message per Day_Key per 500 ms window (B10)', async ({ mocks }) => {
  await seedDay(D);
  await stitch(1);
  for (let i = 0; i < 10; i++) await broadcastAfterStitch(D, NOW + i * 10);
  const channel = `pw-${D}`;
  const first = mocks.realtime.getSentMessagesForChannel(channel);
  expect(first).toHaveLength(1);
  const msg = first[0]?.data?.msg as Record<string, unknown>;
  expect(msg).toMatchObject({ t: 'mosaic', d: D, g: 0, s: 1, c: false });
  // A later window sends again.
  await stitch(2);
  await broadcastAfterStitch(D, NOW + 600);
  expect(mocks.realtime.getSentMessagesForChannel(channel)).toHaveLength(2);
});
