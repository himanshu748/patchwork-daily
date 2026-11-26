import { connectRealtime } from '@devvit/web/client';
import type { Connection } from '@devvit/web/client';
import type { JsonValue } from '@devvit/shared';
import type { MosaicSnapshot } from '../../shared/wire';
import { isNewerSnapshot } from '../../shared/wire';
import { apiGet } from './api';

const MOSAIC_TIMEOUT_MS = 10_000;
const POLL_MS = 15_000;
const STALE_AFTER_FAILURES = 3;

type RealtimeMosaic = {
  readonly t?: JsonValue;
  readonly d?: JsonValue;
  readonly g?: JsonValue;
  readonly v?: JsonValue;
  readonly s?: JsonValue;
  readonly k?: JsonValue;
  readonly p?: JsonValue;
  readonly n?: JsonValue;
  readonly c?: JsonValue;
};

function mergeMessage(base: MosaicSnapshot | null, msg: RealtimeMosaic): MosaicSnapshot | null {
  if (!base || msg.t !== 'mosaic' || msg.d !== base.dayKey || msg.g !== base.gen) return null;
  if (typeof msg.g !== 'number' || typeof msg.v !== 'number' || typeof msg.s !== 'number') return null;
  if (typeof msg.k !== 'string' || typeof msg.p !== 'string' || !Array.isArray(msg.n) || msg.n.some((v) => typeof v !== 'number') || typeof msg.c !== 'boolean') return null;
  if (!isNewerSnapshot(base, { gen: msg.g, version: msg.v })) return null;
  return { ...base, gen: msg.g, version: msg.v, stitchedTotal: msg.s, stitchedMask: msg.k, pixels: msg.p, solveCounts: msg.n as number[], complete: msg.c };
}

/**
 * Realtime plus fallback polling for one visible Mosaic_View (Req 18.4 to Req 18.6). The returned cleanup
 * disconnects and stops every request; hiding the page does the same until it becomes visible again.
 */
export function watchMosaic(dayKey: string, onSnapshot: (s: MosaicSnapshot) => void, onStale: (stale: boolean) => void): () => void {
  let stopped = false;
  let failures = 0;
  let lastMessageAt = 0;
  let held: MosaicSnapshot | null = null;
  let connection: Connection | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const visible = (): boolean => document.visibilityState !== 'hidden';
  const accept = (snap: MosaicSnapshot): void => {
    if (stopped || snap.dayKey !== dayKey) return;
    if (!isNewerSnapshot(held, snap)) return;
    held = snap;
    failures = 0;
    onStale(false);
    onSnapshot(snap);
  };

  const fetchOnce = async (): Promise<void> => {
    if (stopped || !visible()) return;
    const res = await apiGet<MosaicSnapshot>('/api/mosaic', MOSAIC_TIMEOUT_MS);
    if (stopped || !visible()) return;
    if (res.ok) {
      accept(res);
      return;
    }
    failures += 1;
    if (failures >= STALE_AFTER_FAILURES) onStale(true);
  };

  const connect = (): void => {
    if (stopped || connection || !visible()) return;
    try {
      connection = connectRealtime<RealtimeMosaic>({
        channel: `pw-${dayKey}`,
        onMessage: (msg) => {
          lastMessageAt = Date.now();
          const next = mergeMessage(held, msg);
          if (next) accept(next);
        },
        onDisconnect: () => {
          connection = null;
        },
      });
    } catch (error) {
      console.warn('realtime connection failed', error instanceof Error ? error.message : 'unknown error');
    }
  };

  const disconnect = (): void => {
    const c = connection;
    connection = null;
    if (c) void c.disconnect().catch(() => undefined);
  };

  const start = (): void => {
    if (stopped || interval || !visible()) return;
    connect();
    void fetchOnce();
    interval = setInterval(() => {
      if (Date.now() - lastMessageAt >= POLL_MS) void fetchOnce();
    }, POLL_MS);
  };

  const stop = (): void => {
    if (interval) clearInterval(interval);
    interval = null;
    disconnect();
  };

  const onVisibility = (): void => {
    if (visible()) {
      lastMessageAt = 0;
      start();
    } else {
      stop();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  start();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    stop();
  };
}
