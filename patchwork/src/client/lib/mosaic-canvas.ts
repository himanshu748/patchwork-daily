import type { TileSize } from '../../shared/daykey';
import { HEAT_BANDS, heatBand } from '../../shared/heat';
import { PALETTE, THEME, contrastRatio } from '../../shared/palette';
import type { ColourMode, Hex, Pattern } from '../../shared/palette';

export interface MosaicRenderInput {
  readonly tileSize: TileSize;
  /** One entry per Tile_Index; null draws the uniform unstitched placeholder. */
  readonly tiles: readonly (Uint8Array | null)[];
  readonly solveCounts: readonly number[] | null;
  readonly heat: boolean;
  readonly highlight: readonly number[];
  readonly mode: ColourMode;
}

/** Paper or ink, whichever stands out more on the colour, so the pattern stays visible. */
function patternInk(fill: Hex, mode: ColourMode): Hex {
  const t = THEME[mode];
  return contrastRatio(fill, t.paper) >= contrastRatio(fill, t.ink) ? t.paper : t.ink;
}

function drawPattern(ctx: CanvasRenderingContext2D, pattern: Pattern | 'none', x: number, y: number, s: number): void {
  if (pattern === 'solid' || pattern === 'none' || s < 3) return;
  const lw = Math.max(1, Math.round(s / 6));
  if (pattern === 'dots') {
    const d = Math.max(1, Math.round(s / 3));
    ctx.fillRect(x + Math.floor((s - d) / 2), y + Math.floor((s - d) / 2), d, d);
    return;
  }
  ctx.lineWidth = lw;
  ctx.beginPath();
  if (pattern === 'diagonal') {
    ctx.moveTo(x, y + s);
    ctx.lineTo(x + s, y);
  } else {
    ctx.moveTo(x + s / 2, y + 1);
    ctx.lineTo(x + s / 2, y + s - 1);
    ctx.moveTo(x + 1, y + s / 2);
    ctx.lineTo(x + s - 1, y + s / 2);
  }
  ctx.stroke();
}

/** Draws one Tile's pixels (Palette ids 0 to 3) with each colour's pattern at `px` device pixels per pixel. */
function paintTile(ctx: CanvasRenderingContext2D, pixels: Uint8Array, size: TileSize, x0: number, y0: number, px: number, mode: ColourMode): void {
  for (let i = 0; i < pixels.length; i++) {
    const entry = PALETTE[(pixels[i] ?? 0) & 3];
    if (!entry) continue;
    const fill = mode === 'light' ? entry.light : entry.dark;
    const x = x0 + (i % size) * px;
    const y = y0 + Math.floor(i / size) * px;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, px, px);
    if (entry.pattern !== 'solid') {
      const ink = patternInk(fill, mode);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = ink;
      ctx.strokeStyle = ink;
      drawPattern(ctx, entry.pattern, x, y, px);
      ctx.restore();
    }
  }
}

function placeholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, mode: ColourMode, unit: number): void {
  const t = THEME[mode];
  ctx.fillStyle = t.placeholder;
  ctx.fillRect(x, y, w, w);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, w);
  ctx.clip();
  ctx.strokeStyle = t.gridLine;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(1, Math.round(unit / 2));
  const step = Math.max(4, unit * 3);
  ctx.beginPath();
  for (let d = -w; d < w; d += step) {
    ctx.moveTo(x + d, y + w);
    ctx.lineTo(x + d + w, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Sizes the backing store to whole device pixels per Mosaic pixel and returns that scale. */
function fit(canvas: HTMLCanvasElement, side: number): number {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.width || side;
  const px = Math.max(1, Math.floor((cssWidth * dpr) / side));
  if (canvas.width !== px * side) canvas.width = px * side;
  if (canvas.height !== px * side) canvas.height = px * side;
  return px;
}

export function drawMosaic(canvas: HTMLCanvasElement, input: MosaicRenderInput): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const n = input.tileSize;
  const px = fit(canvas, 8 * n);
  const tileW = px * n;
  const t = THEME[input.mode];
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 64; i++) {
    const x = (i % 8) * tileW;
    const y = Math.floor(i / 8) * tileW;
    const pixels = input.tiles[i];
    if (pixels && pixels.length === n * n) paintTile(ctx, pixels, n, x, y, px, input.mode);
    else placeholder(ctx, x, y, tileW, input.mode, px);

    if (input.heat && input.solveCounts) {
      const band = HEAT_BANDS[heatBand(input.solveCounts[i] ?? 0)];
      if (band && band.shade > 0) {
        ctx.save();
        ctx.globalAlpha = (band.shade / 100) * 0.6;
        ctx.fillStyle = t.ink;
        ctx.fillRect(x, y, tileW, tileW);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = t.paper;
        ctx.strokeStyle = t.paper;
        drawPattern(ctx, band.pattern, x + tileW / 4, y + tileW / 4, tileW / 2);
        ctx.restore();
      }
    }
  }

  // Seams between Tiles.
  ctx.save();
  ctx.strokeStyle = t.gridLine;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.beginPath();
  for (let k = 1; k < 8; k++) {
    ctx.moveTo(k * tileW, 0);
    ctx.lineTo(k * tileW, canvas.height);
    ctx.moveTo(0, k * tileW);
    ctx.lineTo(canvas.width, k * tileW);
  }
  ctx.stroke();
  ctx.restore();

  // Highlighted Tiles: a two-band outline plus a corner notch no other Tile has (Req 17.5).
  const ring = Math.max(2, Math.round(2 * dpr));
  for (const i of input.highlight) {
    if (!Number.isInteger(i) || i < 0 || i > 63) continue;
    const x = (i % 8) * tileW;
    const y = Math.floor(i / 8) * tileW;
    ctx.lineWidth = ring;
    ctx.strokeStyle = t.focusHalo;
    ctx.strokeRect(x + ring * 1.5, y + ring * 1.5, tileW - ring * 3, tileW - ring * 3);
    ctx.strokeStyle = t.focus;
    ctx.strokeRect(x + ring / 2, y + ring / 2, tileW - ring, tileW - ring);
    const notch = Math.max(ring * 2, Math.round(tileW / 3));
    ctx.fillStyle = t.focus;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + notch, y);
    ctx.lineTo(x, y + notch);
    ctx.closePath();
    ctx.fill();
  }
}

/** A single solved Tile for the Stitch_Animation, `cssSize` CSS px square. */
export function drawTileImage(canvas: HTMLCanvasElement, pixels: Uint8Array, size: TileSize, mode: ColourMode, cssSize: number): void {
  const dpr = window.devicePixelRatio || 1;
  const px = Math.max(1, Math.floor((cssSize * dpr) / size));
  canvas.width = px * size;
  canvas.height = px * size;
  const ctx = canvas.getContext('2d');
  if (ctx) paintTile(ctx, pixels, size, 0, 0, px, mode);
}

export function tileRectInPage(canvas: HTMLCanvasElement, tileIndex: number): DOMRect {
  const r = canvas.getBoundingClientRect();
  const w = r.width / 8;
  const h = r.height / 8;
  return new DOMRect(r.left + (tileIndex % 8) * w, r.top + Math.floor(tileIndex / 8) * h, w, h);
}
