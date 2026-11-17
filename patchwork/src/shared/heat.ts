import type { Pattern } from './palette';

export type HeatBand = 0 | 1 | 2 | 3 | 4;

export interface HeatBandDef {
  readonly band: HeatBand;
  readonly label: string;
  readonly min: number;
  readonly max: number | null;
  readonly pattern: Pattern | 'none';
  /** Overlay strength in percent; pairwise different. */
  readonly shade: number;
}

export const HEAT_BANDS: readonly HeatBandDef[] = [
  { band: 0, label: '0', min: 0, max: 0, pattern: 'none', shade: 0 },
  { band: 1, label: '1', min: 1, max: 1, pattern: 'dots', shade: 25 },
  { band: 2, label: '2 to 3', min: 2, max: 3, pattern: 'diagonal', shade: 50 },
  { band: 3, label: '4 to 7', min: 4, max: 7, pattern: 'cross', shade: 75 },
  { band: 4, label: '8 or more', min: 8, max: null, pattern: 'solid', shade: 100 },
];

export function heatBand(solveCount: number): HeatBand {
  if (solveCount >= 8) return 4;
  if (solveCount >= 4) return 3;
  if (solveCount >= 2) return 2;
  if (solveCount >= 1) return 1;
  return 0;
}
