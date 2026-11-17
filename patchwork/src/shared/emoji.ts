import type { TileSize } from './daykey';
import { isStitched } from './wire';

export interface EmojiGridInput {
  readonly dayNumber: number;
  readonly tileSize: TileSize;
  readonly solveSeconds: number | null;
  readonly parSeconds: number | null;
  readonly mistakes: number | null;
  readonly mistakeAllowance: number | null;
  readonly helpCount: number;
  readonly streak: number;
  /** 16 hex characters, one bit per Tile; carries no Cell data. */
  readonly stitchedMask: string;
  /** Tile_Indexes the user stitched. */
  readonly myTiles: readonly number[];
}

export const EMOJI_MINE = '🟩';
export const EMOJI_STITCHED = '🟦';
export const EMOJI_OPEN = '⬜';

/** 8 rows of 8 Tile symbols plus one result line. The input type has no field that can carry a Solution. */
export function buildEmojiGrid(input: EmojiGridInput): string {
  const mine = new Set(input.myTiles);
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    for (let c = 0; c < 8; c++) {
      const t = r * 8 + c;
      row += mine.has(t) ? EMOJI_MINE : isStitched(input.stitchedMask, t) ? EMOJI_STITCHED : EMOJI_OPEN;
    }
    rows.push(row);
  }
  const parts = [`Patchwork Day ${input.dayNumber} · ${input.tileSize}×${input.tileSize}`];
  if (input.solveSeconds !== null && input.parSeconds !== null) parts.push(`${input.solveSeconds}s / ${input.parSeconds}s par`);
  if (input.mistakes !== null && input.mistakeAllowance !== null) parts.push(`${input.mistakes}/${input.mistakeAllowance} mistakes`);
  parts.push(`${input.helpCount} ${input.helpCount === 1 ? 'stitch' : 'stitches'}`);
  parts.push(`${input.streak}-day streak`);
  rows.push(parts.join(' · '));
  return rows.join('\n');
}

/** Reddit markdown: two trailing spaces keep each grid row on its own line. */
export function composeShareComment(username: string, grid: string): string {
  return `u/${username} stitched today's Patchwork:\n\n${grid.split('\n').join('  \n')}`;
}
