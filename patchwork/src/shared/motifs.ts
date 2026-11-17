import type { DayKey, Weekday } from './daykey';
import { dayOrdinal } from './daykey';
import type { PaletteId } from './palette';
import type { Prng } from './prng';
import { createPrng, seedFor, shuffled } from './prng';

export type MotifFamily = 'quilt' | 'tessellation' | 'glyph';
/** A Mosaic's family; 'ugc' is reserved for community Sunday art (step 6). */
export type MosaicFamily = MotifFamily | 'ugc';
export type Axis = 'vertical' | 'horizontal' | 'diagonal' | 'antidiagonal';
export type Density = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type MosaicSide = 40 | 48 | 56;
/** v: left-right mirror; vh: plus top-bottom; d: main diagonal; vhd: all four axes. */
export type Symmetry = 'v' | 'vh' | 'd' | 'vhd';

export interface MotifDef {
  readonly id: string;
  readonly family: MotifFamily;
  readonly noun: string;
  readonly symmetry: Symmetry;
  readonly axes: readonly Axis[];
}

const AXES: Readonly<Record<Symmetry, readonly Axis[]>> = {
  v: ['vertical'],
  vh: ['vertical', 'horizontal'],
  d: ['diagonal'],
  vhd: ['vertical', 'horizontal', 'diagonal', 'antidiagonal'],
};

function def(id: string, family: MotifFamily, noun: string, symmetry: Symmetry): MotifDef {
  return { id, family, noun, symmetry, axes: AXES[symmetry] };
}

export const MOTIFS: readonly MotifDef[] = [
  def('pinwheel', 'quilt', 'Pinwheel', 'vh'),
  def('nine-patch', 'quilt', 'Nine-Patch', 'vhd'),
  def('ohio-star', 'quilt', 'Ohio Star', 'vhd'),
  def('log-cabin', 'quilt', 'Log Cabin', 'vh'),
  def('flying-geese', 'quilt', 'Flying Geese', 'v'),
  def('churn-dash', 'quilt', 'Churn Dash', 'vhd'),
  def('chevron', 'tessellation', 'Chevron', 'v'),
  def('herringbone', 'tessellation', 'Herringbone', 'vh'),
  def('interlocking-l', 'tessellation', 'Interlock', 'd'),
  def('offset-bricks', 'tessellation', 'Brickwork', 'vh'),
  def('basketweave', 'tessellation', 'Basketweave', 'vhd'),
  def('mirrored-glyph', 'glyph', 'Glyph', 'vh'),
  def('star-glyph', 'glyph', 'Star Glyph', 'vhd'),
];

export const FAMILIES: readonly MotifFamily[] = ['quilt', 'tessellation', 'glyph'];

export const ADJECTIVES: readonly string[] = [
  'Amber', 'Autumn', 'Bright', 'Brisk', 'Calm', 'Cedar', 'Clover', 'Copper',
  'Dawn', 'Dusky', 'Ember', 'Fern', 'Frosty', 'Golden', 'Harbor', 'Hearth',
  'Hollow', 'Indigo', 'Juniper', 'Lantern', 'Linen', 'Maple', 'Meadow', 'Misty',
  'Moss', 'Nimble', 'Orchard', 'Pebble', 'Quiet', 'River', 'Saffron', 'Willow',
];

const NAME_RE = /^[A-Za-z0-9 -]{1,40}$/;

export function isValidMotifName(name: string): boolean {
  return typeof name === 'string' && NAME_RE.test(name) && name.trim().length > 0;
}

export function motifName(motif: MotifDef, prng: Prng): string {
  return `${prng.pick(ADJECTIVES)} ${motif.noun}`;
}

/** Monday 1 up to Sunday 7. */
export function densityFor(weekday: Weekday): Density {
  return (weekday === 0 ? 7 : weekday) as Density;
}

/** Initial values, calibrated in step 2 (D29). */
export function featureWidth(density: Density): number {
  return Math.max(1, 4 - Math.floor(density / 2));
}

export function detailPerMille(density: Density): number {
  return 10 * density;
}

/** Seeded permutation of MOTIFS indexes whose first entry comes from family dayOrdinal mod 3. */
export function motifOrder(dayKey: DayKey): readonly number[] {
  const order = shuffled(
    MOTIFS.map((_, i) => i),
    createPrng(seedFor('pw-order', dayKey)),
  );
  const family = FAMILIES[((dayOrdinal(dayKey) % 3) + 3) % 3];
  const first = order.findIndex((i) => MOTIFS[i]?.family === family);
  if (first > 0) {
    const tmp = order[0] as number;
    order[0] = order[first] as number;
    order[first] = tmp;
  }
  return order;
}

interface DrawCtx {
  readonly side: number;
  readonly width: number;
  readonly density: Density;
  readonly prng: Prng;
  /** Writes a colour role (0 paper, 1 to 3 accents) at (r, c) of the base canvas. */
  set(r: number, c: number, role: number): void;
}

type BlockFn = (y: number, x: number) => number;

const QUILT_BLOCKS: Readonly<Record<string, BlockFn>> = {
  pinwheel: (y, x) => {
    const q = (y < 4 ? 0 : 2) + (x < 4 ? 0 : 1);
    const ly = y % 4;
    const lx = x % 4;
    const [ry, rx] = q === 0 ? [ly, lx] : q === 1 ? [lx, 3 - ly] : q === 3 ? [3 - ly, 3 - lx] : [3 - lx, ly];
    return rx >= ry ? 1 : 0;
  },
  'nine-patch': (y, x) => {
    const band = (v: number): number => (v < 3 ? 0 : v < 5 ? 1 : 2);
    const i = band(y);
    const j = band(x);
    if (i === 1 && j === 1) return 2;
    return (i + j) % 2 === 0 ? 1 : 0;
  },
  'ohio-star': (y, x) => {
    const ci = y >> 1;
    const cj = x >> 1;
    const ly = y & 1;
    const lx = x & 1;
    const edgeI = ci === 0 || ci === 3;
    const edgeJ = cj === 0 || cj === 3;
    if (!edgeI && !edgeJ) return 2;
    if (edgeI && edgeJ) return 3;
    if (ci === 0) return ly === 1 ? 1 : 0;
    if (ci === 3) return ly === 0 ? 1 : 0;
    if (cj === 0) return lx === 1 ? 1 : 0;
    return lx === 0 ? 1 : 0;
  },
  'log-cabin': (y, x) => {
    const k = Math.max(Math.abs(2 * y - 7), Math.abs(2 * x - 7)) >> 1;
    if (k === 0) return 3;
    if (y + x < 7) return k % 2 === 1 ? 1 : 0;
    return 2;
  },
  'flying-geese': (y, x) => {
    const band = y >> 2;
    const ly = y & 3;
    return Math.abs(2 * x - 7) <= 2 * ly + 1 ? 1 + (band % 2) : 0;
  },
  'churn-dash': (y, x) => {
    const band = (v: number): number => (v < 3 ? 0 : v < 5 ? 1 : 2);
    const i = band(y);
    const j = band(x);
    const dy = Math.min(y, 7 - y);
    const dx = Math.min(x, 7 - x);
    if (i === 1 && j === 1) return 2;
    if (i !== 1 && j !== 1) return dy + dx <= 2 ? 1 : 0;
    if (i !== 1) return dy <= 1 ? 1 : 0;
    return dx <= 1 ? 1 : 0;
  },
};

function drawQuilt(id: string, ctx: DrawCtx): void {
  const block = QUILT_BLOCKS[id];
  if (!block) throw new RangeError(`Unknown quilt block ${id}`);
  const blocks = Math.ceil(ctx.side / 8);
  const checker = ctx.density >= 3;
  const rotate = ctx.density >= 5;
  for (let bi = 0; bi < blocks; bi++) {
    for (let bj = 0; bj < blocks; bj++) {
      const alt = checker && (bi + bj) % 2 === 1;
      const rot = rotate ? ctx.prng.int(4) : 0;
      // Nine-patch alternates with plain blocks (an Irish-chain layout); an all-nine-patch field is a checkerboard.
      const plain = id === 'nine-patch' && (bi + bj) % 2 === 1;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (plain) {
            ctx.set(bi * 8 + y, bj * 8 + x, 3);
            continue;
          }
          const [sy, sx] = rot === 0 ? [y, x] : rot === 1 ? [x, 7 - y] : rot === 2 ? [7 - y, 7 - x] : [7 - x, y];
          let role = block(sy, sx);
          if (alt && role !== 0) role = role === 1 ? 2 : role === 2 ? 1 : 3;
          ctx.set(bi * 8 + y, bj * 8 + x, role);
        }
      }
    }
  }
}

function drawTessellation(id: string, ctx: DrawCtx): void {
  const { side, width: w } = ctx;
  const half = side / 2;
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      let role = 0;
      switch (id) {
        case 'chevron': {
          const dc = c < half ? half - 1 - c : c - half;
          role = [1, 2, 3, 0][Math.floor((r + dc) / w) % 4] as number;
          break;
        }
        case 'herringbone': {
          // Two pixels wider than the other tessellations: at the base width it is twice as hard as every other Motif.
          const hw = w + 2;
          const p = 2 * hw;
          const local = c % p;
          // Stepped rather than diagonal: one-pixel diagonal stairs are the hardest nonogram lines there are.
          const step = Math.floor((Math.floor(c / p) % 2 === 0 ? local : p - 1 - local) / hw) * hw;
          role = [1, 0, 2, 0, 3, 0][Math.floor((r + step) / hw) % 6] as number;
          break;
        }
        case 'interlocking-l': {
          const s = 2 * w;
          const ly = r % s;
          const lx = c % s;
          role = lx < w || ly >= w ? 1 + ((Math.floor(r / s) + Math.floor(c / s)) % 3) : 0;
          break;
        }
        case 'offset-bricks': {
          const h = w + 1;
          const len = Math.max(3, 3 * w);
          const rb = Math.floor(r / h);
          const x = c + (rb % 2) * Math.floor(len / 2);
          role = r % h === w || x % len === 0 ? 0 : 1 + ((Math.floor(x / len) + rb) % 3);
          break;
        }
        case 'basketweave': {
          const s = 2 * w;
          const ly = r % s;
          const lx = c % s;
          if ((Math.floor(r / s) + Math.floor(c / s)) % 2 === 0) role = Math.floor(ly / w) === 0 ? 1 : 2;
          else role = Math.floor(lx / w) === 0 ? 3 : 0;
          break;
        }
        default:
          throw new RangeError(`Unknown tessellation ${id}`);
      }
      ctx.set(r, c, role);
    }
  }
}

const DIRS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
];

function drawGlyph(ctx: DrawCtx): void {
  const { prng, density } = ctx;
  const h = ctx.side / 2;
  const thick = Math.max(1, ctx.width - 1);
  const strokes = 2 + density;
  for (let s = 0; s < strokes; s++) {
    const role = 1 + prng.int(3);
    let r = prng.int(h);
    let c = prng.int(h);
    const [dr, dc] = DIRS[prng.int(DIRS.length)] as readonly [number, number];
    const len = 3 + prng.int(Math.max(1, h >> 1));
    for (let k = 0; k < len; k++) {
      for (let a = 0; a < thick; a++) for (let b = 0; b < thick; b++) ctx.set(r + a, c + b, role);
      r += dr;
      c += dc;
      if (r < 0 || c < 0 || r >= h || c >= h) break;
    }
  }
  const blobs = 1 + (density >> 1);
  for (let b = 0; b < blobs; b++) {
    const role = 1 + prng.int(3);
    const cr = prng.int(h);
    const cc = prng.int(h);
    const rad = 1 + prng.int(3);
    for (let r = cr - rad; r <= cr + rad; r++) {
      for (let c = cc - rad; c <= cc + rad; c++) {
        if (Math.abs(r - cr) + Math.abs(c - cc) <= rad) ctx.set(r, c, role);
      }
    }
  }
}

/** Index of the canonical pixel that (r, c) copies under the symmetry. */
function canonical(r: number, c: number, side: number, symmetry: Symmetry): number {
  const mr = Math.min(r, side - 1 - r);
  const mc = Math.min(c, side - 1 - c);
  switch (symmetry) {
    case 'v':
      return r * side + mc;
    case 'vh':
      return mr * side + mc;
    case 'd':
      return Math.min(r, c) * side + Math.max(r, c);
    case 'vhd':
      return Math.min(mr, mc) * side + Math.max(mr, mc);
  }
}

export interface Speckle {
  /** Speckle pixels per thousand pixels. */
  readonly perMille: number;
  /** Its own stream, so a larger count adds pixels to the same positions instead of reshuffling them. */
  readonly prng: Prng;
}

export interface DrawOptions {
  readonly speckle?: Speckle;
  /** Draw at half resolution and scale up 2×: runs of at least 2 pixels, so easier Tiles. */
  readonly coarse?: boolean;
}

function drawAt(
  motif: MotifDef,
  side: number,
  density: Density,
  paper: PaletteId,
  roles: readonly number[],
  prng: Prng,
  speckle: Speckle | undefined,
): Uint8Array {
  const base = new Uint8Array(side * side).fill(paper);
  const ctx: DrawCtx = {
    side,
    width: featureWidth(density),
    density,
    prng,
    set(r, c, role) {
      if (r < 0 || c < 0 || r >= side || c >= side) return;
      base[r * side + c] = roles[role & 3] as number;
    },
  };
  if (motif.family === 'quilt') drawQuilt(motif.id, ctx);
  else if (motif.family === 'tessellation') drawTessellation(motif.id, ctx);
  else drawGlyph(ctx);

  const details = Math.floor((side * side * detailPerMille(density)) / 1000);
  for (let k = 0; k < details; k++) {
    const r = prng.int(side);
    const c = prng.int(side);
    const [dr, dc] = DIRS[2 * prng.int(4)] as readonly [number, number];
    const nr = Math.min(side - 1, Math.max(0, r + dr));
    const nc = Math.min(side - 1, Math.max(0, c + dc));
    base[r * side + c] = base[nr * side + nc] as number;
  }
  if (speckle) {
    // A speckle turns paper into an accent and an accent into paper, so it adds structure to every region.
    const count = Math.floor((side * side * speckle.perMille) / 1000);
    for (let k = 0; k < count; k++) {
      const r = speckle.prng.int(side);
      const c = speckle.prng.int(side);
      const accent = roles[1 + speckle.prng.int(3)] as number;
      base[r * side + c] = base[r * side + c] === paper ? accent : paper;
    }
  }
  base[0] = paper;

  const out = new Uint8Array(side * side);
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) out[r * side + c] = base[canonical(r, c, side, motif.symmetry)] as number;
  }
  return out;
}

/** Draws a symmetric Motif. Every pixel is a Palette id and pixel (0, 0) is the paper colour. */
export function drawMotif(
  motif: MotifDef,
  side: MosaicSide,
  density: Density,
  paper: PaletteId,
  prng: Prng,
  opts: DrawOptions = {},
): Uint8Array {
  const accents = shuffled(
    ([0, 1, 2, 3] as const).filter((p) => p !== paper),
    prng,
  );
  const roles = [paper, ...accents];
  if (!opts.coarse) return drawAt(motif, side, density, paper, roles, prng, opts.speckle);
  const half = side / 2;
  const small = drawAt(motif, half, density, paper, roles, prng, opts.speckle);
  const out = new Uint8Array(side * side);
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) out[r * side + c] = small[(r >> 1) * half + (c >> 1)] as number;
  }
  return out;
}
export function symmetryAxes(pixels: ArrayLike<number>, side: number): readonly Axis[] {
  const at = (r: number, c: number): number | undefined => pixels[r * side + c];
  const holds = (map: (r: number, c: number) => [number, number]): boolean => {
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
        const [mr, mc] = map(r, c);
        if (at(r, c) !== at(mr, mc)) return false;
      }
    }
    return true;
  };
  const axes: Axis[] = [];
  if (holds((r, c) => [r, side - 1 - c])) axes.push('vertical');
  if (holds((r, c) => [side - 1 - r, c])) axes.push('horizontal');
  if (holds((r, c) => [c, r])) axes.push('diagonal');
  if (holds((r, c) => [side - 1 - c, side - 1 - r])) axes.push('antidiagonal');
  return axes;
}
