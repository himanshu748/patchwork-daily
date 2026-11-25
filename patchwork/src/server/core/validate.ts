import type { ErrorCode } from '../../shared/api';
import type { DayKey } from '../../shared/daykey';
import { decodeGrid, filledMask } from '../../shared/grid';
import { parseHeld, readTile } from './assign';
import type { DayMeta } from './day';
import { readMeta } from './day';
import { F, K } from './keys';
import { rx } from './redisx';
import type { StoredTile } from './tilerec';

export type Role = 'scored' | 'extra' | 'late' | 'already-stitched';

export type ValidationOutcome =
  | { readonly status: 'accepted'; readonly role: Role; readonly tile: StoredTile; readonly meta: DayMeta }
  | { readonly status: 'rejected'; readonly countedMistake: boolean }
  | { readonly status: 'error'; readonly code: ErrorCode };

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;
}

/**
 * Validator (design.md Data Models (c), V1 to V8). Every rejection records zero Stitches; only a wrong grid on
 * the unstitched Scored_Attempt Tile adds a Mistake (Req 11.3 to Req 11.6). Client times, Mistakes and scores
 * are never read (Req 13.7). Redis failures propagate to the caller, which answers `STITCH_NOT_SAVED`.
 */
export async function validateSubmission(userId: string | undefined, postDay: DayKey | null, body: unknown): Promise<ValidationOutcome> {
  if (!userId) return { status: 'error', code: 'AUTH_REQUIRED' };
  if (!postDay) return { status: 'error', code: 'NOT_A_PATCHWORK_POST' };
  if (field(body, 'dayKey') !== postDay) return { status: 'error', code: 'DAY_MISMATCH' };
  const meta = await readMeta(postDay);
  if (!meta) return { status: 'error', code: 'DAY_NOT_READY' };
  const g = meta.activeGen;
  if (field(body, 'gen') !== g) return { status: 'error', code: 'MOSAIC_CHANGED' };
  const t = field(body, 'tileIndex');
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > 63) return { status: 'error', code: 'TILE_NOT_ASSIGNED' };
  const grid = field(body, 'grid');
  const cells = typeof grid === 'string' ? decodeGrid(grid, meta.tileSize) : null;
  if (!cells) return { status: 'error', code: 'INVALID_GRID' };

  const udKey = K.userDay(postDay, userId);
  const ud = await rx.hGetAll(udKey);
  const scored = parseHeld(ud[F.scored(g)]);
  const extra = parseHeld(ud[F.extra(g)]);
  let role: Role;
  if (scored?.t === t) role = 'scored';
  else if (extra?.t === t) role = extra.k ?? 'extra';
  else if (ud[F.stitched(g, t)] !== undefined) role = 'already-stitched';
  else return { status: 'error', code: 'TILE_NOT_ASSIGNED' };

  const tile = await readTile(meta, t);
  const filled = filledMask(cells);
  const matches = filled.every((v, i) => v === tile.solution[i]);
  if (!matches) {
    const counts = role === 'scored' && ud[F.scoredDone] === undefined && ud[F.result] === undefined;
    if (counts) await rx.hIncrBy(udKey, F.mistakes(g), 1);
    return { status: 'rejected', countedMistake: counts };
  }
  return { status: 'accepted', role, tile, meta };
}
