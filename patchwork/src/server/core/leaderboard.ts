import type { DayKey } from '../../shared/daykey';
import { PERCENTILE_MIN_ENTRIES, TIME_BUCKETS, percentileFor } from '../../shared/timedist';
import { K } from './keys';
import { countsFrom, rx } from './redisx';

/**
 * Shared rank with ties (Req 14.5, design.md Data Models (f)): position = total - ascending rank of the last
 * member at the user's score. 4 commands, no scan.
 */
export async function sharedRank(d: DayKey, userId: string): Promise<{ readonly position: number; readonly total: number } | null> {
  const key = K.lb(d);
  const score = await rx.zScore(key, userId);
  if (score === undefined || score === null) return null;
  const last = await rx.zRange(key, score, score, { by: 'score', reverse: true, limit: { offset: 0, count: 1 } });
  const member = last[0]?.member;
  if (member === undefined) return null;
  const rank = await rx.zRank(key, member);
  if (rank === undefined || rank === null) return null;
  const total = await rx.zCard(key);
  return { position: total - rank, total };
}

export type PercentileRead =
  | { readonly status: 'ok'; readonly value: number; readonly counts: readonly number[] }
  | { readonly status: 'too-few' };

/** Hidden below 10 Scored_Attempts (Req 2.7, Req 14.6). */
export async function readPercentile(userBucket: number): Promise<PercentileRead> {
  const counts = countsFrom(await rx.hGetAll(K.timedist), TIME_BUCKETS);
  const total = counts.reduce((s, c) => s + c, 0);
  if (total < PERCENTILE_MIN_ENTRIES) return { status: 'too-few' };
  const value = percentileFor(counts, userBucket);
  return value === null ? { status: 'too-few' } : { status: 'ok', value, counts };
}
