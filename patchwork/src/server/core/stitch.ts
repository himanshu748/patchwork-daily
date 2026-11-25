import type { ResultWire, ScoreNote } from '../../shared/api';
import type { DayKey } from '../../shared/daykey';
import { dayEndMs, dayOrdinal, dayStartMs } from '../../shared/daykey';
import { computeScore, solveMsFrom } from '../../shared/score';
import type { StreakState } from '../../shared/streak';
import { computeStreak, playedPreviousDay } from '../../shared/streak';
import { bucketFor } from '../../shared/timedist';
import { parseHeld, parseScoredDone } from './assign';
import { applyFlairAfterStreak } from './flair';
import { F, K, M, RETENTION_SECONDS } from './keys';
import { broadcastAfterStitch } from './preview';
import { intOr, rx, withTimeout } from './redisx';
import { readDays } from './streak';
import type { ValidationOutcome } from './validate';

interface Saved {
  readonly solveCount: number;
  readonly stitchedTotal: number | null;
  readonly score: ResultWire | null;
  readonly scoreNote: ScoreNote;
  readonly returnNextDay: boolean;
  readonly streak: StreakState | null;
}

export type StitchOutcome =
  | (Saved & { readonly status: 'recorded' })
  | (Saved & { readonly status: 'already-stitched' })
  | { readonly status: 'not-saved' };

type Accepted = Extract<ValidationOutcome, { status: 'accepted' }>;

export function parseResult(json: string | undefined): ResultWire | null {
  if (json === undefined) return null;
  try {
    const v = JSON.parse(json) as ResultWire;
    return typeof v.score === 'number' && typeof v.solveMs === 'number' ? v : null;
  } catch {
    return null;
  }
}

const HELP_UNIT = 1_000_000;
const FLAIR_BUDGET_MS = 2000;

/** Top-helper tie part: 999,999 minus whole seconds from the Day_Key start to the first Stitch (Req 19.3). */
export function tiePart(d: DayKey, nowMs: number): number {
  return 999_999 - Math.min(999_999, Math.max(0, Math.floor((nowMs - dayStartMs(d)) / 1000)));
}

type SavedOutcome = Exclude<StitchOutcome, { status: 'not-saved' }>;
type Attempt = { readonly kind: 'done'; readonly outcome: SavedOutcome } | { readonly kind: 'aborted' };

async function alreadyStitched(d: DayKey, g: number, t: number, ud: Record<string, string>): Promise<SavedOutcome> {
  const solveCount = intOr(await rx.hGet(K.solves(d, g), String(t)), 1);
  const done = parseScoredDone(ud[F.scoredDone]);
  const score = done && done.g === g && done.t === t ? parseResult(ud[F.result]) : null;
  return { status: 'already-stitched', solveCount, stitchedTotal: null, score, scoreNote: 'ok', returnNextDay: false, streak: null };
}

/** C1 to C6: one transaction watching only this user's user-day hash. */
async function attempt(userId: string, v: Accepted, nowMs: number): Promise<Attempt> {
  const d = v.meta.dayKey;
  const g = v.meta.activeGen;
  const t = v.tile.index;
  const udKey = K.userDay(d, userId);
  const tx = await rx.watch(udKey);
  let open = true;
  try {
    const ud = await rx.hGetAll(udKey);
    if (ud[F.stitched(g, t)] !== undefined) {
      await withTimeout(tx.unwatch());
      open = false;
      return { kind: 'done', outcome: await alreadyStitched(d, g, t, ud) };
    }
    const scoredTile = v.role === 'scored' && ud[F.scoredDone] === undefined;
    const held = parseHeld(ud[F.scored(g)]);
    const isPast = nowMs >= dayEndMs(d);
    const scoreable = scoredTile && ud[F.result] === undefined && !isPast && held !== null && v.tile.parSeconds !== null;
    const helpBefore = intOr(ud[F.help], 0);
    let result: ResultWire | null = null;
    if (scoreable && held && v.tile.parSeconds !== null) {
      const solveMs = solveMsFrom(held.at, nowMs);
      const mistakes = intOr(ud[F.mistakes(g)], 0);
      result = {
        score: computeScore({ solveMs, mistakes, parSeconds: v.tile.parSeconds }),
        solveMs,
        mistakes,
        parSeconds: v.tile.parSeconds,
        mistakeAllowance: v.tile.mistakeAllowance,
        tileIndex: t,
        gen: g,
        tileSize: v.meta.tileSize,
        bucket: bucketFor(solveMs, v.tile.parSeconds),
      };
    }
    const scoreNote: ScoreNote = !scoredTile || result ? 'ok' : isPast ? 'day-ended' : 'unavailable';

    const fields: Record<string, string> = { [F.stitched(g, t)]: '1' };
    if (scoredTile) fields[F.scoredDone] = JSON.stringify(result ? { g, t } : { g, t, n: scoreNote });
    if (helpBefore === 0) fields[F.firstStitchAt] = String(nowMs);
    if (result) fields[F.result] = JSON.stringify(result);

    // Queued one at a time: exec returns results in queue order, which the solves index below relies on.
    const queue: (() => Promise<unknown>)[] = [];
    queue.push(() => tx.hSet(udKey, fields));
    queue.push(() => tx.hIncrBy(udKey, F.help, 1));
    const solvesAt = queue.length;
    queue.push(() => tx.hIncrBy(K.solves(d, g), String(t), 1));
    queue.push(() => tx.hSetNX(K.first(d, g), String(t), userId));
    queue.push(() => tx.zIncrBy(K.helpers(d), userId, helpBefore === 0 ? HELP_UNIT + tiePart(d, nowMs) : HELP_UNIT));
    if (helpBefore === 0) queue.push(() => tx.expire(K.helpers(d), RETENTION_SECONDS));
    if (result) {
      const scored = result;
      queue.push(() => tx.zAdd(K.lb(d), { member: userId, score: scored.score }));
      queue.push(() => tx.expire(K.lb(d), RETENTION_SECONDS));
      queue.push(() => tx.hIncrBy(K.timedist, String(scored.bucket), 1));
      queue.push(() => tx.zAdd(K.userDays(userId), { member: d, score: dayOrdinal(d) }));
    }
    await withTimeout(tx.multi());
    for (const command of queue) await withTimeout(command());
    const res: unknown = await withTimeout(tx.exec());
    open = false;
    // The docs return null when the watched hash changed; a short array is treated the same way.
    if (!Array.isArray(res) || res.length !== queue.length) return { kind: 'aborted' };
    const solveCount = Number(res[solvesAt]);
    return {
      kind: 'done',
      outcome: {
        status: 'recorded',
        solveCount: Number.isFinite(solveCount) ? solveCount : 1,
        stitchedTotal: null,
        score: result,
        scoreNote,
        returnNextDay: false,
        streak: null,
      },
    };
  } finally {
    if (open) await withTimeout(tx.discard()).catch(() => undefined);
  }
}

/**
 * Stitch commit (design.md Data Models (c)). One transaction per accepted Stitch writes `st:{g}:{t}` together
 * with every counter, so a repeated or concurrent submission of the same Tile by the same user is recorded
 * once (Req 11.10). Different users watch different keys and never abort each other (Req 12.7).
 */
export async function commitStitch(userId: string, v: Accepted, nowMs: number): Promise<StitchOutcome> {
  let done: SavedOutcome | null = null;
  try {
    for (let i = 0; i < 2 && !done; i++) {
      const a = await attempt(userId, v, nowMs);
      if (a.kind === 'done') done = a.outcome;
    }
  } catch (error) {
    console.warn('stitch not saved', v.meta.dayKey, v.meta.activeGen, error instanceof Error ? error.message : 'unknown error');
    return { status: 'not-saved' };
  }
  if (!done) {
    console.warn('stitch not saved: transaction aborted twice', v.meta.dayKey, v.meta.activeGen);
    return { status: 'not-saved' };
  }
  if (done.status === 'already-stitched') return done;
  return afterCommit(userId, v, nowMs, done);
}

/** C7: never turns a saved Stitch into an error; each step fails on its own (design.md Error Handling). */
async function afterCommit(userId: string, v: Accepted, nowMs: number, saved: Extract<StitchOutcome, { status: 'recorded' }>): Promise<StitchOutcome> {
  const d = v.meta.dayKey;
  const g = v.meta.activeGen;
  let stitchedTotal: number | null = null;
  try {
    stitchedTotal = await rx.hLen(K.first(d, g));
    if (stitchedTotal >= 64) await rx.hSetNX(K.meta(d), M.done(g), String(nowMs));
  } catch (error) {
    console.warn('stitched total read failed', d, g, error instanceof Error ? error.message : 'unknown error');
  }
  await rx.hSet(K.dirty, { [d]: String(nowMs) }).catch((error: unknown) => {
    console.warn('dirty mark failed', d, error instanceof Error ? error.message : 'unknown error');
  });
  await broadcastAfterStitch(d, nowMs);
  let streak: StreakState | null = null;
  let returnNextDay = false;
  if (saved.score) {
    try {
      const days = await readDays(userId);
      streak = computeStreak(days);
      returnNextDay = playedPreviousDay(days, d);
    } catch (error) {
      console.warn('streak read failed', d, error instanceof Error ? error.message : 'unknown error');
    }
    if (streak) {
      await withTimeout(applyFlairAfterStreak(userId, streak), FLAIR_BUDGET_MS).catch((error: unknown) => {
        console.warn('flair skipped', error instanceof Error ? error.message : 'unknown error');
      });
    }
  }
  return { ...saved, stitchedTotal, streak, returnNextDay };
}
