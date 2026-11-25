import type { TileWire } from '../../shared/api';
import { candidateFrom, pickTile } from '../../shared/assignment';
import type { DayKey } from '../../shared/daykey';
import { dayEndMs } from '../../shared/daykey';
import type { DayMeta } from './day';
import { readMeta } from './day';
import { ensureTiles } from './generation';
import { F, K, RETENTION_SECONDS } from './keys';
import { countsFrom, intOr, rx } from './redisx';
import type { StoredTile } from './tilerec';
import { parseTileRecord, tileWire } from './tilerec';

export type AssignResult =
  | {
      readonly kind: 'scored' | 'late' | 'practice';
      readonly tile: TileWire;
      readonly assignedAtMs: number;
      readonly dayNumber: number;
      readonly firstInteraction: boolean;
      readonly showGhost: boolean;
    }
  | { readonly kind: 'scored-done'; readonly tileIndex: number; readonly gen: number }
  | { readonly kind: 'not-ready' };

export type ExtraResult =
  | { readonly kind: 'extra' | 'late'; readonly tile: TileWire; readonly assignedAtMs: number; readonly dayNumber: number }
  | { readonly kind: 'complete' }
  | { readonly kind: 'scored-first'; readonly tileIndex: number | null }
  | { readonly kind: 'not-ready' };

export interface Held {
  readonly t: number;
  readonly at: number;
  readonly k?: 'extra' | 'late';
}

export function parseHeld(json: string | undefined): Held | null {
  if (json === undefined) return null;
  try {
    const v = JSON.parse(json) as Partial<Held>;
    if (!Number.isInteger(v.t) || (v.t as number) < 0 || (v.t as number) > 63 || typeof v.at !== 'number') return null;
    return v.k === 'extra' || v.k === 'late' ? { t: v.t as number, at: v.at, k: v.k } : { t: v.t as number, at: v.at };
  } catch {
    return null;
  }
}

export function parseScoredDone(json: string | undefined): { readonly g: number; readonly t: number } | null {
  if (json === undefined) return null;
  try {
    const v = JSON.parse(json) as { g?: unknown; t?: unknown };
    return Number.isInteger(v.g) && Number.isInteger(v.t) ? { g: v.g as number, t: v.t as number } : null;
  } catch {
    return null;
  }
}

/** Reads Tile t of the active generation, storing the generation first if its Tiles are missing (Req 27.7). */
export async function readTile(meta: DayMeta, t: number): Promise<StoredTile> {
  const key = K.tiles(meta.dayKey, meta.activeGen);
  let rec = parseTileRecord(await rx.hGet(key, String(t)), t, meta.tileSize);
  if (!rec) {
    await ensureTiles(meta.dayKey, meta.activeGen, { seed: meta.seed, motifIndex: meta.motifIndex });
    rec = parseTileRecord(await rx.hGet(key, String(t)), t, meta.tileSize);
  }
  if (!rec) throw new Error(`Tile ${t} of ${meta.dayKey} generation ${meta.activeGen} is unavailable`);
  return rec;
}

export function stitchedBy(ud: Record<string, string>, g: number): Set<number> {
  const out = new Set<number>();
  const prefix = `st:${g}:`;
  for (const field of Object.keys(ud)) {
    if (!field.startsWith(prefix)) continue;
    const t = Number(field.slice(prefix.length));
    if (Number.isInteger(t) && t >= 0 && t < 64) out.add(t);
  }
  return out;
}

/**
 * Open the post (design.md Data Models (b)). The only shared write is `incrBy` on the Assignment_Counter;
 * everything else goes to the caller's own user-day hash, so concurrent users never conflict (Req 9.7, Req 27.4).
 */
export async function assignForOpen(userId: string | undefined, d: DayKey, nowMs: number): Promise<AssignResult> {
  const meta = await readMeta(d);
  if (!meta) return { kind: 'not-ready' };
  const g = meta.activeGen;

  if (!userId) {
    // Practice (Decision D11): read-only, the counter is not incremented and nothing is written.
    const c = intOr(await rx.get(K.ctr(d, g)), 0);
    const solves = countsFrom(await rx.hGetAll(K.solves(d, g)), 64);
    const t = pickTile(solves, candidateFrom(c + 1)) ?? 0;
    const tile = await readTile(meta, t);
    return { kind: 'practice', tile: tileWire(tile, g), assignedAtMs: nowMs, dayNumber: meta.dayNumber, firstInteraction: false, showGhost: false };
  }

  const udKey = K.userDay(d, userId);
  const ud = await rx.hGetAll(udKey);
  const ghostSeen = (await rx.hGet(K.user(userId), 'ghost')) !== undefined;
  const firstInteraction = ud[F.firstInteraction] === undefined ? (await rx.hSetNX(udKey, F.firstInteraction, '1')) === 1 : false;
  const base = { dayNumber: meta.dayNumber, firstInteraction, showGhost: !ghostSeen };

  const done = parseScoredDone(ud[F.scoredDone]);
  if (done) return { kind: 'scored-done', tileIndex: done.t, gen: done.g };

  const held = parseHeld(ud[F.scored(g)]);
  if (held) {
    const tile = await readTile(meta, held.t);
    return { kind: 'scored', tile: tileWire(tile, g), assignedAtMs: held.at, ...base };
  }

  const isPast = nowMs >= dayEndMs(d);
  const late = parseHeld(ud[F.extra(g)]);
  if (isPast && late && ud[F.stitched(g, late.t)] === undefined) {
    const tile = await readTile(meta, late.t);
    return { kind: 'late', tile: tileWire(tile, g), assignedAtMs: late.at, ...base };
  }

  const c = await rx.incrBy(K.ctr(d, g), 1);
  const solves = countsFrom(await rx.hGetAll(K.solves(d, g)), 64);
  let t = pickTile(solves, candidateFrom(c)) ?? 0;
  let at = nowMs;
  if (!isPast) {
    const won = await rx.hSetNX(udKey, F.scored(g), JSON.stringify({ t, at }));
    if (won === 1) await rx.expire(udKey, RETENTION_SECONDS);
    else {
      // A parallel request of the same user recorded the Scored_Attempt first; return that one.
      const winner = parseHeld(await rx.hGet(udKey, F.scored(g)));
      if (!winner) throw new Error('Scored_Attempt record unreadable');
      t = winner.t;
      at = winner.at;
    }
  } else {
    await rx.hSet(udKey, { [F.extra(g)]: JSON.stringify({ t, at, k: 'late' }) });
    await rx.expire(udKey, RETENTION_SECONDS);
  }
  const tile = await readTile(meta, t);
  return { kind: isPast ? 'late' : 'scored', tile: tileWire(tile, g), assignedAtMs: at, ...base };
}

/** "Help another tile": the least-solved Tile this user has not stitched in the active generation (Req 9.5, Req 9.6). */
export async function assignExtra(userId: string, d: DayKey, nowMs: number): Promise<ExtraResult> {
  const meta = await readMeta(d);
  if (!meta) return { kind: 'not-ready' };
  const g = meta.activeGen;
  const udKey = K.userDay(d, userId);
  const ud = await rx.hGetAll(udKey);
  const isPast = nowMs >= dayEndMs(d);
  if (!isPast && ud[F.scoredDone] === undefined) {
    return { kind: 'scored-first', tileIndex: parseHeld(ud[F.scored(g)])?.t ?? null };
  }
  const stitched = stitchedBy(ud, g);
  if (stitched.size >= 64) return { kind: 'complete' };
  const c = await rx.incrBy(K.ctr(d, g), 1);
  const solves = countsFrom(await rx.hGetAll(K.solves(d, g)), 64);
  const t = pickTile(solves, candidateFrom(c), (x) => stitched.has(x));
  if (t === null) return { kind: 'complete' };
  const kind = isPast ? 'late' : 'extra';
  await rx.hSet(udKey, { [F.extra(g)]: JSON.stringify({ t, at: nowMs, k: kind }) });
  if (ud[F.scored(g)] === undefined && ud[F.scoredDone] === undefined) await rx.expire(udKey, RETENTION_SECONDS);
  const tile = await readTile(meta, t);
  return { kind, tile: tileWire(tile, g), assignedAtMs: nowMs, dayNumber: meta.dayNumber };
}
