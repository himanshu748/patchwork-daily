import type fc from 'fast-check';
import { afterEach } from 'vitest';
import { Context, redis, runWithContext } from '@devvit/web/server';
import type { TxClientLike } from '@devvit/web/server';
import type { DayKey } from '../../shared/daykey';
import { dayNumber, tileSizeFor } from '../../shared/daykey';
import type { CellState } from '../../shared/grid';
import { encodeGrid } from '../../shared/grid';
import type { BuiltGeneration } from '../core/generation';
import { buildGeneration } from '../core/generation';
import { K, M } from '../core/keys';
import type { StoredTile } from '../core/tilerec';
import { parseTileRecord } from '../core/tilerec';

const builds = new Map<string, BuiltGeneration>();

/** Generation records memoised per process: building a day is the slow part of every Redis-backed case. */
export function generationOf(d: DayKey, seed = 0, motifIndex = 0): BuiltGeneration {
  const key = `${d}|${seed}|${motifIndex}`;
  let built = builds.get(key);
  if (!built) {
    built = buildGeneration(d, { seed, motifIndex });
    builds.set(key, built);
  }
  return built;
}

export function storedTile(d: DayKey, t: number, seed = 0, motifIndex = 0): StoredTile {
  const rec = parseTileRecord(generationOf(d, seed, motifIndex).records[String(t)], t, tileSizeFor(d));
  if (!rec) throw new Error(`no tile ${t} for ${d}`);
  return rec;
}

/** The grid a player submits when every filled Cell is right; unfilled Cells alternate empty and marked. */
export function solutionGrid(tile: StoredTile): string {
  return encodeGrid(Array.from(tile.solution, (v, i): CellState => (v === 1 ? 1 : i % 2 === 0 ? 0 : 2)));
}

/** A grid with exactly one filled Cell flipped. */
export function wrongGrid(tile: StoredTile, cell = 0): string {
  return encodeGrid(Array.from(tile.solution, (v, i): CellState => ((i === cell ? 1 - v : v) === 1 ? 1 : 0)));
}

export const START_DATE = '2026-11-01' as DayKey;

/** Stores generation 0 and the post mappings the daily run would write, without the Reddit calls. */
export async function seedDay(d: DayKey, postId = `t3_${d.replaceAll('-', '')}`): Promise<string> {
  const built = generationOf(d);
  await redis.hSet(K.tiles(d, 0), built.records);
  await redis.hSet(K.meta(d), {
    [M.postId]: postId,
    [M.dayNumber]: String(dayNumber(d, START_DATE)),
    [M.tileSize]: String(tileSizeFor(d)),
    [M.startDate]: START_DATE,
    [M.genSeq]: '0',
    [M.seed(0)]: '0',
    [M.motifIndex(0)]: '0',
    [M.variant(0)]: String(built.variant),
    [M.motif(0)]: built.motifName,
    [M.source(0)]: 'procedural',
    [M.activeGen]: '0',
  });
  await redis.hSet(K.posts, { [postId]: d });
  await redis.hSet(K.days, { [d]: postId });
  return postId;
}

export interface As {
  readonly userId?: string | undefined;
  readonly username?: string | undefined;
  readonly postId?: string | undefined;
}

/**
 * Runs `fn` with a request context for another user or post. Redis and the other mocks stay those of the
 * current test; only the per-request headers (`context.userId`, `context.postId`, ...) change.
 */
export function as<T>(base: Record<string, string | undefined>, who: As, fn: () => T | Promise<T>): Promise<T> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) headers[k] = v;
  delete headers['devvit-user'];
  delete headers['devvit-user-name'];
  delete headers['devvit-post'];
  if (who.userId) headers['devvit-user'] = who.userId;
  if (who.username ?? who.userId) headers['devvit-user-name'] = who.username ?? (who.userId as string).slice(3);
  if (who.postId) headers['devvit-post'] = who.postId;
  return runWithContext(Context(headers), async () => fn());
}

export function users(n: number, prefix = 'u'): string[] {
  return Array.from({ length: n }, (_, i) => `t2_${prefix}${i}`);
}

/** What a hook may do before a command: nothing, replace its result, or never let it finish (a timeout). */
export type HookResult = void | { readonly value: unknown } | 'hang';
export type Hook = (method: string, args: readonly unknown[]) => HookResult | Promise<HookResult>;

const METHODS = [
  'get',
  'set',
  'del',
  'incrBy',
  'expire',
  'hGet',
  'hSet',
  'hSetNX',
  'hIncrBy',
  'hGetAll',
  'hLen',
  'hDel',
  'zAdd',
  'zRange',
  'zRank',
  'zScore',
  'zCard',
] as const;

export interface Instrument {
  /** Replaces the hook (null removes it). */
  hook(h: Hook | null): void;
  /** Every command seen, in call order, including `tx.*` commands and `exec`. */
  readonly log: { readonly method: string; readonly key: unknown }[];
}

type AnyFn = (...args: unknown[]) => Promise<unknown>;

const client = redis as unknown as Record<string, AnyFn>;
const originals: Record<string, AnyFn> = {};
for (const m of [...METHODS, 'watch'] as const) originals[m] = client[m]?.bind(redis) as AnyFn;

let active: Instrument & { current: Hook | null } | null = null;
let patched = false;

async function gate(method: string, args: readonly unknown[]): Promise<{ readonly skip: boolean; readonly value?: unknown }> {
  if (active) active.log.push({ method, key: args[0] });
  if (!active?.current) return { skip: false };
  const r = await active.current(method, args);
  if (r === 'hang') return new Promise<never>(() => undefined);
  if (r && typeof r === 'object') return { skip: true, value: r.value };
  return { skip: false };
}

function patchRedis(): void {
  if (patched) return;
  patched = true;
  for (const m of METHODS) {
    const original = originals[m] as AnyFn;
    client[m] = async (...args: unknown[]) => {
      const g = await gate(m, args);
      return g.skip ? g.value : original(...args);
    };
  }

  // Unspied reads for the WATCH snapshot, so they skip the hook and the log.
  const rawHGetAll = originals.hGetAll as AnyFn;
  const rawDump = (key: string): Promise<string> => rawHGetAll(key).then((v) => JSON.stringify(v));
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(fn);
    lock = run.catch(() => undefined);
    return run;
  };
  const originalWatch = originals.watch as unknown as (...keys: string[]) => Promise<TxClientLike>;

  client.watch = async (...args: unknown[]) => {
    const keys = args as string[];
    const g = await gate('watch', keys);
    if (g.skip) return g.value;
    const tx = await originalWatch(...keys);
    const snapshot = await Promise.all(keys.map(rawDump));
    const txr = tx as unknown as Record<string, AnyFn>;
    const proxy: Record<string, AnyFn> = new Proxy(txr, {
      get(target, prop: string) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        const bound = value.bind(target);
        if (prop === 'exec') {
          return async () => {
            const eg = await gate('exec', keys);
            if (eg.skip) {
              await (target.discard?.bind(target) as AnyFn)();
              return eg.value;
            }
            return exclusive(async () => {
              const now = await Promise.all(keys.map(rawDump));
              if (now.some((v, i) => v !== snapshot[i])) {
                await (target.discard?.bind(target) as AnyFn)();
                return null;
              }
              return bound();
            });
          };
        }
        if (prop === 'multi' || prop === 'discard' || prop === 'unwatch') return bound;
        return async (...a: unknown[]) => {
          const cg = await gate(`tx.${prop}`, a);
          if (cg.skip) return proxy;
          await bound(...a);
          return proxy;
        };
      },
    });
    return proxy;
  };
}

afterEach(() => {
  if (!active) return;
  active.current = null;
  active.log.length = 0;
});

/**
 * Returns the file-local Redis instrument. The patch is deliberate monkey-patching rather than `vi.spyOn`:
 * `@devvit/test` restores every spy after each test, which would silently remove fault injection after the
 * first case. Hooks are still cleared after every test.
 */
export function instrumentRedis(): Instrument {
  patchRedis();
  if (!active) {
    const log: { method: string; key: unknown }[] = [];
    active = {
      current: null,
      log,
      hook(h) {
        this.current = h;
      },
    };
  }
  return active;
}

/** Every Redis command waits for the fast-check scheduler, so each case runs a different interleaving. */
export function scheduled(s: fc.Scheduler): Hook {
  return (method) => s.schedule(Promise.resolve(undefined), method);
}

/** Fails the k-th command (0-based) with an error, a hang (timeout) or a null `exec`. */
export function faultAt(k: number, mode: 'error' | 'hang' | 'null-exec'): { readonly hook: Hook; readonly hit: () => string | null } {
  let i = 0;
  let hitMethod: string | null = null;
  const hook: Hook = (method) => {
    const n = i++;
    if (mode === 'null-exec') {
      if (method !== 'exec') return;
      hitMethod = method;
      return { value: null };
    }
    if (n !== k) return;
    hitMethod = method;
    if (mode === 'hang') return 'hang';
    throw new Error(`injected failure at ${method}`);
  };
  return { hook, hit: () => hitMethod };
}
