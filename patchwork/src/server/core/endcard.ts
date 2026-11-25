import type { EndCardResponse, ScoreNote } from '../../shared/api';
import type { DayKey } from '../../shared/daykey';
import { dayEndMs, dayKeyFromMs } from '../../shared/daykey';
import { parseScoredDone, stitchedBy } from './assign';
import { readMeta } from './day';
import { F, K } from './keys';
import { readPercentile, sharedRank } from './leaderboard';
import { intOr, rx, withTimeout } from './redisx';
import { parseResult } from './stitch';
import { readStreak } from './streak';

/** Rank and percentile share the 3 s budget of Req 14.7. */
export const RANKING_BUDGET_MS = 3000;
/** The Pixel_Editor unlocks at a 7-day streak (Req 20.1). */
export const EDITOR_STREAK = 7;

function noteFrom(json: string | undefined): ScoreNote {
  if (json === undefined) return 'unavailable';
  try {
    const v = JSON.parse(json) as { n?: unknown };
    return v.n === 'day-ended' ? 'day-ended' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * The End_Card data. Each part has its own failure path, so one unreadable part shows "Unavailable" while
 * the rest of the card stays usable (Req 2.4, Req 14.7, Req 17.4). Null means `NO_RESULT`.
 */
export async function readEndCard(userId: string, d: DayKey, nowMs: number): Promise<EndCardResponse | null> {
  const ud = await rx.hGetAll(K.userDay(d, userId));
  if (!parseScoredDone(ud[F.scoredDone])) return null;
  const result = parseResult(ud[F.result]);
  const scoreNote: ScoreNote = result ? 'ok' : noteFrom(ud[F.scoredDone]);

  const rankRead = result
    ? withTimeout(sharedRank(d, userId), RANKING_BUDGET_MS).catch(() => null)
    : Promise.resolve(null);
  const percentileRead = result
    ? withTimeout(readPercentile(result.bucket), RANKING_BUDGET_MS).catch(() => null)
    : Promise.resolve(null);
  const [rank, percentile, streak, meta, prefs] = await Promise.all([
    rankRead,
    percentileRead,
    readStreak(userId).catch(() => null),
    readMeta(d).catch(() => null),
    rx.hGetAll(K.user(userId)).catch(() => null),
  ]);
  let complete = false;
  if (meta) complete = await rx.hLen(K.first(d, meta.activeGen)).then((n) => n >= 64, () => false);

  return {
    result,
    scoreNote,
    rank: rank ? { status: 'ok', position: rank.position, total: rank.total } : { status: 'unavailable' },
    percentile:
      percentile === null || !result
        ? { status: 'unavailable' }
        : percentile.status === 'ok'
          ? { status: 'ok', value: percentile.value, bucket: result.bucket, counts: percentile.counts }
          : { status: 'too-few' },
    helpCount: ud[F.help] === undefined ? null : intOr(ud[F.help], 0),
    streak: streak ? { current: streak.current, best: streak.best } : null,
    myTiles: meta ? [...stitchedBy(ud, meta.activeGen)].sort((a, b) => a - b) : [],
    serverNowMs: nowMs,
    nextDayAtMs: dayEndMs(dayKeyFromMs(nowMs)),
    flairOptIn: prefs?.flair === '1',
    editorUnlocked: (streak?.current ?? 0) >= EDITOR_STREAK,
    complete,
    voteOpen: false,
  };
}
