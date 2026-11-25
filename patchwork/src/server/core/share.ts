import { reddit } from '@devvit/web/server';
import type { DayKey } from '../../shared/daykey';
import { buildEmojiGrid, composeShareComment } from '../../shared/emoji';
import { stitchedBy } from './assign';
import { readMeta } from './day';
import { F, K } from './keys';
import { freshSnapshot } from './preview';
import { intOr, rx } from './redisx';
import { parseResult } from './stitch';
import { readStreak } from './streak';

export type ShareOutcome = { readonly commentId: string } | { readonly code: 'NO_RESULT' | 'SHARE_FAILED' };

const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PENDING = '1';

export function isNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE_RE.test(value);
}

/**
 * "Share as comment" (Req 17.11 to Req 17.15): a reply to the post's stickied app comment, posted as the user
 * after an explicit tap. The nonce is claimed with `hSetNX`, so one tap posts at most one comment even when
 * the request is repeated (Decision D42).
 */
export async function shareResult(userId: string, d: DayKey, nonce: string): Promise<ShareOutcome> {
  const udKey = K.userDay(d, userId);
  const ud = await rx.hGetAll(udKey);
  if (ud[F.scoredDone] === undefined) return { code: 'NO_RESULT' };
  const meta = await readMeta(d);
  if (!meta?.stickyCommentId) return { code: 'SHARE_FAILED' };
  if ((await rx.hSetNX(udKey, F.share(nonce), PENDING)) !== 1) {
    const existing = await rx.hGet(udKey, F.share(nonce));
    return existing && existing !== PENDING ? { commentId: existing } : { code: 'SHARE_FAILED' };
  }
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return { code: 'SHARE_FAILED' };
    const result = parseResult(ud[F.result]);
    const [snap, streak] = await Promise.all([freshSnapshot(d), readStreak(userId)]);
    const grid = buildEmojiGrid({
      dayNumber: meta.dayNumber,
      tileSize: meta.tileSize,
      solveSeconds: result ? Math.round(result.solveMs / 1000) : null,
      parSeconds: result ? result.parSeconds : null,
      mistakes: result ? result.mistakes : null,
      mistakeAllowance: result ? result.mistakeAllowance : null,
      helpCount: intOr(ud[F.help], 0),
      streak: streak.current,
      stitchedMask: snap.stitchedMask,
      myTiles: [...stitchedBy(ud, meta.activeGen)],
    });
    const comment = await reddit.submitComment({
      id: meta.stickyCommentId as `t1_${string}`,
      text: composeShareComment(username, grid),
      runAs: 'USER',
    });
    await rx.hSet(udKey, { [F.share(nonce)]: comment.id }).catch(() => undefined);
    return { commentId: comment.id };
  } catch (error) {
    console.warn('share comment failed', d, error instanceof Error ? error.message : 'unknown error');
    return { code: 'SHARE_FAILED' };
  }
}
