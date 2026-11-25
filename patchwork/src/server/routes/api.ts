import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { context } from '@devvit/web/server';
import type {
  ApiError,
  AssignResponse,
  EndCardResponse,
  ErrorCode,
  ExtraResponse,
  FlairResponse,
  GhostSeenResponse,
  ShareResponse,
  SubmitResponse,
} from '../../shared/api';
import type { DayKey } from '../../shared/daykey';
import type { MosaicSnapshot } from '../../shared/wire';
import { assignExtra, assignForOpen } from '../core/assign';
import { resolvePostDay } from '../core/day';
import { readEndCard } from '../core/endcard';
import { setFlairOptIn } from '../core/flair';
import { K } from '../core/keys';
import { reviewHint } from '../core/mod';
import { cachedSnapshot } from '../core/preview';
import { rx } from '../core/redisx';
import { isNonce, shareResult } from '../core/share';
import { commitStitch } from '../core/stitch';
import { validateSubmission } from '../core/validate';

/** HTTP status and `retry` per code (design.md "Server error codes"). */
const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  AUTH_REQUIRED: 401,
  NOT_A_PATCHWORK_POST: 404,
  DAY_NOT_READY: 409,
  DAY_MISMATCH: 409,
  MOSAIC_CHANGED: 409,
  TILE_NOT_ASSIGNED: 403,
  INVALID_GRID: 400,
  STITCH_NOT_SAVED: 503,
  ASSIGN_FAILED: 503,
  SCORED_FIRST: 409,
  NO_RESULT: 409,
  SHARE_FAILED: 503,
  STREAK_REQUIRED: 403,
  UGC_INVALID: 400,
  UGC_UNSOLVABLE: 400,
  VOTE_CLOSED: 409,
  ALREADY_VOTED: 409,
  NOT_IN_VOTE: 404,
  NOT_COMPLETE: 409,
  CREDITS_FAILED: 503,
  MOD_REQUIRED: 403,
  ALREADY_REVIEWED: 409,
  UGC_NOT_FOUND: 404,
  MOSAIC_UNAVAILABLE: 503,
  UNAVAILABLE: 503,
};

const RETRY = new Set<ErrorCode>(['DAY_NOT_READY', 'STITCH_NOT_SAVED', 'ASSIGN_FAILED', 'SHARE_FAILED', 'CREDITS_FAILED', 'MOSAIC_UNAVAILABLE', 'UNAVAILABLE']);

function fail(c: Context, code: ErrorCode, message: string, extra?: { readonly tileIndex?: number }): Response {
  const body: ApiError = { ok: false, code, message, retry: RETRY.has(code), ...extra };
  return c.json(body, STATUS[code]);
}

function ok<T extends object>(c: Context, body: T): Response {
  return c.json({ ok: true as const, ...body });
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** Logged once per handled failure with route, code and Day_Key; never a user id or grid (Req 24.6). */
function logged(c: Context, route: string, code: ErrorCode, d: DayKey | null, error: unknown): Response {
  console.warn(`${route} ${code}`, d ?? '-', reason(error));
  return fail(c, code, `${route} failed`);
}

async function readBody(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return null;
  }
}

export const apiRoutes = new Hono();

apiRoutes.post('/assign', async (c) => {
  let d: DayKey | null = null;
  try {
    d = await resolvePostDay(context.postId);
    if (!d) return fail(c, 'NOT_A_PATCHWORK_POST', 'post has no Day_Key');
    const nowMs = Date.now();
    const res = await assignForOpen(context.userId, d, nowMs);
    if (res.kind === 'not-ready') return fail(c, 'DAY_NOT_READY', 'no active generation');
    const showReview = context.userId ? await reviewHint(context.username) : false;
    if (res.kind === 'scored-done') {
      return ok<AssignResponse>(c, { kind: 'scored-done', tileIndex: res.tileIndex, gen: res.gen, showReview });
    }
    return ok<AssignResponse>(c, {
      kind: res.kind,
      tile: res.tile,
      dayKey: d,
      dayNumber: res.dayNumber,
      assignedAtMs: res.assignedAtMs,
      serverNowMs: Date.now(),
      firstInteraction: res.firstInteraction,
      showGhost: res.showGhost,
      showReview,
    });
  } catch (error) {
    return logged(c, 'assign', 'ASSIGN_FAILED', d, error);
  }
});

apiRoutes.post('/extra', async (c) => {
  const userId = context.userId;
  if (!userId) return fail(c, 'AUTH_REQUIRED', 'login required');
  let d: DayKey | null = null;
  try {
    d = await resolvePostDay(context.postId);
    if (!d) return fail(c, 'NOT_A_PATCHWORK_POST', 'post has no Day_Key');
    const res = await assignExtra(userId, d, Date.now());
    switch (res.kind) {
      case 'not-ready':
        return fail(c, 'DAY_NOT_READY', 'no active generation');
      case 'scored-first':
        return fail(c, 'SCORED_FIRST', 'scored tile not stitched', res.tileIndex === null ? {} : { tileIndex: res.tileIndex });
      case 'complete':
        return ok<ExtraResponse>(c, { kind: 'complete' });
      default:
        return ok<ExtraResponse>(c, {
          kind: res.kind,
          tile: res.tile,
          dayKey: d,
          dayNumber: res.dayNumber,
          assignedAtMs: res.assignedAtMs,
          serverNowMs: Date.now(),
        });
    }
  } catch (error) {
    return logged(c, 'extra', 'ASSIGN_FAILED', d, error);
  }
});

apiRoutes.post('/submit', async (c) => {
  const userId = context.userId;
  // Checked before any read, so an anonymous submission writes nothing (Req 11.11).
  if (!userId) return fail(c, 'AUTH_REQUIRED', 'login required');
  const body = await readBody(c);
  let d: DayKey | null = null;
  try {
    d = await resolvePostDay(context.postId);
    const v = await validateSubmission(userId, d, body);
    if (v.status === 'error') return fail(c, v.code, 'submission refused');
    if (v.status === 'rejected') return ok<SubmitResponse>(c, { result: 'rejected' });
    const s = await commitStitch(userId, v, Date.now());
    if (s.status === 'not-saved') return fail(c, 'STITCH_NOT_SAVED', 'stitch not saved');
    const kind = v.role === 'already-stitched' ? (s.score ? 'scored' : 'extra') : v.role;
    return ok<SubmitResponse>(c, {
      result: 'accepted',
      kind,
      solveCount: s.solveCount,
      tilePixels: v.tile.pixels,
      solutionMask: v.tile.solutionHex,
      score: s.score,
      scoreNote: s.scoreNote,
      returnNextDay: s.returnNextDay,
      alreadyStitched: s.status === 'already-stitched',
    });
  } catch (error) {
    return logged(c, 'submit', 'STITCH_NOT_SAVED', d, error);
  }
});

apiRoutes.get('/mosaic', async (c) => {
  let d: DayKey | null = null;
  try {
    d = await resolvePostDay(context.postId);
    if (!d) return fail(c, 'NOT_A_PATCHWORK_POST', 'post has no Day_Key');
    return ok<MosaicSnapshot>(c, await cachedSnapshot(d));
  } catch (error) {
    return logged(c, 'mosaic', 'MOSAIC_UNAVAILABLE', d, error);
  }
});

apiRoutes.get('/endcard', async (c) => {
  const userId = context.userId;
  if (!userId) return fail(c, 'AUTH_REQUIRED', 'login required');
  let d: DayKey | null = null;
  try {
    d = await resolvePostDay(context.postId);
    if (!d) return fail(c, 'NOT_A_PATCHWORK_POST', 'post has no Day_Key');
    const card = await readEndCard(userId, d, Date.now());
    if (!card) return fail(c, 'NO_RESULT', 'no stitched scored attempt');
    return ok<EndCardResponse>(c, card);
  } catch (error) {
    return logged(c, 'endcard', 'UNAVAILABLE', d, error);
  }
});

apiRoutes.post('/share', async (c) => {
  const userId = context.userId;
  if (!userId) return fail(c, 'AUTH_REQUIRED', 'login required');
  const body = await readBody(c);
  const nonce = typeof body === 'object' && body !== null ? (body as { nonce?: unknown }).nonce : undefined;
  if (!isNonce(nonce)) return fail(c, 'SHARE_FAILED', 'invalid nonce');
  let d: DayKey | null = null;
  try {
    d = await resolvePostDay(context.postId);
    if (!d) return fail(c, 'NOT_A_PATCHWORK_POST', 'post has no Day_Key');
    const res = await shareResult(userId, d, nonce);
    if ('code' in res) return fail(c, res.code, 'share refused');
    return ok<ShareResponse>(c, { commentId: res.commentId });
  } catch (error) {
    return logged(c, 'share', 'SHARE_FAILED', d, error);
  }
});

apiRoutes.post('/flair', async (c) => {
  const userId = context.userId;
  if (!userId) return fail(c, 'AUTH_REQUIRED', 'login required');
  const body = await readBody(c);
  const optIn = typeof body === 'object' && body !== null && (body as { optIn?: unknown }).optIn === true;
  try {
    await setFlairOptIn(userId, optIn);
    return ok<FlairResponse>(c, { optIn });
  } catch (error) {
    return logged(c, 'flair', 'UNAVAILABLE', null, error);
  }
});

apiRoutes.post('/ghost-seen', async (c) => {
  const userId = context.userId;
  if (!userId) return fail(c, 'AUTH_REQUIRED', 'login required');
  try {
    await rx.hSet(K.user(userId), { ghost: '1' });
    return ok<GhostSeenResponse>(c, {});
  } catch (error) {
    return logged(c, 'ghost-seen', 'UNAVAILABLE', null, error);
  }
});
