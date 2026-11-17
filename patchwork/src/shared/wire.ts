import type { TileSize } from './daykey';
import { parseDayKey, tileSizeFor } from './daykey';
import { isValidMotifName } from './motifs';
import { base64ToBytes, bytesToBase64 } from './base64';

/** `postData` (F14), short keys so the largest case stays under 2 KB. */
export interface PostWire {
  readonly v: 1;
  /** Day_Key */
  readonly d: string;
  /** Day_Number */
  readonly n: number;
  /** Motif name */
  readonly m: string;
  /** Tile_Size */
  readonly z: TileSize;
  /** Active generation */
  readonly g: number;
  /** Stitched_Total */
  readonly s: number;
  /** Stitched mask, 16 hex characters */
  readonly k: string;
  /** Stitched Tiles' pixels only, 2 bits per pixel, base64 */
  readonly p: string;
  /** Complete_Mosaic */
  readonly c: 0 | 1;
}

export interface MosaicSnapshot {
  readonly dayKey: string;
  readonly dayNumber: number;
  readonly gen: number;
  readonly tileSize: TileSize;
  readonly motifName: string;
  readonly stitchedTotal: number;
  readonly stitchedMask: string;
  readonly solveCounts: readonly number[];
  readonly pixels: string;
  readonly complete: boolean;
  readonly completeAtMs: number | null;
  /** Sum of Solve_Counts of the generation; only grows within a generation. */
  readonly version: number;
}

export const POST_DATA_MAX_BYTES = 2000;
const MASK_RE = /^[0-9a-f]{16}$/;

// Tile t is bit (t mod 4) of hex digit floor(t / 4).
export function isStitched(mask: string, tile: number): boolean {
  const digit = Number.parseInt(mask[tile >> 2] ?? '0', 16);
  return Number.isFinite(digit) && ((digit >> (tile & 3)) & 1) === 1;
}

export function maskFromTiles(stitched: (tile: number) => boolean): string {
  let out = '';
  for (let d = 0; d < 16; d++) {
    let v = 0;
    for (let b = 0; b < 4; b++) if (stitched(d * 4 + b)) v |= 1 << b;
    out += v.toString(16);
  }
  return out;
}

export function maskCount(mask: string): number {
  let n = 0;
  for (let t = 0; t < 64; t++) if (isStitched(mask, t)) n++;
  return n;
}

function packBits(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(values.length / 4));
  values.forEach((v, i) => {
    out[i >> 2] = (out[i >> 2] as number) | ((v & 3) << (6 - 2 * (i & 3)));
  });
  return out;
}

export function packStitchedPixels(tiles: readonly (Uint8Array | null)[], size: TileSize): { readonly mask: string; readonly pixels: string } {
  const values: number[] = [];
  for (let t = 0; t < 64; t++) {
    const px = tiles[t];
    if (px) {
      if (px.length !== size * size) throw new RangeError(`Tile ${t} has ${px.length} pixels, expected ${size * size}`);
      for (const p of px) values.push(p);
    }
  }
  return { mask: maskFromTiles((t) => Boolean(tiles[t])), pixels: bytesToBase64(packBits(values)) };
}

/** Null when the mask, the pixel string or their lengths disagree. */
export function unpackStitchedPixels(mask: string, pixels: string, size: TileSize): (Uint8Array | null)[] | null {
  if (!MASK_RE.test(mask)) return null;
  const bytes = base64ToBytes(pixels);
  if (!bytes) return null;
  const count = maskCount(mask);
  const cells = size * size;
  if (bytes.length !== Math.ceil((count * cells) / 4)) return null;
  const out: (Uint8Array | null)[] = [];
  let i = 0;
  for (let t = 0; t < 64; t++) {
    if (!isStitched(mask, t)) {
      out.push(null);
      continue;
    }
    const px = new Uint8Array(cells);
    for (let c = 0; c < cells; c++, i++) px[c] = ((bytes[i >> 2] as number) >> (6 - 2 * (i & 3))) & 3;
    out.push(px);
  }
  return out;
}

export function encodePostWire(snapshot: MosaicSnapshot): PostWire {
  const s = maskCount(snapshot.stitchedMask);
  return {
    v: 1,
    d: snapshot.dayKey,
    n: snapshot.dayNumber,
    m: snapshot.motifName,
    z: snapshot.tileSize,
    g: snapshot.gen,
    s,
    k: snapshot.stitchedMask,
    p: snapshot.pixels,
    c: s === 64 ? 1 : 0,
  };
}

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

export function decodePostWire(value: unknown): PostWire | null {
  if (typeof value !== 'object' || value === null) return null;
  const w = value as Record<string, unknown>;
  if (w.v !== 1) return null;
  const d = typeof w.d === 'string' ? parseDayKey(w.d) : null;
  if (!d) return null;
  if (!isInt(w.n, 1, 99_999)) return null;
  if (typeof w.m !== 'string' || !isValidMotifName(w.m)) return null;
  const z = tileSizeFor(d);
  if (w.z !== z) return null;
  if (!isInt(w.g, 0, 999)) return null;
  if (typeof w.k !== 'string' || !MASK_RE.test(w.k)) return null;
  if (!isInt(w.s, 0, 64) || w.s !== maskCount(w.k)) return null;
  if (typeof w.p !== 'string' || !unpackStitchedPixels(w.k, w.p, z)) return null;
  const c = w.s === 64 ? 1 : 0;
  if (w.c !== c) return null;
  return { v: 1, d, n: w.n, m: w.m, z, g: w.g, s: w.s, k: w.k, p: w.p, c };
}

export function postWireBytes(wire: PostWire): number {
  return utf8Length(JSON.stringify(wire));
}

// Shared code has no DOM or Node types, so TextEncoder is unavailable here.
export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Live updates never go backwards: a message is kept only if its (generation, version) is newer. */
export function isNewerSnapshot(
  held: { readonly gen: number; readonly version: number } | null,
  incoming: { readonly gen: number; readonly version: number },
): boolean {
  if (held === null) return true;
  if (incoming.gen !== held.gen) return incoming.gen > held.gen;
  return incoming.version > held.version;
}
