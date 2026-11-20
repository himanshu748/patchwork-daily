import type { TileSize } from '../../shared/daykey';
import { tileSizeFor, parseDayKey } from '../../shared/daykey';
import type { MosaicSnapshot, PostWire } from '../../shared/wire';
import { unpackStitchedPixels } from '../../shared/wire';

export interface MosaicState {
  readonly dayKey: string;
  readonly dayNumber: number;
  readonly gen: number;
  readonly tileSize: TileSize;
  readonly motifName: string;
  readonly stitched: number;
  readonly tiles: readonly (Uint8Array | null)[];
  readonly solveCounts: readonly number[] | null;
  readonly complete: boolean;
}

export function fromPostWire(w: PostWire): MosaicState | null {
  const tiles = unpackStitchedPixels(w.k, w.p, w.z);
  if (!tiles) return null;
  return { dayKey: w.d, dayNumber: w.n, gen: w.g, tileSize: w.z, motifName: w.m, stitched: w.s, tiles, solveCounts: null, complete: w.c === 1 };
}

/** Null when the snapshot does not hold together (unknown day, wrong Tile_Size, pixels that do not fit the mask). */
export function fromSnapshot(s: MosaicSnapshot): MosaicState | null {
  const d = parseDayKey(s.dayKey);
  if (!d || tileSizeFor(d) !== s.tileSize) return null;
  const tiles = unpackStitchedPixels(s.stitchedMask, s.pixels, s.tileSize);
  if (!tiles) return null;
  return {
    dayKey: s.dayKey,
    dayNumber: s.dayNumber,
    gen: s.gen,
    tileSize: s.tileSize,
    motifName: s.motifName,
    stitched: tiles.filter(Boolean).length,
    tiles,
    solveCounts: s.solveCounts.length === 64 ? s.solveCounts : null,
    complete: s.complete,
  };
}

/** The same Mosaic with one more Tile's pixels in place. */
export function withTile(state: MosaicState, index: number, pixels: Uint8Array): MosaicState {
  if (state.tiles[index]) return state;
  const tiles = state.tiles.slice();
  tiles[index] = pixels;
  const stitched = state.stitched + 1;
  return { ...state, tiles, stitched, complete: stitched === 64 };
}
