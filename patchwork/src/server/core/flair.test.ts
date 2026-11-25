import { redis, reddit } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect, vi } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayOrdinal, dayKeyFromOrdinal } from '../../shared/daykey';
import { flairTierFor } from '../../shared/flair';
import type { StreakState } from '../../shared/streak';
import { PBT_RUNS } from '../../shared/pbt';
import { K } from './keys';
import { applyFlairAfterStreak, setFlairOptIn } from './flair';

const test = createDevvitTest();
const U = 't2_flair';

function streakOf(current: number): StreakState {
  return { current, best: current, graceDays: [], lastDay: null };
}

async function playedDays(days: number): Promise<void> {
  const base = dayOrdinal('2036-01-01' as DayKey);
  for (let i = 0; i < days; i++) {
    const d = dayKeyFromOrdinal(base + i);
    await redis.zAdd(K.userDays(U), { member: d, score: dayOrdinal(d) });
  }
}

function mocks(): { set: ReturnType<typeof vi.spyOn>; remove: ReturnType<typeof vi.spyOn>; calls: () => number } {
  vi.spyOn(reddit, 'getCurrentUsername').mockResolvedValue('testuser');
  const set = vi.spyOn(reddit, 'setUserFlair').mockResolvedValue(undefined);
  const remove = vi.spyOn(reddit, 'removeUserFlair').mockResolvedValue(undefined);
  return { set, remove, calls: () => set.mock.calls.length + remove.mock.calls.length };
}

test('flair example: never opted in means zero flair API calls', async () => {
  const m = mocks();
  for (const c of [0, 3, 7, 14, 30]) await applyFlairAfterStreak(U, streakOf(c));
  expect(m.calls()).toBe(0);
});

test('flair example: opt-in applies the tier, repeats are free, opt-out removes', async () => {
  const m = mocks();
  await playedDays(10);
  await setFlairOptIn(U, true);
  const tier = flairTierFor(10);
  if (tier) expect(m.set).toHaveBeenCalledTimes(1);
  // Same tier again: no new call.
  await applyFlairAfterStreak(U, streakOf(10));
  expect(m.calls()).toBe(tier ? 1 : 0);
  // Opt-out removes the flair Patchwork set, once.
  await setFlairOptIn(U, false);
  if (tier) {
    expect(m.remove).toHaveBeenCalledTimes(1);
    expect((await redis.hGetAll(K.user(U))).ft).toBe('');
  } else {
    expect(m.remove).not.toHaveBeenCalled();
  }
});

test('flair example: a failed call is retried at the next update and never blocks play', async () => {
  const m = mocks();
  await redis.hSet(K.user(U), { flair: '1' });
  m.set.mockRejectedValueOnce(new Error('flair disabled'));
  // The failure is swallowed.
  await applyFlairAfterStreak(U, streakOf(10));
  expect((await redis.hGetAll(K.user(U))).fe).toBe('1');
  // Same tier, but the failure flag forces a retry.
  await applyFlairAfterStreak(U, streakOf(10));
  expect(m.set).toHaveBeenCalledTimes(2);
  expect((await redis.hGetAll(K.user(U))).fe).toBe('0');
});

// Feature: patchwork-daily-mosaic, Property 43: Flair is opt-in and its failures stay contained
test('Property 43: call discipline across opt-in, opt-out and update sequences with failures', async () => {
  let caseId = 0;
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          op: fc.constantFrom('in', 'out', 'update'),
          fail: fc.boolean(),
          streak: fc.integer({ min: 0, max: 30 }),
        }),
        { minLength: 1, maxLength: 12 },
      ),
      fc.integer({ min: 0, max: 20 }),
      async (ops, seedDays) => {
        const m = mocks();
        const u = `t2_flair_${caseId++}`;
        const base = dayOrdinal('2036-01-01' as DayKey);
        for (let i = 0; i < seedDays; i++) {
          const d = dayKeyFromOrdinal(base + i);
          await redis.zAdd(K.userDays(u), { member: d, score: dayOrdinal(d) });
        }
        let optedIn = false;
        let everOptedIn = false;
        let applied = '';
        let fe = false;
        const simCall = (desired: string, fail: boolean): number => {
          if (desired === applied && !fe) return 0;
          if (desired === '' && applied === '') {
            fe = false;
            return 0;
          }
          if (fail) {
            fe = true;
            return 1;
          }
          applied = desired;
          fe = false;
          return 1;
        };
        for (const op of ops) {
          m.set.mockReset();
          m.remove.mockReset();
          if (op.fail) {
            m.set.mockRejectedValue(new Error('flair disabled'));
            m.remove.mockRejectedValue(new Error('flair disabled'));
          } else {
            m.set.mockResolvedValue(undefined);
            m.remove.mockResolvedValue(undefined);
          }
          let want = 0;
          if (op.op === 'in') {
            await setFlairOptIn(u, true);
            optedIn = true;
            everOptedIn = true;
            want = simCall(flairTierFor(seedDays) ?? '', op.fail);
          } else if (op.op === 'out') {
            await setFlairOptIn(u, false);
            optedIn = false;
            if (applied !== '') {
              want = 1;
              if (op.fail) fe = true;
              else {
                applied = '';
                fe = false;
              }
            }
          } else {
            await applyFlairAfterStreak(u, streakOf(op.streak));
            want = optedIn ? simCall(flairTierFor(op.streak) ?? '', op.fail) : 0;
          }
          // At most one flair API call per event, and only where the mirror expects one.
          expect(m.calls()).toBe(want);
          if (!optedIn && op.op !== 'out') expect(m.calls()).toBe(0);
        }
        if (!everOptedIn) expect(m.set).not.toHaveBeenCalled();
      },
    ),
    { numRuns: PBT_RUNS },
  );
});
