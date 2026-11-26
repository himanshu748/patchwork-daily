import { useEffect, useRef, useState } from 'react';
import type { ClientResult, CreditsResponse } from '../../shared/api';
import type { MosaicSnapshot } from '../../shared/wire';
import { useColourMode } from '../app/hooks';
import { apiGet } from '../lib/api';
import { drawMosaic } from '../lib/mosaic-canvas';
import type { MosaicState } from '../lib/mosaic-data';
import { fromSnapshot } from '../lib/mosaic-data';

const CREDITS_TIMEOUT_MS = 8000;
const MOSAIC_TIMEOUT_MS = 10_000;

function nameOrUnavailable(name: string | null): string {
  return name ?? 'Unavailable user';
}

export function CreditsView(props: { readonly initial: MosaicState | null; readonly onBack: () => void }) {
  const mode = useColourMode();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [mosaic, setMosaic] = useState<MosaicState | null>(props.initial);
  const [credits, setCredits] = useState<ClientResult<CreditsResponse> | null>(null);
  const [loadId, setLoadId] = useState(0);

  useEffect(() => {
    let live = true;
    void apiGet<CreditsResponse>('/api/credits', CREDITS_TIMEOUT_MS).then((res) => {
      if (live) setCredits(res);
    });
    void apiGet<MosaicSnapshot>('/api/mosaic', MOSAIC_TIMEOUT_MS).then((res) => {
      if (!live || !res.ok) return;
      const next = fromSnapshot(res);
      if (next) setMosaic(next);
    });
    return () => {
      live = false;
    };
  }, [loadId]);

  useEffect(() => {
    if (!canvas.current || !mosaic) return;
    drawMosaic(canvas.current, { tileSize: mosaic.tileSize, tiles: mosaic.tiles, solveCounts: mosaic.solveCounts, heat: false, highlight: [], mode });
  }, [mosaic, mode]);

  const data = credits?.ok ? credits : null;
  return (
    <main className="credits-page">
      <header className="screen-head">
        <button type="button" className="button" onClick={props.onBack}>
          Back
        </button>
        <div>
          <h1 className="t-l">Credits</h1>
          {mosaic && <p className="t-s t-muted">Day {mosaic.dayNumber} · {mosaic.motifName}</p>}
        </div>
      </header>
      <canvas ref={canvas} className="mosaic-canvas" role="img" aria-label="Finished mosaic" />
      {data?.creator && <p className="t-m">Mosaic art by {nameOrUnavailable(data.creator.name)}</p>}
      {!data && credits && (
        <section className="center-inline" role="alert">
          <p className="t-m">Credits could not be loaded.</p>
          <button type="button" className="button primary" onClick={() => setLoadId((n) => n + 1)}>
            Retry
          </button>
        </section>
      )}
      {data && (
        <>
          <section className="credits-section">
            <h2 className="t-m">Top helpers</h2>
            {data.helpersExpired ? (
              <p className="t-s">Helper ranking has expired for this day.</p>
            ) : (
              <ol className="credits-list helpers">
                {data.topHelpers.map((h) => (
                  <li key={h.rank} className="credits-row">
                    <span className="t-s t-muted">#{h.rank}</span>
                    <span>{nameOrUnavailable(h.name)}</span>
                    <span className="t-mono">{h.helpCount}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="credits-section">
            <h2 className="t-m">First stitchers</h2>
            <ol className="credits-list firsts">
              {data.firstStitchers.map((entry) => (
                <li key={entry.tile} className="credits-row">
                  <span className="t-s t-muted">Tile {entry.tile}</span>
                  <span>{nameOrUnavailable(entry.name)}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
