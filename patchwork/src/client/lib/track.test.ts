import fc from 'fast-check';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_EVENTS, MAX_PROPS, MAX_STRING, validateEvent } from '../../shared/analytics';
import { PBT_RUNS } from '../../shared/test/arbitraries';
import { TRACK_TIMEOUT_MS, track } from './track';

type Mode = 'resolve' | 'reject' | 'throw' | 'hang';

const journeys = vi.hoisted(() => ({
  mode: 'resolve' as Mode,
  calls: [] as { method: string; arg: unknown }[],
}));

vi.mock('@devvit/analytics/client/reddit', () => {
  const method =
    (name: string) =>
    (arg?: unknown): Promise<unknown> => {
      journeys.calls.push({ method: name, arg });
      switch (journeys.mode) {
        case 'resolve':
          return Promise.resolve({});
        case 'reject':
          return Promise.reject(new Error('offline'));
        case 'throw':
          throw new Error('synchronous failure');
        case 'hang':
          return new Promise<unknown>(() => undefined);
      }
    };
  return {
    telemetry: {
      appReady: method('appReady'),
      startJourney: method('startJourney'),
      endJourney: method('endJourney'),
      interaction: method('interaction'),
    },
  };
});

const ALLOWED: Readonly<Record<string, fc.Arbitrary<string | number | boolean>>> = {
  dayKey: fc.string({ maxLength: MAX_STRING }),
  dayNumber: fc.integer(),
  tileIndex: fc.integer({ min: 0, max: 63 }),
  tileSize: fc.constantFrom(5, 6, 7),
  solveSeconds: fc.integer({ min: 0, max: 86_400 }),
  mistakes: fc.integer({ min: 0, max: 99 }),
  isExtra: fc.boolean(),
};
const ALLOWED_KEYS = Object.keys(ALLOWED);
const nameArb = fc.oneof(fc.constantFrom(...ANALYTICS_EVENTS), fc.string({ maxLength: 20 }));
const anyValueArb = fc.oneof(fc.string({ maxLength: 80 }), fc.integer(), fc.boolean());

/** Allowed keys with values of their declared type, sometimes a long dayKey, plus some keys outside the allowlist. */
const propsArb = fc
  .record({
    allowed: fc.subarray(ALLOWED_KEYS).chain((keys) =>
      fc.tuple(...keys.map((k) => (k === 'dayKey' ? fc.string({ maxLength: MAX_STRING + 8 }) : ALLOWED[k]!))).map((vals) =>
        Object.fromEntries(keys.map((k, i) => [k, vals[i]])),
      ),
    ),
    extra: fc.dictionary(
      fc.oneof(fc.constantFrom('username', 'userId', 'comment', 'solution', 'fillGrid'), fc.string({ minLength: 1, maxLength: 10 })),
      anyValueArb,
      { maxKeys: 6 },
    ),
  })
  .map(({ allowed, extra }) => ({ ...extra, ...allowed }) as Record<string, unknown>);

/** Property 47 restated from design.md, independent of `validateEvent`. */
function expectedAccept(name: string, props: Record<string, unknown>): boolean {
  const entries = Object.entries(props);
  return (
    (ANALYTICS_EVENTS as readonly string[]).includes(name) &&
    entries.length <= MAX_PROPS &&
    entries.every(([k, v]) => ALLOWED_KEYS.includes(k) && (typeof v !== 'string' || v.length <= MAX_STRING))
  );
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};

/** Lets every pending callback run, including the 2 s cut-off, so a stray rejection would surface. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(TRACK_TIMEOUT_MS + 10);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('track', () => {
  beforeAll(() => {
    process.on('unhandledRejection', onUnhandled);
  });
  afterAll(() => {
    process.off('unhandledRejection', onUnhandled);
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    journeys.mode = 'resolve';
    journeys.calls.length = 0;
    unhandled.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Property 47: validateEvent accepts exactly the allowlisted events and properties', () => {
    fc.assert(
      fc.property(nameArb, propsArb, (name, props) => {
        expect(validateEvent(name, props) !== null).toBe(expectedAccept(name, props));
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('Property 47: track returns synchronously and leaks nothing whatever the Journeys client does', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<Mode>('resolve', 'reject', 'throw', 'hang'), nameArb, propsArb, async (mode, name, props) => {
        journeys.mode = mode;
        journeys.calls.length = 0;
        let returned: unknown = 'not called';
        expect(() => {
          returned = track(name, props);
        }).not.toThrow();
        expect(returned).toBeUndefined();
        await settle();
        expect(unhandled).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(journeys.calls.length).toBe(expectedAccept(name, props) ? 1 : 0);
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('sends each of the 7 events to its Journeys call', async () => {
    for (const name of ANALYTICS_EVENTS) track(name, { tileIndex: 3 });
    await settle();
    expect(journeys.calls).toEqual([
      { method: 'appReady', arg: undefined },
      { method: 'startJourney', arg: undefined },
      { method: 'interaction', arg: { action: 'tile_assigned', actionDetails: 'tileIndex=3' } },
      { method: 'endJourney', arg: { complete: true } },
      { method: 'interaction', arg: { action: 'extra_tile_solved', actionDetails: 'tileIndex=3' } },
      { method: 'interaction', arg: { action: 'share_comment', actionDetails: 'tileIndex=3' } },
      { method: 'interaction', arg: { action: 'return_next_day', actionDetails: 'tileIndex=3' } },
    ]);
  });

  it('omits empty actionDetails', async () => {
    track('share_comment', {});
    await settle();
    expect(journeys.calls).toEqual([{ method: 'interaction', arg: { action: 'share_comment' } }]);
  });

  it('drops an eighth name, 11 properties, a 65-character string and a username key', async () => {
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i]));
    track('page_view', {});
    track('post_view', eleven);
    track('post_view', { dayKey: 'x'.repeat(65) });
    track('post_view', { username: 'someone' });
    await settle();
    expect(journeys.calls).toEqual([]);
  });

  it('warns once per failed call and stays quiet on success', async () => {
    // The Journeys call starts in a microtask, so each mode is held until its call has settled.
    for (const mode of ['reject', 'throw', 'resolve'] as const) {
      journeys.mode = mode;
      track('tile_assigned', { tileIndex: 1 });
      await settle();
    }
    expect(journeys.calls.length).toBe(3);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
