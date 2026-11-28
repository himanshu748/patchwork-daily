import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { showLoginPrompt } from '@devvit/web/client';
import type { SubmitAccepted, SubmitResponse, TileWire } from '../../shared/api';
import type { Clues } from '../../shared/clues';
import { lineMatches } from '../../shared/clues';
import { planGhostRow } from '../../shared/ghost';
import type { CellState } from '../../shared/grid';
import { encodeGrid, filledMask } from '../../shared/grid';
import type { PlayAction, PlayState } from '../../shared/play';
import { initialPlayState, playReducer } from '../../shared/play';
import { unpackTilePixels } from '../../shared/wire';
import { useNow, useReducedMotion, useViewportWidth } from '../app/hooks';
import { apiPost } from '../lib/api';
import { formatDuration, playLayout } from '../lib/format';
import type { SubmitFailureAction } from '../lib/messages';
import { TEXT, submitFailure } from '../lib/messages';
import { GhostHand } from './GhostHand';
import { useCellInput } from './useCellInput';

export const SUBMIT_TIMEOUT_MS = 10_000;
const GHOST_SEEN_TIMEOUT_MS = 5000;

export type PlaySession = {
  readonly id: number;
  readonly kind: 'scored' | 'late' | 'practice' | 'extra';
  readonly tile: TileWire;
  readonly dayKey: string;
  readonly dayNumber: number;
  readonly assignedAtMs: number;
  /** Server clock minus device clock, from the assign response. */
  readonly offsetMs: number;
  readonly showGhost: boolean;
};

type Msg = { readonly action: PlayAction; readonly check: boolean };

type Notice = { readonly text: string; readonly action: SubmitFailureAction | null };

const CELL_LABEL: Readonly<Record<CellState, string>> = { 0: 'empty', 1: 'filled', 2: 'marked X' };

function column(cells: Uint8Array, size: number, c: number): CellState[] {
  const out: CellState[] = [];
  for (let r = 0; r < size; r++) out.push((cells[r * size + c] ?? 0) as CellState);
  return out;
}

function row(cells: Uint8Array, size: number, r: number): CellState[] {
  return Array.from(cells.subarray(r * size, r * size + size)) as CellState[];
}

export function PlayScreen(props: {
  readonly session: PlaySession;
  readonly soundOn: boolean;
  readonly onToggleSound: () => void;
  readonly onAccepted: (accepted: SubmitAccepted, from: DOMRect, pixels: Uint8Array) => void;
  readonly onNewTile: () => void;
}) {
  const { session, soundOn, onToggleSound, onAccepted, onNewTile } = props;
  const { tile } = session;
  const size = tile.size;
  const clueId = useId();
  const clues = useMemo<Clues>(() => ({ size, rows: tile.rowClues, cols: tile.colClues }), [size, tile]);
  const [state, send] = useReducer(
    (s: PlayState, m: Msg) => (m.check ? playReducer(s, m.action, clues) : playReducer(s, m.action)),
    size,
    (n) => initialPlayState(n),
  );
  const dispatch = useCallback((action: PlayAction) => send({ action, check: true }), []);
  const unlock = useCallback((cells: Uint8Array) => send({ action: { type: 'reset', cells }, check: false }), []);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const lastGrid = useRef<string | null>(null);
  const gridEl = useRef<HTMLDivElement | null>(null);

  const reducedMotion = useReducedMotion();
  const [ghost, setGhost] = useState(() => (session.showGhost && session.kind !== 'practice' ? planGhostRow(clues) : null));
  const ghostReported = useRef(false);
  const stopGhost = useCallback(() => {
    setGhost(null);
    if (ghostReported.current || !session.showGhost || session.kind === 'practice') return;
    ghostReported.current = true;
    void apiPost('/api/ghost-seen', {}, GHOST_SEEN_TIMEOUT_MS);
  }, [session.showGhost, session.kind]);

  const { gridProps, focusCell } = useCellInput(size, dispatch, {
    disabled: state.locked,
    onInput: () => {
      if (ghost) stopGhost();
      if (notice && notice.action !== 'login') setNotice(null);
    },
  });

  const submit = useCallback(
    async (grid: string, cells: Uint8Array) => {
      lastGrid.current = grid;
      if (session.kind === 'practice') {
        // Logged out: nothing is sent, so zero Stitches and zero Mistakes are recorded (Req 11.11, D11).
        setNotice({ text: TEXT.loginToStitch, action: 'login' });
        unlock(cells);
        return;
      }
      setSubmitting(true);
      setNotice(null);
      const res = await apiPost<SubmitResponse>(
        '/api/submit',
        { dayKey: session.dayKey, gen: tile.gen, tileIndex: tile.index, grid },
        SUBMIT_TIMEOUT_MS,
      );
      setSubmitting(false);
      if (res.ok && res.result === 'accepted') {
        let pixels = unpackTilePixels(res.tilePixels, size);
        if (!pixels) {
          console.warn('Stitched tile pixels could not be decoded');
          pixels = filledMask(cells);
        }
        const rect = gridEl.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
        onAccepted(res, rect, pixels);
        return;
      }
      if (res.ok) {
        setNotice({ text: TEXT.rejected, action: null });
        setShake(true);
      } else {
        setNotice(submitFailure(res.code));
      }
      unlock(cells);
    },
    [session.kind, session.dayKey, tile.gen, tile.index, size, unlock, onAccepted],
  );

  useEffect(() => {
    if (state.submit && !submitting) void submit(encodeGrid(state.cells as unknown as ArrayLike<CellState>), state.cells);
    // Fires once per completed grid: `submit` locks the state until the request settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.submit]);

  const onNoticeAction = (): void => {
    if (!notice) return;
    if (notice.action === 'login') showLoginPrompt();
    else if (notice.action === 'new-tile') onNewTile();
    else if (notice.action === 'retry' && lastGrid.current) void submit(lastGrid.current, state.cells);
  };

  const now = useNow(1000);
  const elapsed = now + session.offsetMs - session.assignedAtMs;
  const viewport = useViewportWidth();
  const layout = playLayout(size, viewport);
  const cells = state.cells;

  return (
    <main className="play" aria-busy={submitting}>
      <div className="play-bar">
        <span className="t-m t-mono" aria-label="Solve time">
          {formatDuration(elapsed)}
        </span>
        <div className="play-toggles">
          <button
            type="button"
            className="button"
            aria-pressed={state.markMode}
            onClick={() => dispatch({ type: 'markMode', on: !state.markMode })}
          >
            Mark X
          </button>
          <button type="button" className="button" aria-pressed={soundOn} onClick={onToggleSound}>
            {soundOn ? 'Sound on' : 'Sound off'}
          </button>
        </div>
      </div>

      <div
        className="board"
        style={{
          gridTemplateColumns: `${layout.rowClueWidth}px ${size * layout.cell}px`,
          gridTemplateRows: `${layout.colClueHeight}px ${size * layout.cell}px`,
        }}
      >
        <div />
        <div className="col-clues" style={{ gridTemplateColumns: `repeat(${size}, ${layout.cell}px)` }}>
          {clues.cols.map((clue, c) => (
            <div key={c} className={lineMatches(column(cells, size, c), clue) ? 'clue col done' : 'clue col'}>
              <span id={`${clueId}-col-${c}`} hidden>Column clue: {clue.join(', ') || '0'}</span>
              {(clue.length ? clue : [0]).map((v, i) => (
                <span key={i} className="t-xs">
                  {v}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="row-clues" style={{ gridTemplateRows: `repeat(${size}, ${layout.cell}px)` }}>
          {clues.rows.map((clue, r) => (
            <div key={r} className={lineMatches(row(cells, size, r), clue) ? 'clue row done' : 'clue row'}>
              <span id={`${clueId}-row-${r}`} hidden>Row clue: {clue.join(', ') || '0'}</span>
              {(clue.length ? clue : [0]).map((v, i) => (
                <span key={i} className="t-xs">
                  {v}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div
          className={shake ? 'grid-wrap shake' : 'grid-wrap'}
          ref={gridEl}
          onAnimationEnd={() => setShake(false)}
        >
          <div
            className="grid"
            role="grid"
            aria-label={`Tile ${tile.index + 1}, ${size} by ${size}`}
            style={{ gridTemplateColumns: `repeat(${size}, ${layout.cell}px)`, gridAutoRows: `${layout.cell}px` }}
            {...gridProps}
          >
            {Array.from({ length: size }, (_, r) => (
              <div key={r} role="row" className="grid-row">
                {Array.from({ length: size }, (_, c) => {
                  const i = r * size + c;
                  const v = (cells[i] ?? 0) as CellState;
                  return (
                    <button
                      key={i}
                      type="button"
                      role="gridcell"
                      data-cell={i}
                      tabIndex={i === focusCell ? 0 : -1}
                      className={v === 1 ? 'cell filled' : v === 2 ? 'cell marked' : 'cell'}
                      aria-label={`Row ${r + 1}, column ${c + 1}, ${CELL_LABEL[v]}`}
                      aria-describedby={`${clueId}-row-${r} ${clueId}-col-${c}`}
                    >
                      {v === 2 ? '✕' : ''}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {ghost && <GhostHand plan={ghost} cell={layout.cell} reducedMotion={reducedMotion} onDone={stopGhost} />}
        </div>
      </div>

      <div className="play-notice" role="status" aria-live="polite">
        {notice && (
          <>
            <p className="t-s">{notice.text}</p>
            {notice.action && (
              <button type="button" className="button" onClick={onNoticeAction}>
                {notice.action === 'login' ? 'Log in' : notice.action === 'new-tile' ? 'Get a new tile' : 'Retry'}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
