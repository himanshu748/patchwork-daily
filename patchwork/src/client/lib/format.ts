import type { TileSize } from '../../shared/daykey';

/** m:ss, or h:mm:ss from one hour; negative values count as 0. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** HH:MM:SS until the target, never below 00:00:00 (Req 17.7). */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export function launchStatus(dayNumber: number, stitched: number): string {
  return `Day ${dayNumber} · ${stitched}/64 stitched`;
}

export const CELL_MIN_PX = 44;
export const CELL_MAX_PX = 56;
/** Smallest type step (12 px) needs about 7 px per digit and 4 px between numbers. */
const DIGIT_PX = 7;
const GAP_PX = 4;
export const PAGE_PAD_PX = 4;

export interface PlayLayout {
  readonly cell: number;
  readonly rowClueWidth: number;
  readonly colClueHeight: number;
  readonly width: number;
}

/** Widest row Clue (in px) the layout must fit: at most ceil(n / 2) numbers of one digit each. */
export function maxRowClueWidth(size: TileSize): number {
  const numbers = Math.ceil(size / 2);
  return numbers * DIGIT_PX + (numbers - 1) * GAP_PX + GAP_PX;
}

/**
 * Cells are at least 44 px (Req 26.7) and grow to 56 px when there is room. At 360 px Tile_Size 7 gives
 * 7 × 44 = 308 px of grid and leaves 52 px for the row Clues and the page padding (Req 10.7).
 */
export function playLayout(size: TileSize, viewportWidth: number): PlayLayout {
  const rowClueWidth = maxRowClueWidth(size);
  const room = viewportWidth - 2 * PAGE_PAD_PX - rowClueWidth;
  const cell = Math.max(CELL_MIN_PX, Math.min(CELL_MAX_PX, Math.floor(room / size)));
  const colClueHeight = Math.ceil(size / 2) * 16 + GAP_PX;
  return { cell, rowClueWidth, colClueHeight, width: rowClueWidth + size * cell + 2 * PAGE_PAD_PX };
}
