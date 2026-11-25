import { redis, reddit } from '@devvit/web/server';
import type { Comment } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect, vi } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayStartMs, tileSizeFor } from '../../shared/daykey';
import { seedDay, solutionGrid, storedTile } from '../test/harness';
import { F, K, M } from './keys';
import { tilePixelsBase64 } from './tilerec';
import { shareResult } from './share';
import { commitStitch } from './stitch';
import { validateSubmission } from './validate';

const test = createDevvitTest();
const D = '2036-03-03' as DayKey;
const NOW = dayStartMs(D) + 60_000;

type CommentCall = { id: string; text: string; runAs?: string | undefined };

function mockComment(id = 't1_shared'): { calls: CommentCall[] } {
  const calls: CommentCall[] = [];
  vi.spyOn(reddit, 'submitComment').mockImplementation((args) => {
    const call: CommentCall = { id: args.id, text: 'text' in args ? args.text : '' };
    if (args.runAs !== undefined) call.runAs = args.runAs;
    calls.push(call);
    return Promise.resolve({ id } as unknown as Comment);
  });
  vi.spyOn(reddit, 'getCurrentUsername').mockResolvedValue('testuser');
  return { calls };
}

/** A user with a stitched scored Tile on D and the post's stickied comment recorded. */
async function stitchedUser(u: string): Promise<void> {
  await redis.hSet(K.userDay(D, u), { [F.scored(0)]: JSON.stringify({ t: 3, at: NOW }) });
  const v = await validateSubmission(u, D, { dayKey: D, gen: 0, tileIndex: 3, grid: solutionGrid(storedTile(D, 3)) });
  if (v.status !== 'accepted') throw new Error('expected accepted');
  await commitStitch(u, v, NOW + 2_000);
  await redis.hSet(K.meta(D), { [M.sticky]: 't1_sticky' });
}

test('share examples: no result and no stickied comment refuse the share', async () => {
  await seedDay(D);
  mockComment();
  expect(await shareResult('t2_nobody', D, 'nonce-0001')).toEqual({ code: 'NO_RESULT' });
  await stitchedUser('t2_a');
  await redis.hDel(K.meta(D), [M.sticky]);
  expect(await shareResult('t2_a', D, 'nonce-0002')).toEqual({ code: 'SHARE_FAILED' });
});

// Feature: patchwork-daily-mosaic, Property 45: One share comment per tap
test('Property 45: repeated shares with one nonce post at most one comment, as the user, under the sticky', async () => {
  await seedDay(D);
  const { calls } = mockComment();
  await stitchedUser('t2_a');
  const nonce = 'nonce-abcdef';
  const first = await shareResult('t2_a', D, nonce);
  expect(first).toEqual({ commentId: 't1_shared' });
  // Sequential repeats return the recorded comment and post nothing new.
  expect(await shareResult('t2_a', D, nonce)).toEqual({ commentId: 't1_shared' });
  // Concurrent repeats race on the nonce claim; the comment is still posted at most once.
  const beforeRace = calls.length;
  const racing = await Promise.all(Array.from({ length: 10 }, () => shareResult('t2_a', D, 'nonce-race-1')));
  expect(calls.length - beforeRace).toBe(1);
  expect(racing.some((r) => 'commentId' in r && r.commentId === 't1_shared')).toBe(true);
  expect(calls[0]?.id).toBe('t1_sticky');
  expect(calls[0]?.runAs).toBe('USER');
  expect(calls[0]?.text).toContain('testuser');
});

// Feature: patchwork-daily-mosaic, Property 44: The Emoji_Grid reveals no Solution
test('Property 44: the share text is unchanged when every Solution and pixel is replaced', async () => {
  await seedDay(D);
  const { calls } = mockComment();
  await stitchedUser('t2_a');
  const before = await shareResult('t2_a', D, 'nonce-text-1');
  if (!('commentId' in before)) throw new Error('share failed');
  expect(before.commentId).toBe('t1_shared');
  const size = tileSizeFor(D);
  // Replace every stored Solution and pixel blob with other valid values; keep Clues and Par.
  const all = await redis.hGetAll(K.tiles(D, 0));
  const replaced: Record<string, string> = {};
  const hex = 'f'.repeat(Math.ceil((size * size) / 4));
  const pixels = tilePixelsBase64(new Uint8Array(size * size).fill(1), size);
  for (const [field, json] of Object.entries(all)) {
    const rec = JSON.parse(json) as Record<string, unknown>;
    rec.s = hex;
    rec.p = pixels;
    replaced[field] = JSON.stringify(rec);
  }
  await redis.hSet(K.tiles(D, 0), replaced);
  const after = await shareResult('t2_a', D, 'nonce-text-2');
  if (!('commentId' in after)) throw new Error('share failed');
  // The text depends on the stitched set and the result only, never on Solution or pixel data (Req 17.14).
  expect(calls[1]?.text).toBe(calls[0]?.text);
  expect(calls[0]?.text).not.toContain(storedTile(D, 3).solutionHex);
  expect(calls[0]?.text).toContain('testuser');
});
