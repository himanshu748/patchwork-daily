import type { TileWire } from '../../shared/api';
import type { Clue } from '../../shared/clues';
import type { TileSize } from '../../shared/daykey';
import type { Tile } from '../../shared/slicer';
import { packStitchedPixels, unpackTilePixels } from '../../shared/wire';

/** Field `{t}` of `pw:d:{d}:g:{g}:tiles` (design.md Data Models (h)). */
export interface TileRecord {
  readonly r: readonly Clue[];
  readonly c: readonly Clue[];
  /** Solution, n × n bits row-major as hex, zero-padded to a whole digit. */
  readonly s: string;
  /** Final pixels, 2 bits per pixel, base64. */
  readonly p: string;
  readonly f: number;
  readonly d: number;
  /** Par seconds. */
  readonly t: number;
  /** Mistake allowance. */
  readonly a: number;
  readonly x: { readonly k: 'u' | 'p' | 'f'; readonly n: number; readonly c: readonly number[]; readonly b: number | null };
}

export interface StoredTile {
  readonly index: number;
  readonly size: TileSize;
  readonly rowClues: readonly Clue[];
  readonly colClues: readonly Clue[];
  readonly solution: Uint8Array;
  readonly solutionHex: string;
  readonly pixels: string;
  readonly parSeconds: number | null;
  readonly mistakeAllowance: number;
}

export function solutionToHex(solution: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < solution.length; i += 4) {
    let v = 0;
    for (let b = 0; b < 4; b++) v = (v << 1) | (solution[i + b] === 1 ? 1 : 0);
    out += v.toString(16);
  }
  return out;
}

export function hexToSolution(hex: string, size: TileSize): Uint8Array | null {
  const cells = size * size;
  if (!/^[0-9a-f]+$/.test(hex) || hex.length !== Math.ceil(cells / 4)) return null;
  const out = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    const digit = Number.parseInt(hex[i >> 2] as string, 16);
    out[i] = (digit >> (3 - (i & 3))) & 1;
  }
  return out;
}

export function tilePixelsBase64(pixels: Uint8Array, size: TileSize): string {
  const tiles: (Uint8Array | null)[] = new Array<Uint8Array | null>(64).fill(null);
  tiles[0] = pixels;
  return packStitchedPixels(tiles, size).pixels;
}

const KIND = { unchanged: 'u', perturbed: 'p', fallback: 'f' } as const;

export function tileToRecord(tile: Tile): TileRecord {
  return {
    r: tile.clues.rows,
    c: tile.clues.cols,
    s: solutionToHex(tile.solution),
    p: tilePixelsBase64(tile.pixels, tile.size),
    f: tile.perturbation.foreground,
    d: tile.difficulty,
    t: tile.par.seconds,
    a: tile.par.mistakeAllowance,
    x: {
      k: KIND[tile.perturbation.kind],
      n: tile.perturbation.attempts,
      c: tile.perturbation.changedCells,
      b: tile.perturbation.fallbackIndex,
    },
  };
}

function isClueList(v: unknown, size: number): v is Clue[] {
  return (
    Array.isArray(v) &&
    v.length === size &&
    v.every((line) => Array.isArray(line) && line.every((n) => Number.isInteger(n) && n >= 1 && n <= size))
  );
}

/** Null when the stored JSON is missing or malformed. */
export function parseTileRecord(json: string | undefined, index: number, size: TileSize): StoredTile | null {
  if (json === undefined) return null;
  let rec: Partial<TileRecord>;
  try {
    rec = JSON.parse(json) as Partial<TileRecord>;
  } catch {
    return null;
  }
  if (!isClueList(rec.r, size) || !isClueList(rec.c, size) || typeof rec.s !== 'string' || typeof rec.p !== 'string') return null;
  const solution = hexToSolution(rec.s, size);
  if (!solution || !unpackTilePixels(rec.p, size)) return null;
  const par = typeof rec.t === 'number' && rec.t > 0 ? rec.t : null;
  return {
    index,
    size,
    rowClues: rec.r,
    colClues: rec.c,
    solution,
    solutionHex: rec.s,
    pixels: rec.p,
    parSeconds: par,
    mistakeAllowance: typeof rec.a === 'number' ? rec.a : 0,
  };
}

/** Clues, Tile_Size, Tile_Index and generation only: never Solution or pixel data (Req 9.9). */
export function tileWire(tile: StoredTile, gen: number): TileWire {
  return { gen, index: tile.index, size: tile.size, rowClues: tile.rowClues, colClues: tile.colClues };
}
