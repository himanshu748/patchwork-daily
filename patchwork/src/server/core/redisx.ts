import { randomUUID } from 'node:crypto';
import { redis } from '@devvit/web/server';
import type { SetOptions, TxClientLike, ZRangeOptions } from '@devvit/web/server';

export const REDIS_TIMEOUT_MS = 2000;

let commandTimeoutMs = REDIS_TIMEOUT_MS;

/** Tests shorten the per-command timeout instead of waiting 2 s; returns the previous value. */
export function setCommandTimeout(ms: number): number {
  const before = commandTimeoutMs;
  commandTimeoutMs = ms;
  return before;
}

export class RedisTimeout extends Error {
  constructor(ms: number) {
    super(`Redis call exceeded ${ms} ms`);
    this.name = 'RedisTimeout';
  }
}

/** Races `work` against a timer. A timed-out command may still have been applied, so callers keep every retry safe. */
export function withTimeout<T>(work: Promise<T>, ms = commandTimeoutMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RedisTimeout(ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Every Redis command Patchwork uses, each under the 2 s timeout (Req 9.12). `hMGet`, scans and plain sets or
 * lists are deliberately absent (F7). The methods look up `redis` at call time so tests can inject faults.
 */
export const rx = {
  get: (key: string) => withTimeout(redis.get(key)),
  set: (key: string, value: string, options?: SetOptions) => withTimeout(redis.set(key, value, options)),
  del: (...keys: string[]) => withTimeout(redis.del(...keys)),
  incrBy: (key: string, value: number) => withTimeout(redis.incrBy(key, value)),
  expire: (key: string, seconds: number) => withTimeout(redis.expire(key, seconds)),
  hGet: (key: string, field: string) => withTimeout(redis.hGet(key, field)),
  hSet: (key: string, values: Record<string, string>) => withTimeout(redis.hSet(key, values)),
  hSetNX: (key: string, field: string, value: string) => withTimeout(redis.hSetNX(key, field, value)),
  hIncrBy: (key: string, field: string, value: number) => withTimeout(redis.hIncrBy(key, field, value)),
  hGetAll: (key: string) => withTimeout(redis.hGetAll(key)),
  hLen: (key: string) => withTimeout(redis.hLen(key)),
  hDel: (key: string, fields: string[]) => withTimeout(redis.hDel(key, fields)),
  zAdd: (key: string, member: string, score: number) => withTimeout(redis.zAdd(key, { member, score })),
  zRange: (key: string, start: number | string, stop: number | string, options?: ZRangeOptions) =>
    withTimeout(redis.zRange(key, start, stop, options)),
  zRank: (key: string, member: string) => withTimeout(redis.zRank(key, member)),
  zScore: (key: string, member: string) => withTimeout(redis.zScore(key, member)),
  zCard: (key: string) => withTimeout(redis.zCard(key)),
  watch: (key: string): Promise<TxClientLike> => withTimeout(redis.watch(key)),
};

/** Set-if-absent with an expiry, then read back; returns the token only if this caller holds the claim. */
export async function claim(key: string, ttlSeconds: number): Promise<string | null> {
  const token = randomUUID();
  await rx.set(key, token, { nx: true, expiration: new Date(Date.now() + ttlSeconds * 1000) });
  return (await rx.get(key)) === token ? token : null;
}

/** Deletes the claim only if it still holds this token. */
export async function release(key: string, token: string): Promise<void> {
  if ((await rx.get(key)) === token) await rx.del(key);
}

/** Reads a hash of integer counters into a dense array (missing fields are 0). */
export function countsFrom(hash: Record<string, string>, length: number): number[] {
  const out = new Array<number>(length).fill(0);
  for (const [field, value] of Object.entries(hash)) {
    const i = Number(field);
    const v = Number.parseInt(value, 10);
    if (Number.isInteger(i) && i >= 0 && i < length && Number.isFinite(v)) out[i] = v;
  }
  return out;
}

export function intOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const v = Number.parseInt(value, 10);
  return Number.isFinite(v) ? v : fallback;
}
