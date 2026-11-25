import { cache, realtime, reddit } from '@devvit/web/server';
import type { JsonValue } from '@devvit/web/shared';
import type { DayKey } from '../../shared/daykey';
import type { MosaicSnapshot } from '../../shared/wire';
import { encodePostWire, packStitchedPixels, unpackTilePixels } from '../../shared/wire';
import type { DayMeta } from './day';
import { readMeta } from './day';
import { K, M } from './keys';
import { countsFrom, rx } from './redisx';
import { parseTileRecord } from './tilerec';

export class DayNotReady extends Error {
  constructor(d: DayKey) {
    super(`No active generation for ${d}`);
    this.name = 'DayNotReady';
  }
}

/** Stitched pixels only: an unstitched Tile shows up only as a 0 bit in the mask and a Solve_Count of 0 (Req 8.2, Req 18.9). */
export async function buildSnapshot(meta: DayMeta): Promise<MosaicSnapshot> {
  const d = meta.dayKey;
  const g = meta.activeGen;
  const solveCounts = countsFrom(await rx.hGetAll(K.solves(d, g)), 64);
  const stitched = solveCounts.some((c) => c > 0);
  const records = stitched ? await rx.hGetAll(K.tiles(d, g)) : {};
  const tiles: (Uint8Array | null)[] = solveCounts.map((count, t) => {
    if (count < 1) return null;
    const rec = parseTileRecord(records[String(t)], t, meta.tileSize);
    return rec ? unpackTilePixels(rec.pixels, meta.tileSize) : null;
  });
  const { mask, pixels } = packStitchedPixels(tiles, meta.tileSize);
  const stitchedTotal = tiles.filter((t) => t !== null).length;
  return {
    dayKey: d,
    dayNumber: meta.dayNumber,
    gen: g,
    tileSize: meta.tileSize,
    motifName: meta.motifName,
    stitchedTotal,
    stitchedMask: mask,
    solveCounts,
    pixels,
    complete: stitchedTotal === 64,
    completeAtMs: meta.completeAtMs,
    version: solveCounts.reduce((s, c) => s + c, 0),
  };
}

export async function freshSnapshot(d: DayKey): Promise<MosaicSnapshot> {
  const meta = await readMeta(d);
  if (!meta) throw new DayNotReady(d);
  return buildSnapshot(meta);
}

/** The same data for every viewer, so it goes through the cache helper with a 2 s TTL (F31, Req 18.4). */
export async function cachedSnapshot(d: DayKey): Promise<MosaicSnapshot> {
  // MosaicSnapshot holds only JSON values; the interface just lacks the index signature JsonValue needs.
  const snap = await cache(async () => (await freshSnapshot(d)) as unknown as JsonValue, { key: K.cacheSnapshot(d), ttl: 2 });
  return snap as unknown as MosaicSnapshot;
}

export function textFallback(snap: Pick<MosaicSnapshot, 'dayNumber' | 'stitchedTotal'>): string {
  return `**Day ${snap.dayNumber} · ${snap.stitchedTotal}/64 stitched**\n\nPatchwork plays in the Reddit app and on new Reddit.`;
}

export function postDataOf(snap: MosaicSnapshot): Record<string, string | number> {
  return { ...encodePostWire(snap) };
}

/**
 * Rewrites `postData` and the text fallback when the generation or Stitched_Total moved since the last push
 * (Req 8.5, Req 8.6). A failure leaves `previewS` unchanged, so the next `tick` tries again.
 */
export async function refreshPreview(d: DayKey): Promise<'updated' | 'unchanged' | 'failed'> {
  try {
    const meta = await readMeta(d);
    if (!meta?.postId) return 'failed';
    const snap = await buildSnapshot(meta);
    const marker = `${snap.gen}:${snap.stitchedTotal}`;
    if (meta.previewS === marker) return 'unchanged';
    const post = await reddit.getPostById(meta.postId as `t3_${string}`);
    await post.setPostData(postDataOf(snap));
    await post.setTextFallback({ text: textFallback(snap) });
    await rx.hSet(K.meta(d), { [M.previewS]: marker });
    return 'updated';
  } catch (error) {
    console.warn('preview update failed', d, error instanceof Error ? error.message : 'unknown error');
    return 'failed';
  }
}

export function channelFor(d: DayKey): string {
  return `pw-${d}`;
}

export function realtimeMessage(snap: MosaicSnapshot): Record<string, string | number | boolean | number[]> {
  return {
    t: 'mosaic',
    d: snap.dayKey,
    g: snap.gen,
    v: snap.version,
    s: snap.stitchedTotal,
    k: snap.stitchedMask,
    p: snap.pixels,
    n: [...snap.solveCounts],
    c: snap.complete,
  };
}

export async function sendSnapshot(d: DayKey): Promise<void> {
  try {
    await realtime.send(channelFor(d), realtimeMessage(await freshSnapshot(d)));
  } catch (error) {
    console.warn('realtime send failed', d, error instanceof Error ? error.message : 'unknown error');
  }
}

export const REALTIME_WINDOW_MS = 500;

/** At most one message per Day_Key channel per 500 ms window: only the first Stitch of a window sends (B10). */
export async function broadcastAfterStitch(d: DayKey, nowMs: number): Promise<void> {
  try {
    const key = K.rt(d, Math.floor(nowMs / REALTIME_WINDOW_MS));
    if ((await rx.incrBy(key, 1)) !== 1) return;
    await rx.expire(key, 5);
  } catch (error) {
    console.warn('realtime window failed', d, error instanceof Error ? error.message : 'unknown error');
    return;
  }
  await sendSnapshot(d);
}
