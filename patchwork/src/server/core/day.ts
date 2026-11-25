import { settings } from '@devvit/web/server';
import type { DayKey, TileSize } from '../../shared/daykey';
import { dayKeyFromMs, dayOrdinal, parseDayKey, tileSizeFor } from '../../shared/daykey';
import { K, M } from './keys';
import { intOr, rx } from './redisx';

export interface DayMeta {
  readonly dayKey: DayKey;
  readonly postId: string | null;
  readonly dayNumber: number;
  readonly tileSize: TileSize;
  readonly activeGen: number;
  readonly seed: number;
  readonly motifIndex: number;
  readonly motifName: string;
  readonly source: string;
  readonly completeAtMs: number | null;
  readonly stickyCommentId: string | null;
  readonly previewS: string | null;
}

/** Null when the meta hash or its active generation is missing (`DAY_NOT_READY`). */
export function parseMeta(d: DayKey, raw: Record<string, string>): DayMeta | null {
  const g = intOr(raw[M.activeGen], -1);
  if (g < 0) return null;
  const done = raw[M.done(g)];
  return {
    dayKey: d,
    postId: raw[M.postId] ?? null,
    dayNumber: intOr(raw[M.dayNumber], 0),
    tileSize: tileSizeFor(d),
    activeGen: g,
    seed: intOr(raw[M.seed(g)], 0),
    motifIndex: intOr(raw[M.motifIndex(g)], 0),
    motifName: raw[M.motif(g)] ?? '',
    source: raw[M.source(g)] ?? 'procedural',
    completeAtMs: done === undefined ? null : intOr(done, 0),
    stickyCommentId: raw[M.sticky] ?? null,
    previewS: raw[M.previewS] ?? null,
  };
}

export async function readMeta(d: DayKey): Promise<DayMeta | null> {
  return parseMeta(d, await rx.hGetAll(K.meta(d)));
}

/** The Day_Key recorded for a post, never one sent by the Client (Req 11.12, Req 31.6). */
export async function resolvePostDay(postId: string | undefined): Promise<DayKey | null> {
  if (!postId) return null;
  const value = await rx.hGet(K.posts, postId);
  return value === undefined ? null : parseDayKey(value);
}

/** Records the installation Day_Key once; later calls keep the first value. */
export async function recordInstallDate(nowMs: number): Promise<void> {
  await rx.hSetNX(K.install, 'date', dayKeyFromMs(nowMs));
}

/**
 * The `startDate` setting when it is a real Day_Key, otherwise the installation Day_Key (Req 22.6, Req 22.7).
 * A settings read error propagates: Day_Number goes into the post title, so it never falls back silently.
 */
export async function effectiveStartDate(nowMs: number): Promise<DayKey> {
  const setting = await settings.get<string>('startDate');
  const parsed = typeof setting === 'string' && setting.trim() !== '' ? parseDayKey(setting.trim()) : null;
  // A setting later than today is ignored, like a malformed one (Property 62).
  if (parsed && dayOrdinal(parsed) <= dayOrdinal(dayKeyFromMs(nowMs))) return parsed;
  await recordInstallDate(nowMs);
  const installed = parseDayKey((await rx.hGet(K.install, 'date')) ?? '');
  return installed ?? dayKeyFromMs(nowMs);
}
