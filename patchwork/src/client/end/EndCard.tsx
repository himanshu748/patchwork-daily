import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientResult, EndCardResponse, ExtraResponse, FlairResponse, ShareResponse, SubmitAccepted } from '../../shared/api';
import type { TileSize } from '../../shared/daykey';
import { msUntilNextUtcMidnight } from '../../shared/daykey';
import type { MosaicSnapshot } from '../../shared/wire';
import { useColourMode, useNow, useReducedMotion } from '../app/hooks';
import { apiGet, apiPost } from '../lib/api';
import { formatCountdown, formatDuration } from '../lib/format';
import { TEXT } from '../lib/messages';
import type { MosaicState } from '../lib/mosaic-data';
import { fromSnapshot, withTile } from '../lib/mosaic-data';
import { drawMosaic, drawTileImage, tileRectInPage } from '../lib/mosaic-canvas';
import type { SoundPlayer } from '../lib/sound';
import { track } from '../lib/track';
import { playStitch } from '../stitch/stitch-animation';

const ENDCARD_TIMEOUT_MS = 8000;
const MOSAIC_TIMEOUT_MS = 10_000;
const EXTRA_TIMEOUT_MS = 8000;
const SHARE_TIMEOUT_MS = 10_000;
const FLAIR_TIMEOUT_MS = 8000;

export type ExtraTile = Extract<ExtraResponse, { readonly tile: unknown }>;

/** What the End_Card opens with: a fresh Stitch to animate, or a Scored_Attempt finished earlier. */
export type EndEntry = {
  readonly id: number;
  readonly tileIndex: number | null;
  readonly accepted: SubmitAccepted | null;
  readonly from: DOMRect | null;
  readonly pixels: Uint8Array | null;
  readonly dayKey: string | null;
  readonly dayNumber: number | null;
  readonly tileSize: TileSize | null;
  /** Server clock minus device clock, when known. */
  readonly offsetMs: number | null;
};

function nonce(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${performance.now()}`;
}

function PercentileChart(props: { readonly counts: readonly number[]; readonly bucket: number; readonly value: number }) {
  const max = Math.max(1, ...props.counts);
  const label = `Faster than ${props.value}% of today's solvers`;
  return (
    <figure className="chart">
      <div className="chart-bars" role="img" aria-label={label}>
        {props.counts.map((c, i) => (
          <span
            key={i}
            className={i === props.bucket ? 'chart-bar mine' : 'chart-bar'}
            style={{ height: `${Math.max(c > 0 ? 6 : 0, Math.round((c / max) * 100))}%` }}
          />
        ))}
      </div>
      <figcaption className="t-s">{label}</figcaption>
    </figure>
  );
}

export function EndCard(props: {
  readonly entry: EndEntry;
  readonly post: MosaicState | null;
  readonly sound: SoundPlayer;
  readonly onStitched: () => void;
  readonly onExtra: (tile: ExtraTile) => void;
  readonly onReassign: () => void;
}) {
  const { entry, post, sound, onStitched, onExtra, onReassign } = props;
  const mode = useColourMode();
  const reducedMotion = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [mosaic, setMosaic] = useState<MosaicState | null>(post);
  const [landed, setLanded] = useState(!(entry.accepted && entry.from && entry.pixels));
  const [card, setCard] = useState<ClientResult<EndCardResponse> | null>(null);
  const [cardAt, setCardAt] = useState(0);
  const [extraPending, setExtraPending] = useState(false);
  const [extraError, setExtraError] = useState(false);
  const [sharePending, setSharePending] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [flair, setFlair] = useState<boolean | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    let live = true;
    void apiGet<EndCardResponse>('/api/endcard', ENDCARD_TIMEOUT_MS).then((res) => {
      if (!live) return;
      if (!res.ok && res.code === 'NO_RESULT') {
        onReassign();
        return;
      }
      setCard(res);
      setCardAt(Date.now());
      if (res.ok) setFlair(res.flairOptIn);
    });
    void apiGet<MosaicSnapshot>('/api/mosaic', MOSAIC_TIMEOUT_MS).then((res) => {
      if (!live || !res.ok) return;
      const next = fromSnapshot(res);
      if (next) setMosaic((held) => (!held || next.gen > held.gen || (next.gen === held.gen && next.stitched >= held.stitched) ? next : held));
    });
    return () => {
      live = false;
    };
    // One load per End_Card entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const shown = useMemo(() => {
    if (!mosaic) return null;
    if (landed && entry.tileIndex !== null && entry.pixels) return withTile(mosaic, entry.tileIndex, entry.pixels);
    return mosaic;
  }, [mosaic, landed, entry.tileIndex, entry.pixels]);

  const highlight = useMemo(() => {
    const mine = new Set(card?.ok ? card.myTiles : []);
    if (entry.tileIndex !== null && landed) mine.add(entry.tileIndex);
    return [...mine];
  }, [card, entry.tileIndex, landed]);

  useEffect(() => {
    if (!canvas.current || !shown) return;
    drawMosaic(canvas.current, { tileSize: shown.tileSize, tiles: shown.tiles, solveCounts: shown.solveCounts, heat: false, highlight, mode });
  }, [shown, highlight, mode]);

  useEffect(() => {
    if (landed) return;
    const { from, pixels, tileIndex } = entry;
    const target = canvas.current;
    const size = mosaic?.tileSize ?? entry.tileSize;
    if (!from || !pixels || tileIndex === null || !target || size === null) {
      setLanded(true);
      onStitched();
      return;
    }
    const img = document.createElement('canvas');
    drawTileImage(img, pixels, size, mode, from.width);
    void playStitch(from, tileRectInPage(target, tileIndex), img, { reducedMotion, sound }).then(() => {
      setLanded(true);
      onStitched();
    });
    // Runs once per entry; later theme or motion changes do not restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const helpAnother = async (): Promise<void> => {
    setExtraPending(true);
    setExtraError(false);
    const res = await apiPost<ExtraResponse>('/api/extra', {}, EXTRA_TIMEOUT_MS);
    setExtraPending(false);
    if (res.ok && res.kind !== 'complete') {
      onExtra(res);
      return;
    }
    if (!res.ok && res.code === 'SCORED_FIRST') {
      onReassign();
      return;
    }
    setExtraError(true);
  };

  const share = async (): Promise<void> => {
    setSharePending(true);
    setShareNote(null);
    const res = await apiPost<ShareResponse>('/api/share', { nonce: nonce() }, SHARE_TIMEOUT_MS);
    setSharePending(false);
    setShareNote(res.ok ? TEXT.commentPosted : TEXT.commentFailed);
    if (res.ok && entry.dayKey !== null && entry.dayNumber !== null) {
      track('share_comment', { dayKey: entry.dayKey, dayNumber: entry.dayNumber });
    }
  };

  const toggleFlair = async (on: boolean): Promise<void> => {
    const before = flair;
    setFlair(on);
    const res = await apiPost<FlairResponse>('/api/flair', { optIn: on }, FLAIR_TIMEOUT_MS);
    if (!res.ok) setFlair(before);
  };

  const data = card?.ok ? card : null;
  const result = data ? data.result : (entry.accepted?.score ?? null);
  const scoreNote = data ? data.scoreNote : (entry.accepted?.scoreNote ?? 'unavailable');

  let remaining: number | null = null;
  if (data) remaining = data.nextDayAtMs - (now + (data.serverNowMs - cardAt));
  else if (card && entry.offsetMs !== null) remaining = msUntilNextUtcMidnight(now + entry.offsetMs);
  const countdown = remaining === null ? null : remaining <= 0 ? TEXT.newPuzzle : `Next puzzle in ${formatCountdown(remaining)}`;

  return (
    <main className="end">
      <canvas ref={canvas} className="end-canvas" role="img" aria-label={shown ? `Mosaic, ${shown.stitched} of 64 tiles stitched` : 'Mosaic'} />
      {landed && (
        <div className="end-body">
          {shown && <p className="t-s t-muted">{`${shown.stitched}/64 stitched`}</p>}
          <section className="end-score">
            {result && scoreNote === 'ok' ? (
              <>
                <p className="t-s t-muted">Score</p>
                <p className="t-xl t-bold t-mono">{result.score}</p>
              </>
            ) : (
              <p className="t-m">{scoreNote === 'day-ended' ? TEXT.dayEnded : TEXT.scoreUnavailable}</p>
            )}
          </section>

          <dl className="end-stats">
            {result && (
              <>
                <div>
                  <dt className="t-xs t-muted">Time</dt>
                  <dd className="t-m t-mono">{formatDuration(result.solveMs)}</dd>
                </div>
                <div>
                  <dt className="t-xs t-muted">Par</dt>
                  <dd className="t-m t-mono">{formatDuration(result.parSeconds * 1000)}</dd>
                </div>
                <div>
                  <dt className="t-xs t-muted">Mistakes</dt>
                  <dd className="t-m t-mono">{result.mistakes}</dd>
                </div>
                <div>
                  <dt className="t-xs t-muted">Allowance</dt>
                  <dd className="t-m t-mono">{result.mistakeAllowance}</dd>
                </div>
              </>
            )}
            <div>
              <dt className="t-xs t-muted">Rank</dt>
              <dd className="t-m">
                {data?.rank.status === 'ok' ? `#${data.rank.position} of ${data.rank.total}` : card ? TEXT.rankingUnavailable : '…'}
              </dd>
            </div>
            <div>
              <dt className="t-xs t-muted">Tiles stitched today</dt>
              <dd className="t-m t-mono">{data && data.helpCount !== null ? data.helpCount : card ? TEXT.unavailable : '…'}</dd>
            </div>
            <div>
              <dt className="t-xs t-muted">Streak</dt>
              <dd className="t-m t-mono">{data?.streak ? `${data.streak.current}` : card ? TEXT.unavailable : '…'}</dd>
            </div>
          </dl>

          <section className="end-percentile">
            {data?.percentile.status === 'ok' ? (
              <PercentileChart counts={data.percentile.counts} bucket={data.percentile.bucket} value={data.percentile.value} />
            ) : data?.percentile.status === 'too-few' ? (
              <p className="t-s">{TEXT.notEnoughSolves}</p>
            ) : card ? (
              <p className="t-s">{TEXT.percentileUnavailable}</p>
            ) : null}
          </section>

          <div className="end-actions">
            <button type="button" className="button primary" disabled={extraPending} onClick={() => void helpAnother()}>
              Help another tile
            </button>
            {extraError && (
              <p className="t-s" role="status">
                {TEXT.extraFailed}
              </p>
            )}
            <button type="button" className="button" disabled={sharePending} onClick={() => void share()}>
              Share as comment
            </button>
            {shareNote && (
              <p className="t-s" role="status">
                {shareNote}
              </p>
            )}
            {flair !== null && (
              <label className="toggle t-s">
                <input type="checkbox" checked={flair} onChange={(e) => void toggleFlair(e.currentTarget.checked)} />
                Show streak flair
              </label>
            )}
          </div>

          {countdown && <p className="t-m t-mono end-countdown">{countdown}</p>}
        </div>
      )}
    </main>
  );
}
