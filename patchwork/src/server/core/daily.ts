import { reddit } from '@devvit/web/server';
import type { Post } from '@devvit/web/server';
import type { DayKey } from '../../shared/daykey';
import { dayKeyFromMs, dayNumber, dayOrdinal, dayStartMs, parseDayKey, tileSizeFor } from '../../shared/daykey';
import { postTitle } from '../../shared/mosaic';
import { effectiveStartDate, readMeta, recordInstallDate } from './day';
import { buildGeneration, ensureTiles, prebuildNextDay } from './generation';
import { CLAIM_SECONDS, K, M } from './keys';
import { buildSnapshot, postDataOf, refreshPreview, sendSnapshot, textFallback } from './preview';
import { claim, release, rx } from './redisx';

export type DailyOutcome = 'exists' | 'created' | 'before-start' | 'window-closed' | 'attempts-exhausted' | 'in-progress' | 'failed';
export type DailyOrigin = 'cron' | 'tick' | 'install' | 'moderator';

/** Automatic creation runs from 00:00:00 to 00:04:59 UTC, at most 3 attempts (Req 7.6, Req 7.7, Decision D21). */
export const CREATION_WINDOW_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 3;
export const STICKY_TEXT = 'Share your Patchwork result as a reply to this comment with the "Share as comment" button.';

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** Creates and stickies the single app comment that share comments reply to (B15). */
export async function ensureStickyComment(d: DayKey): Promise<boolean> {
  const meta = await readMeta(d);
  if (!meta?.postId || meta.stickyCommentId) return Boolean(meta?.stickyCommentId);
  const comment = await reddit.submitComment({ id: meta.postId as `t3_${string}`, text: STICKY_TEXT, runAs: 'APP' });
  await comment.distinguish(true);
  await rx.hSet(K.meta(d), { [M.sticky]: comment.id });
  return true;
}

async function cleanup(d: DayKey): Promise<void> {
  if ((await rx.hGet(K.days, d)) !== undefined) return;
  await rx.del(K.tiles(d, 0), K.meta(d));
}

async function createPost(d: DayKey, start: DayKey): Promise<void> {
  const spec = { seed: 0, motifIndex: 0 };
  const built = buildGeneration(d, spec);
  const stored = await ensureTiles(d, 0, spec, built);
  if (stored === 'busy') throw new Error('Tiles are being built by another run');
  const n = dayNumber(d, start);
  await rx.hSet(K.meta(d), {
    [M.dayNumber]: String(n),
    [M.tileSize]: String(tileSizeFor(d)),
    [M.startDate]: start,
    [M.genSeq]: '0',
    [M.seed(0)]: '0',
    [M.motifIndex(0)]: '0',
    [M.variant(0)]: String(built.variant),
    [M.motif(0)]: built.motifName,
    [M.source(0)]: 'procedural',
    [M.activeGen]: '0',
  });
  const meta = await readMeta(d);
  if (!meta) throw new Error('meta write lost');
  const snap = await buildSnapshot(meta);
  let post: Post | null = null;
  try {
    post = await reddit.submitCustomPost({
      title: postTitle(n, built.motifName),
      entry: 'default',
      postData: postDataOf(snap),
      textFallback: { text: textFallback(snap) },
    });
    await rx.hSet(K.meta(d), { [M.postId]: post.id, [M.previewS]: `0:${snap.stitchedTotal}` });
    await rx.hSet(K.posts, { [post.id]: d });
    await rx.hSet(K.days, { [d]: post.id });
  } catch (error) {
    if (post) {
      await rx.hDel(K.posts, [post.id]).catch(() => undefined);
      // The post exists without its Day_Key mapping: remove it so no post is left without data (Decision D45).
      await post.delete().catch((e: unknown) => console.warn('orphan post delete failed', d, reason(e)));
    }
    throw error;
  }
  try {
    await ensureStickyComment(d);
  } catch (error) {
    console.warn('sticky comment failed; tick retries', d, reason(error));
  }
}

/**
 * The daily Scheduler sequence (design.md "daily Scheduler run with retries"). One run creates the post under
 * a 45 s claim; a failed attempt leaves no post and no Tile data. Install and moderator runs skip the window
 * and the attempt limit (Decision D21).
 */
export async function ensureDailyPost(d: DayKey, origin: DailyOrigin, nowMs: number): Promise<DailyOutcome> {
  if ((await rx.hGet(K.days, d)) !== undefined) return 'exists';
  const start = await effectiveStartDate(nowMs);
  if (dayOrdinal(d) < dayOrdinal(start)) return 'before-start';
  const automatic = origin === 'cron' || origin === 'tick';
  if (automatic && nowMs - dayStartMs(d) >= CREATION_WINDOW_MS) return 'window-closed';
  const token = await claim(K.postClaim(d), CLAIM_SECONDS);
  if (!token) return 'in-progress';
  try {
    if ((await rx.hGet(K.days, d)) !== undefined) return 'exists';
    if (automatic && (await rx.hIncrBy(K.postAttempts, d, 1)) > MAX_ATTEMPTS) return 'attempts-exhausted';
    try {
      await createPost(d, start);
      return 'created';
    } catch (error) {
      console.warn('daily post attempt failed', d, origin, reason(error));
      await cleanup(d).catch((e: unknown) => console.warn('daily post cleanup failed', d, reason(e)));
      return 'failed';
    }
  } finally {
    await release(K.postClaim(d), token).catch(() => undefined);
  }
}

/** Completion repair: a Stitch whose process stopped before writing `g{g}:done` (design.md Data Models (c)). */
async function repairCompletion(d: DayKey, nowMs: number): Promise<void> {
  const meta = await readMeta(d);
  if (!meta || meta.completeAtMs !== null) return;
  if ((await rx.hLen(K.first(d, meta.activeGen))) >= 64) await rx.hSetNX(K.meta(d), M.done(meta.activeGen), String(nowMs));
}

async function step(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.warn(`tick ${label} failed`, reason(error));
  }
}

/** Every 30 s: creation retries in the window, next-day pre-build, preview and realtime catch-up, repairs. */
export async function runTick(nowMs: number): Promise<void> {
  const today = dayKeyFromMs(nowMs);
  if (nowMs - dayStartMs(today) < CREATION_WINDOW_MS) await step('creation', () => ensureDailyPost(today, 'tick', nowMs));
  await step('dirty', async () => {
    const dirty = await rx.hGetAll(K.dirty);
    for (const [key, at] of Object.entries(dirty)) {
      const d = parseDayKey(key);
      if (!d) continue;
      await refreshPreview(d);
      await sendSnapshot(d);
      await step('completion', () => repairCompletion(d, nowMs));
      // Only remove the entry if no newer Stitch marked it meanwhile; a newer mark waits for the next tick.
      if ((await rx.hGet(K.dirty, key)) === at) await rx.hDel(K.dirty, [key]);
    }
  });
  await step('sticky', async () => {
    const meta = await readMeta(today);
    if (!meta?.postId || meta.stickyCommentId) return;
    const token = await claim(K.postClaim(today), CLAIM_SECONDS);
    if (!token) return;
    try {
      await ensureStickyComment(today);
    } finally {
      await release(K.postClaim(today), token).catch(() => undefined);
    }
  });
  await step('prebuild', () => prebuildNextDay(nowMs));
}

export async function onInstall(nowMs: number): Promise<DailyOutcome> {
  await recordInstallDate(nowMs);
  return ensureDailyPost(dayKeyFromMs(nowMs), 'install', nowMs);
}
