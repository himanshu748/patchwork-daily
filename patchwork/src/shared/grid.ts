import type { TileSize } from './daykey';

/** 0 empty, 1 filled, 2 marked-X. */
export type CellState = 0 | 1 | 2;

export function encodeGrid(states: ArrayLike<CellState>): string {
  let out = '';
  for (let i = 0; i < states.length; i++) out += String(states[i]);
  return out;
}

/** Null on a wrong length or any character other than '0', '1' or '2'. */
export function decodeGrid(text: string, size: TileSize): Uint8Array | null {
  if (typeof text !== 'string' || text.length !== size * size) return null;
  const out = new Uint8Array(size * size);
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i) - 48;
    if (ch < 0 || ch > 2) return null;
    out[i] = ch;
  }
  return out;
}

/** Marked-X and empty both become 0. */
export function filledMask(states: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(states.length);
  for (let i = 0; i < states.length; i++) out[i] = states[i] === 1 ? 1 : 0;
  return out;
}
