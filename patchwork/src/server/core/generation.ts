import type { DayKey } from '../../shared/daykey';
import { addDays, dayKeyFromMs, dayStartMs, MS_PER_DAY } from '../../shared/daykey';
import type { BuiltDay, GenerateOptions } from '../../shared/mosaic';
import { buildDay } from '../../shared/mosaic';
import { readMeta } from './day';
import { CLAIM_SECONDS, K, M } from './keys';
import { claim, intOr, release, rx } from './redisx';
import { tileToRecord } from './tilerec';

export interface GenerationSpec {
  readonly seed: number;
  readonly motifIndex: number;
}

export interface BuiltGeneration {
  readonly records: Record<string, string>;
  readonly motifName: string;
  readonly variant: number;
}

/** Deterministic: the same Day_Key, seed and motif index always give the same 64 records (Req 2.2). */
export function buildGeneration(d: DayKey, spec: GenerationSpec): BuiltGeneration {
  const opts: GenerateOptions = { seed: spec.seed, motifIndex: spec.motifIndex };
  const built: BuiltDay = buildDay(d, opts);
  const records: Record<string, string> = {};
  for (const tile of built.slice.tiles) records[String(tile.index)] = JSON.stringify(tileToRecord(tile));
  return { records, motifName: built.mosaic.motifName, variant: built.mosaic.source.variant };
}

/**
 * Stores the 64 Tile records of generation `gen` at most once, even under concurrent callers (Req 27.6,
 * Req 27.7): the builder holds `pw:claim:gen:{d}:{g}` and re-checks the hash after taking it. The records go
 * in with one `hSet`, so a reader sees either no Tiles or all 64.
 */
export async function ensureTiles(
  d: DayKey,
  gen: number,
  spec: GenerationSpec,
  prebuilt?: BuiltGeneration,
): Promise<'present' | 'stored' | 'busy'> {
  if ((await rx.hLen(K.tiles(d, gen))) >= 64) return 'present';
  const token = await claim(K.genClaim(d, gen), CLAIM_SECONDS);
  if (!token) return 'busy';
  try {
    if ((await rx.hLen(K.tiles(d, gen))) >= 64) return 'present';
    await rx.hSet(K.tiles(d, gen), (prebuilt ?? buildGeneration(d, spec)).records);
    return 'stored';
  } finally {
    await release(K.genClaim(d, gen), token).catch(() => undefined);
  }
}

/**
 * During day d-1 after 12:00 UTC, stores generation 0 of day d so the midnight run usually only writes the
 * post (Decision D32). Failures are logged by the caller and change nothing.
 */
export async function prebuildNextDay(nowMs: number): Promise<'skipped' | 'present' | 'stored' | 'busy'> {
  const today = dayKeyFromMs(nowMs);
  if (nowMs - dayStartMs(today) < MS_PER_DAY / 2) return 'skipped';
  const next = addDays(today, 1);
  if ((await rx.hLen(K.meta(next))) > 0) return 'skipped';
  return ensureTiles(next, 0, { seed: 0, motifIndex: 0 });
}

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

/**
 * Regenerate (new seed, same motif) or skip (next motif) for a Day_Key that already has a post (Req 22.1,
 * Req 22.2). The new generation's Tiles and meta fields are written first; the single `hSet activeGen` is the
 * switch (Req 22.3). A failed build deletes the new generation's Tiles and leaves the old one active (Req 22.4).
 */
export async function switchGeneration(d: DayKey, mode: 'regenerate' | 'skip'): Promise<{ readonly gen: number; readonly motifName: string }> {
  const meta = await readMeta(d);
  if (!meta) throw new GenerationError(`No mosaic recorded for ${d}`);
  const raw = await rx.hGetAll(K.meta(d));
  const current = { seed: intOr(raw[M.seed(meta.activeGen)], 0), motifIndex: intOr(raw[M.motifIndex(meta.activeGen)], 0) };
  const n = await rx.hIncrBy(K.meta(d), M.genSeq, 1);
  const spec: GenerationSpec = mode === 'regenerate' ? { seed: n, motifIndex: current.motifIndex } : { seed: current.seed, motifIndex: current.motifIndex + 1 };
  try {
    const built = buildGeneration(d, spec);
    await rx.hSet(K.tiles(d, n), built.records);
    await rx.hSet(K.meta(d), {
      [M.seed(n)]: String(spec.seed),
      [M.motifIndex(n)]: String(spec.motifIndex),
      [M.variant(n)]: String(built.variant),
      [M.motif(n)]: built.motifName,
      [M.source(n)]: 'procedural',
    });
    await rx.hSet(K.meta(d), { [M.activeGen]: String(n) });
    return { gen: n, motifName: built.motifName };
  } catch (error) {
    await rx.del(K.tiles(d, n)).catch(() => undefined);
    throw error;
  }
}
