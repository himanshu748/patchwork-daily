import './tokens.css';
import './launch.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import type { MosaicSnapshot } from '../shared/wire';
import { decodePostWire } from '../shared/wire';
import { apiGet } from './lib/api';
import { launchStatus } from './lib/format';
import { TEXT } from './lib/messages';
import type { MosaicState } from './lib/mosaic-data';
import { fromPostWire, fromSnapshot } from './lib/mosaic-data';
import { drawMosaic } from './lib/mosaic-canvas';
import { currentMode, watchMode } from './lib/theme';
import { track } from './lib/track';

const MOSAIC_TIMEOUT_MS = 5000;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Paints from `postData` without a server call, refreshes from /api/mosaic, and opens the game on a tap (Req 8.1 to Req 8.4, Req 8.7). */
export function bootLaunch(): void {
  const canvas = byId<HTMLCanvasElement>('mosaic');
  const status = byId<HTMLParagraphElement>('status');
  const motif = byId<HTMLParagraphElement>('motif');
  const invite = byId<HTMLParagraphElement>('invite');
  const play = byId<HTMLButtonElement>('play');
  if (!canvas || !status || !motif || !invite || !play) return;

  const wire = decodePostWire(context.postData);
  let shown: MosaicState | null = wire ? fromPostWire(wire) : null;
  const dayNumber = wire?.n ?? null;

  const render = (): void => {
    const mode = currentMode();
    if (shown) {
      drawMosaic(canvas, { tileSize: shown.tileSize, tiles: shown.tiles, solveCounts: null, heat: false, highlight: [], mode });
      status.textContent = launchStatus(shown.dayNumber, shown.stitched);
      motif.textContent = shown.motifName;
      invite.textContent = TEXT.firstStitch;
      invite.hidden = shown.stitched !== 0;
    } else {
      // No snapshot: an all-blank grid and "Day N" when postData gave N (L4).
      drawMosaic(canvas, { tileSize: wire?.z ?? 5, tiles: [], solveCounts: null, heat: false, highlight: [], mode });
      status.textContent = dayNumber === null ? '' : `Day ${dayNumber}`;
      motif.textContent = '';
      invite.hidden = true;
    }
  };

  play.addEventListener('click', (event) => {
    requestExpandedMode(event, 'game');
  });
  watchMode(render);
  window.addEventListener('resize', render);
  render();
  track('post_view', wire ? { dayKey: wire.d, dayNumber: wire.n } : {});

  void apiGet<MosaicSnapshot>('/api/mosaic', MOSAIC_TIMEOUT_MS).then((res) => {
    if (!res.ok) return;
    const next = fromSnapshot(res);
    if (!next || (shown && next.gen < shown.gen)) return;
    shown = next;
    render();
  });
}

bootLaunch();
