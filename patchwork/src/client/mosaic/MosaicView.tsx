import { useEffect, useRef, useState } from 'react';
import type { MosaicSnapshot } from '../../shared/wire';
import { HEAT_BANDS } from '../../shared/heat';
import { useColourMode } from '../app/hooks';
import { drawMosaic } from '../lib/mosaic-canvas';
import type { MosaicState } from '../lib/mosaic-data';
import { fromSnapshot } from '../lib/mosaic-data';
import { watchMosaic } from '../lib/live';

export function MosaicView(props: {
  readonly initial: MosaicState | null;
  readonly onBack: () => void;
  readonly onCredits?: () => void;
}) {
  const mode = useColourMode();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [mosaic, setMosaic] = useState<MosaicState | null>(props.initial);
  const [heat, setHeat] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!mosaic) return;
    return watchMosaic(
      mosaic.dayKey,
      (snap: MosaicSnapshot) => {
        const next = fromSnapshot(snap);
        if (!next) return;
        setMosaic((held) => (!held || next.gen > held.gen || (next.gen === held.gen && next.stitched >= held.stitched) ? next : held));
      },
      setStale,
    );
    // One watcher per Day_Key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mosaic?.dayKey]);

  useEffect(() => {
    if (!canvas.current || !mosaic) return;
    drawMosaic(canvas.current, { tileSize: mosaic.tileSize, tiles: mosaic.tiles, solveCounts: mosaic.solveCounts, heat, highlight: [], mode });
  }, [mosaic, heat, mode]);

  return (
    <main className="mosaic-page">
      <header className="screen-head">
        <button type="button" className="button" onClick={props.onBack}>
          Back
        </button>
        <div>
          <h1 className="t-l">Day {mosaic?.dayNumber ?? ''}</h1>
          {mosaic && <p className="t-s t-muted">{mosaic.motifName}</p>}
        </div>
      </header>
      <canvas ref={canvas} className="mosaic-canvas" role="img" aria-label={mosaic ? `Mosaic, ${mosaic.stitched} of 64 tiles stitched` : 'Mosaic'} />
      {mosaic ? <p className="t-m t-mono">{mosaic.stitched}/64</p> : <p className="t-m">Mosaic not available yet.</p>}
      {mosaic?.stitched === 0 && <p className="t-s">Be the first stitch today</p>}
      {stale && (
        <p className="t-s" role="status">
          Mosaic may be out of date
        </p>
      )}
      <label className="toggle t-s">
        <input type="checkbox" checked={heat} onChange={(e) => setHeat(e.currentTarget.checked)} />
        Heat overlay
      </label>
      {heat && (
        <ul className="heat-legend" aria-label="Heat overlay legend">
          {HEAT_BANDS.map((band) => (
            <li key={band.band} className={`heat-chip heat-${band.band} t-s`}>
              {band.label}
            </li>
          ))}
        </ul>
      )}
      {mosaic?.complete && props.onCredits && (
        <button type="button" className="button primary" onClick={props.onCredits}>
          Credits
        </button>
      )}
    </main>
  );
}
