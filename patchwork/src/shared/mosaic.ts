import type { DayKey, TileSize } from './daykey';
import { addDays, assertDayKey, dayOrdinal, tileSizeFor, utcWeekday } from './daykey';
import type { MosaicFamily, MosaicSide, MotifDef } from './motifs';
import { MOTIFS, densityFor, drawMotif, motifName, motifOrder } from './motifs';
import type { PaletteId } from './palette';
import { createPrng, seedFor } from './prng';
import type { SliceOk } from './slicer';
import { sliceToTiles } from './slicer';

export type { MosaicSide } from './motifs';

export type MosaicSource = {
  readonly kind: 'procedural';
  readonly seed: number;
  readonly motifIndex: number;
  readonly motifId: string;
  /** Index into CANDIDATE_SETTINGS of the accepted candidate. */
  readonly variant: number;
};

export interface Mosaic {
  readonly dayKey: DayKey;
  readonly side: MosaicSide;
  readonly tileSize: TileSize;
  /** PaletteId per pixel, row-major, side × side. */
  readonly pixels: Uint8Array;
  readonly paper: PaletteId;
  readonly motifName: string;
  readonly family: MosaicFamily;
  readonly source: MosaicSource;
}

export interface GenerateOptions {
  /** Regeneration_Seed; 0 for generation 0. */
  readonly seed?: number;
  /** Index into motifOrder(dayKey); "skip" adds 1. */
  readonly motifIndex?: number;
}

export interface BuiltDay {
  readonly mosaic: Mosaic;
  readonly slice: SliceOk;
  /** Sum of the 64 final Difficulty_Scores. */
  readonly difficultySum: number;
  readonly meanDifficulty: number;
}

export interface CandidateSetting {
  /** Draw at half resolution and scale up 2×. */
  readonly coarse: boolean;
  /** Mirrored speckle pixels per thousand. */
  readonly speckle: number;
}

/**
 * The candidates every day tries, calibrated in step 2 (D29). They share one Motif drawing seed and differ
 * only in coarseness and speckle, so the search changes difficulty without changing the Motif.
 */
export const CANDIDATE_SETTINGS: readonly CandidateSetting[] = [
  { coarse: true, speckle: 0 },
  { coarse: false, speckle: 0 },
  { coarse: true, speckle: 150 },
  { coarse: false, speckle: 150 },
  { coarse: false, speckle: 300 },
];
export const CANDIDATES_PER_DAY = CANDIDATE_SETTINGS.length;

function motifAt(d: DayKey, motifIndex: number): MotifDef {
  const order = motifOrder(d);
  const idx = order[((motifIndex % order.length) + order.length) % order.length] as number;
  return MOTIFS[idx] as MotifDef;
}

/** Builds one candidate. Exported for the calibration and determinism tests. */
export function buildCandidate(d: DayKey, seed: number, motifIndex: number, variant: number, setting: CandidateSetting): BuiltDay {
  const n = tileSizeFor(d);
  const side = (8 * n) as MosaicSide;
  const motif = motifAt(d, motifIndex);
  const paper = (((dayOrdinal(d) % 4) + 4) % 4) as PaletteId;
  const prng = createPrng(seedFor('pw', d, seed, motifIndex));
  const pixels = drawMotif(motif, side, densityFor(utcWeekday(d)), paper, prng, {
    coarse: setting.coarse,
    speckle: { perMille: setting.speckle, prng: createPrng(seedFor('pw-speckle', d, seed, motifIndex)) },
  });
  const name = motifName(motif, prng);
  const mosaic: Mosaic = {
    dayKey: d,
    side,
    tileSize: n,
    pixels,
    paper,
    motifName: name,
    family: motif.family,
    source: { kind: 'procedural', seed, motifIndex, motifId: motif.id, variant },
  };
  const slice = sliceToTiles(mosaic, d);
  if (!slice.ok) throw new Error('Procedural slicing always resolves with fallback allowed');
  const difficultySum = slice.tiles.reduce((s, t) => s + t.difficulty, 0);
  return { mosaic, slice, difficultySum, meanDifficulty: difficultySum / 64 };
}

// Generation-0 difficulty sums, memoised because each day's target depends on the day before it.
const referenceSums = new Map<string, number>();
const REFERENCE_CACHE_LIMIT = 512;

/**
 * Sum the previous day of the same Monday-to-Sunday week reached with its generation-0 Mosaic, or null on a
 * Monday. Later regenerations of that day do not move the target, so every Day_Key keeps one fixed target.
 */
export function previousDaySum(d: DayKey): number | null {
  if (utcWeekday(d) === 1) return null;
  const prev = addDays(d, -1);
  const cached = referenceSums.get(prev);
  if (cached !== undefined) return cached;
  const sum = chooseCandidate(prev, 0, 0).difficultySum;
  if (referenceSums.size >= REFERENCE_CACHE_LIMIT) referenceSums.clear();
  referenceSums.set(prev, sum);
  return sum;
}

/**
 * Monday takes its easiest candidate. Every later day takes the easiest candidate whose sum is at least the
 * previous day's (strictly more on Thursday, the first 6×6 day), so the week never gets easier; if no
 * candidate reaches it, the hardest one is used and the 120-day test reports the miss.
 */
function chooseCandidate(d: DayKey, seed: number, motifIndex: number): BuiltDay {
  const prev = previousDaySum(d);
  const strict = utcWeekday(d) === 4;
  const candidates = CANDIDATE_SETTINGS.map((s, v) => buildCandidate(d, seed, motifIndex, v, s));
  const meets = (b: BuiltDay): boolean => prev === null || (strict ? b.difficultySum > prev : b.difficultySum >= prev);
  let pick: BuiltDay | null = null;
  for (const c of candidates) {
    if (meets(c) && (pick === null || c.difficultySum < pick.difficultySum)) pick = c;
  }
  if (pick) return pick;
  for (const c of candidates) {
    if (pick === null || c.difficultySum > pick.difficultySum) pick = c;
  }
  return pick as BuiltDay;
}

/** Generates the day's Mosaic and its accepted slice together; the Server stores this and never slices twice. */
export function buildDay(dayKey: string, opts: GenerateOptions = {}): BuiltDay {
  const d = assertDayKey(dayKey);
  return chooseCandidate(d, opts.seed ?? 0, opts.motifIndex ?? 0);
}

/** The daily post title (Req 7.2). */
export function postTitle(dayNumber: number, motifName: string): string {
  return `Day ${dayNumber} · ${motifName}`;
}

/** Throws InvalidDayKeyError for anything other than a real yyyy-mm-dd date. */
export function generateMosaic(dayKey: string, opts: GenerateOptions = {}): Mosaic {
  return buildDay(dayKey, opts).mosaic;
}
