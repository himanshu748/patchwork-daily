import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { context } from '@devvit/web/client';
import type { AssignResponse, ClientResult, SubmitAccepted } from '../../shared/api';
import { decodePostWire } from '../../shared/wire';
import type { EndEntry, ExtraTile } from '../end/EndCard';
import { EndCard } from '../end/EndCard';
import { TEXT } from '../lib/messages';
import { fromPostWire } from '../lib/mosaic-data';
import { createSoundPlayer } from '../lib/sound';
import { track } from '../lib/track';
import type { PlaySession } from '../play/PlayScreen';
import { PlayScreen } from '../play/PlayScreen';
import { requestAssign } from './boot';

/** Every screen of the game entry; later work steps add the views after 'error'. */
export type Screen = 'loading' | 'play' | 'stitching' | 'end' | 'mosaic' | 'credits' | 'vote' | 'editor' | 'review' | 'error';

type View =
  | { readonly screen: 'loading' }
  | { readonly screen: 'play'; readonly session: PlaySession }
  | { readonly screen: 'stitching' | 'end'; readonly entry: EndEntry }
  | { readonly screen: 'error'; readonly text: string; readonly retry: boolean };

const FIRST_INTERACTION_KEY = 'pw-first-interaction';

/** Logged-out players have no server flag, so `first_interaction` dedupes per session (design.md analytics table). */
function firstPracticeOpen(dayKey: string): boolean {
  try {
    const key = `${FIRST_INTERACTION_KEY}-${dayKey}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

export function App(props: { readonly initialAssign: Promise<ClientResult<AssignResponse>> }) {
  const [view, setView] = useState<View>({ screen: 'loading' });
  const sound = useMemo(createSoundPlayer, []);
  const [soundOn, setSoundOn] = useState(false);
  const ids = useRef(0);
  const post = useMemo(() => {
    const wire = decodePostWire(context.postData);
    return wire ? fromPostWire(wire) : null;
  }, []);

  const startPlay = useCallback((session: Omit<PlaySession, 'id'>, isExtra: boolean) => {
    track('tile_assigned', {
      dayKey: session.dayKey,
      dayNumber: session.dayNumber,
      tileIndex: session.tile.index,
      tileSize: session.tile.size,
      isExtra,
    });
    setView({ screen: 'play', session: { ...session, id: ++ids.current } });
  }, []);

  const handleAssign = useCallback(
    (res: ClientResult<AssignResponse>) => {
      if (!res.ok) {
        setView(
          res.code === 'NOT_A_PATCHWORK_POST'
            ? { screen: 'error', text: TEXT.notPatchwork, retry: false }
            : { screen: 'error', text: TEXT.assignFailed, retry: true },
        );
        return;
      }
      if (res.kind === 'scored-done') {
        setView({
          screen: 'end',
          entry: {
            id: ++ids.current,
            tileIndex: res.tileIndex,
            accepted: null,
            from: null,
            pixels: null,
            dayKey: post?.dayKey ?? null,
            dayNumber: post?.dayNumber ?? null,
            tileSize: post?.tileSize ?? null,
            offsetMs: null,
          },
        });
        return;
      }
      if (res.firstInteraction || (res.kind === 'practice' && firstPracticeOpen(res.dayKey))) {
        track('first_interaction', { dayKey: res.dayKey, dayNumber: res.dayNumber });
      }
      startPlay(
        {
          kind: res.kind,
          tile: res.tile,
          dayKey: res.dayKey,
          dayNumber: res.dayNumber,
          assignedAtMs: res.assignedAtMs,
          offsetMs: res.serverNowMs - Date.now(),
          showGhost: res.showGhost,
        },
        false,
      );
    },
    [post, startPlay],
  );

  const reassign = useCallback(() => {
    setView({ screen: 'loading' });
    void requestAssign().then(handleAssign);
  }, [handleAssign]);

  useEffect(() => {
    let live = true;
    void props.initialAssign.then((res) => {
      if (live) handleAssign(res);
    });
    return () => {
      live = false;
    };
    // The first assignment is requested once, before React mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAccepted = useCallback((session: PlaySession, accepted: SubmitAccepted, from: DOMRect, pixels: Uint8Array) => {
    const solveSeconds = Math.round((accepted.score?.solveMs ?? Date.now() + session.offsetMs - session.assignedAtMs) / 1000);
    const base = { dayKey: session.dayKey, dayNumber: session.dayNumber, tileIndex: session.tile.index, tileSize: session.tile.size };
    if (!accepted.alreadyStitched) {
      if (accepted.returnNextDay) track('return_next_day', { dayKey: session.dayKey, dayNumber: session.dayNumber });
      if (accepted.kind === 'scored') track('tile_solved', { ...base, solveSeconds, mistakes: accepted.score?.mistakes ?? 0 });
      else track('extra_tile_solved', { ...base, solveSeconds, isExtra: true });
    }
    setView({
      screen: 'stitching',
      entry: {
        id: ++ids.current,
        tileIndex: session.tile.index,
        accepted,
        from,
        pixels,
        dayKey: session.dayKey,
        dayNumber: session.dayNumber,
        tileSize: session.tile.size,
        offsetMs: session.offsetMs,
      },
    });
  }, []);

  const onExtra = useCallback(
    (res: ExtraTile) =>
      startPlay(
        {
          kind: 'extra',
          tile: res.tile,
          dayKey: res.dayKey,
          dayNumber: res.dayNumber,
          assignedAtMs: res.assignedAtMs,
          offsetMs: res.serverNowMs - Date.now(),
          showGhost: false,
        },
        true,
      ),
    [startPlay],
  );

  switch (view.screen) {
    case 'loading':
      return <main className="center" aria-busy="true" />;
    case 'error':
      return (
        <main className="center" role="alert">
          <p className="t-m">{view.text}</p>
          {view.retry && (
            <button type="button" className="button primary" onClick={reassign}>
              Retry
            </button>
          )}
        </main>
      );
    case 'play': {
      const session = view.session;
      return (
        <PlayScreen
          key={session.id}
          session={session}
          soundOn={soundOn}
          onToggleSound={() => {
            sound.setEnabled(!soundOn);
            setSoundOn(!soundOn);
          }}
          onAccepted={(accepted, from, pixels) => onAccepted(session, accepted, from, pixels)}
          onNewTile={reassign}
        />
      );
    }
    case 'stitching':
    case 'end': {
      const entry = view.entry;
      return (
        <EndCard
          key={entry.id}
          entry={entry}
          post={post}
          sound={sound}
          onStitched={() => setView({ screen: 'end', entry })}
          onExtra={onExtra}
          onReassign={reassign}
        />
      );
    }
  }
}
