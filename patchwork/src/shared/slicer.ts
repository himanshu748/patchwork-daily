import type { DayKey, TileSize } from './daykey';
import { assertDayKey, tileSizeFor } from './daykey';
import type { Clues } from './clues';
import { deriveClues } from './clues';
import type { PaletteId } from './palette';
import { createPrng, seedFor } from './prng';
import type { Par } from './score';
import { parFor } from './score';
import type { SolveResult } from './solver';
import { solveNonogram } from './solver';

export type PerturbationKind = 'unchanged' | 'perturbed' | 'fallback';

export interface PerturbationRecord {
  readonly kind: PerturbationKind;
  /** 4-bit mask of PaletteIds counted as filled. */
  readonly foreground: number;
  /** 0 when unchanged, 1 to 8 when perturbed, 8 for a fallback. */
  readonly attempts: number;
  /** Cell indexes whose final pixel differs from the sliced pixel, ascending. */
  readonly changedCells: readonly number[];
  readonly fallbackIndex: number | null;
}

export interface Tile {
  readonly index: number;
  readonly size: TileSize;
  readonly clues: Clues;
  /** 0 or 1 per Cell, row-major. */
  readonly solution: Uint8Array;
  /** Final PaletteId per Cell; a Cell is filled exactly when its colour is in `perturbation.foreground`. */
  readonly pixels: Uint8Array;
  readonly difficulty: number;
  readonly par: Par;
  readonly perturbation: PerturbationRecord;
}

export interface SliceOk {
  readonly ok: true;
  readonly tiles: readonly Tile[];
}
export interface SliceUnresolved {
  readonly ok: false;
  readonly reason: 'not-unique';
  readonly tileIndexes: readonly number[];
}

export interface SliceInput {
  readonly side: number;
  readonly pixels: Uint8Array;
  readonly paper: PaletteId;
}

export interface SliceOptions {
  /** Default true. UGC art is sliced with false, so a fallback never replaces the creator's art. */
  readonly allowFallback?: boolean;
}

export class InvalidMosaicError extends Error {
  readonly kind: 'dimensions' | 'content';
  constructor(kind: 'dimensions' | 'content', message: string) {
    super(message);
    this.name = 'InvalidMosaicError';
    this.kind = kind;
  }
}

export const PERTURBATION_ATTEMPTS = 8;

function grids(rows: readonly string[][]): Uint8Array[] {
  return rows.map((g) => Uint8Array.from(g.join('').split(''), (ch) => (ch === '#' ? 1 : 0)));
}

/** Hand-authored fallback grids; each is proven unique and non-uniform by slicer.test.ts. */
export const FALLBACK_PATTERNS: Readonly<Record<TileSize, readonly Uint8Array[]>> = {
  5: grids([
    ['#####', '#...#', '#.#.#', '#...#', '#####'],
    ['..#..', '..#..', '#####', '..#..', '..#..'],
    ['..#..', '.###.', '#####', '..#..', '..#..'],
    ['#####', '..#..', '..#..', '..#..', '.###.'],
    ['#....', '##...', '###..', '####.', '#####'],
    ['#...#', '#...#', '#####', '#...#', '#...#'],
    ['.#.#.', '#####', '#####', '.###.', '..#..'],
    ['#....', '#....', '#....', '#....', '#####'],
    ['#...#', '#...#', '#...#', '#...#', '#####'],
  ]),
  6: grids([
    ['######', '#....#', '#.##.#', '#.##.#', '#....#', '######'],
    ['..##..', '..##..', '######', '######', '..##..', '..##..'],
    ['#.....', '##....', '###...', '####..', '#####.', '######'],
    ['######', '######', '..##..', '..##..', '..##..', '..##..'],
    ['##..##', '##..##', '######', '######', '##..##', '##..##'],
    ['..##..', '.####.', '######', '######', '..##..', '..##..'],
    ['######', '#....#', '#....#', '#....#', '#....#', '######'],
    ['#.....', '#.....', '#.....', '#.....', '#.....', '######'],
  ]),
  7: grids([
    ['#######', '#..#..#', '#..#..#', '#######', '#..#..#', '#..#..#', '#######'],
    ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'],
    ['#......', '##.....', '###....', '####...', '#####..', '######.', '#######'],
    ['#######', '#######', '..###..', '..###..', '..###..', '..###..', '..###..'],
    ['##...##', '##...##', '#######', '##...##', '##...##', '##...##', '##...##'],
    ['...#...', '..###..', '.#####.', '#######', '...#...', '...#...', '...#...'],
    ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######'],
    ['#######', '#.....#', '#.###.#', '#.#.#.#', '#.###.#', '#.....#', '#######'],
  ]),
};

export function tileOrigin(index: number, size: TileSize): { readonly row0: number; readonly col0: number } {
  return { row0: Math.floor(index / 8) * size, col0: (index % 8) * size };
}

/** The most frequent colour among `ids` by `counts`, ties to the lowest id; -1 if none is present. */
function modeOf(counts: readonly number[], allowed: (id: number) => boolean): number {
  let best = -1;
  let bestCount = 0;
  for (let id = 0; id < 4; id++) {
    const n = counts[id] ?? 0;
    if (allowed(id) && n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

function lowestOtherThan(b: number): number {
  return b === 0 ? 1 : 0;
}

function solve(solution: Uint8Array, n: TileSize): SolveResult {
  return solveNonogram(deriveClues(solution, n));
}

function makeTile(
  index: number,
  n: TileSize,
  solution: Uint8Array,
  pixels: Uint8Array,
  result: Extract<SolveResult, { kind: 'unique' }>,
  perturbation: PerturbationRecord,
): Tile {
  return {
    index,
    size: n,
    clues: deriveClues(solution, n),
    solution,
    pixels,
    difficulty: result.difficulty,
    par: parFor(result.difficulty, n),
    perturbation,
  };
}

function sliceTile(px: Uint8Array, n: TileSize, paper: PaletteId, dayKey: DayKey, index: number, allowFallback: boolean): Tile | null {
  const cells = n * n;
  const counts = [0, 0, 0, 0];
  for (const p of px) counts[p] = (counts[p] ?? 0) + 1;
  const present = counts.filter((c) => c > 0).length;
  const b = (counts[paper] ?? 0) > 0 ? paper : modeOf(counts, () => true);
  const foregroundAll = (0b1111 & ~(1 << b)) & counts.reduce((m, c, id) => (c > 0 ? m | (1 << id) : m), 0);
  const solutionFor = (fg: number): Uint8Array => Uint8Array.from(px, (p) => (fg >> p) & 1);

  let firstSplit: SolveResult | null = null;
  const baseSolution = solutionFor(foregroundAll);
  if (present >= 2) {
    firstSplit = solve(baseSolution, n);
    if (firstSplit.kind === 'unique') {
      return makeTile(index, n, baseSolution, px.slice(), firstSplit, {
        kind: 'unchanged', foreground: foregroundAll, attempts: 0, changedCells: [], fallbackIndex: null,
      });
    }
    if (present >= 3) {
      const top = modeOf(counts, (id) => id !== b);
      const fg = 1 << top;
      const sol = solutionFor(fg);
      const res = solve(sol, n);
      if (res.kind === 'unique') {
        return makeTile(index, n, sol, px.slice(), res, {
          kind: 'unchanged', foreground: fg, attempts: 0, changedCells: [], fallbackIndex: null,
        });
      }
    }
  }

  const allCells = Array.from({ length: cells }, (_, i) => i);
  let witnessPool = allCells;
  if (firstSplit?.kind === 'multiple') {
    const [w0, w1] = firstSplit.witnesses;
    witnessPool = allCells.filter((i) => w0[i] !== w1[i]);
  }
  const neighbourColour = (cell: number, fg: number): number => {
    const r = Math.floor(cell / n);
    const c = cell % n;
    const near = [0, 0, 0, 0];
    const add = (rr: number, cc: number): void => {
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) return;
      const p = px[rr * n + cc] as number;
      if ((fg >> p) & 1) near[p] = (near[p] ?? 0) + 1;
    };
    add(r - 1, c);
    add(r + 1, c);
    add(r, c - 1);
    add(r, c + 1);
    const fromNeighbours = modeOf(near, () => true);
    if (fromNeighbours >= 0) return fromNeighbours;
    const fromTile = modeOf(counts, (id) => ((fg >> id) & 1) === 1);
    return fromTile >= 0 ? fromTile : lowestOtherThan(b);
  };

  for (let attempt = 1; attempt <= PERTURBATION_ATTEMPTS; attempt++) {
    const prng = createPrng(seedFor('pw-pert', dayKey, index, attempt));
    const k = 1 + prng.int(3);
    const pool = (witnessPool.length >= k ? witnessPool : allCells).slice();
    const picked: number[] = [];
    for (let i = 0; i < k; i++) {
      const j = i + prng.int(pool.length - i);
      const tmp = pool[i] as number;
      pool[i] = pool[j] as number;
      pool[j] = tmp;
      picked.push(pool[i] as number);
    }
    picked.sort((x, y) => x - y);
    const sol = baseSolution.slice();
    const pixels = px.slice();
    let fg = foregroundAll;
    for (const cell of picked) {
      sol[cell] = sol[cell] === 1 ? 0 : 1;
      if (sol[cell] === 1) {
        const colour = neighbourColour(cell, fg);
        fg |= 1 << colour;
        pixels[cell] = colour;
      } else {
        pixels[cell] = b;
      }
    }
    const filled = sol.reduce((s, v) => s + v, 0);
    if (filled === 0 || filled === cells) continue;
    const res = solve(sol, n);
    if (res.kind === 'unique') {
      return makeTile(index, n, sol, pixels, res, {
        kind: 'perturbed', foreground: fg, attempts: attempt, changedCells: picked, fallbackIndex: null,
      });
    }
  }

  if (!allowFallback) return null;
  const patterns = FALLBACK_PATTERNS[n];
  const fallbackIndex = seedFor('pw-fb', dayKey, index) % patterns.length;
  const pattern = patterns[fallbackIndex] as Uint8Array;
  const top = modeOf(counts, (id) => id !== b);
  const colour = top >= 0 ? top : lowestOtherThan(b);
  const pixels = Uint8Array.from(pattern, (v) => (v === 1 ? colour : b));
  const sol = pattern.slice();
  const res = solve(sol, n);
  if (res.kind !== 'unique') throw new Error(`Fallback pattern ${n}/${fallbackIndex} is not unique`);
  const changedCells = allCells.filter((i) => pixels[i] !== px[i]);
  return makeTile(index, n, sol, pixels, res, {
    kind: 'fallback', foreground: 1 << colour, attempts: PERTURBATION_ATTEMPTS, changedCells, fallbackIndex,
  });
}

export function sliceToTiles(mosaic: SliceInput, dayKey: string, opts: SliceOptions = {}): SliceOk | SliceUnresolved {
  const d = assertDayKey(dayKey);
  const n = tileSizeFor(d);
  const side = 8 * n;
  if (mosaic.side !== side || mosaic.pixels.length !== side * side) {
    throw new InvalidMosaicError('dimensions', `Mosaic side must be ${side} for ${d}`);
  }
  for (const p of mosaic.pixels) {
    if (p > 3) throw new InvalidMosaicError('content', 'Mosaic pixels must be Palette ids 0 to 3');
  }
  const allowFallback = opts.allowFallback ?? true;
  const tiles: Tile[] = [];
  const unresolved: number[] = [];
  for (let index = 0; index < 64; index++) {
    const { row0, col0 } = tileOrigin(index, n);
    const px = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) px[r * n + c] = mosaic.pixels[(row0 + r) * side + col0 + c] as number;
    }
    const tile = sliceTile(px, n, mosaic.paper, d, index, allowFallback);
    if (tile) tiles.push(tile);
    else unresolved.push(index);
  }
  if (unresolved.length > 0) return { ok: false, reason: 'not-unique', tileIndexes: unresolved };
  return { ok: true, tiles };
}
