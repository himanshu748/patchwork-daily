import { redis } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { dayKeyFromOrdinal, dayOrdinal } from '../../shared/daykey';
import { PBT_RUNS } from '../../shared/pbt';
import { K } from './keys';
import { sharedRank } from './leaderboard';

const test = createDevvitTest();

let caseCounter = 0;
const BASE = dayOrdinal('2034-01-01' as DayKey);
function freshDay(): DayKey {
  return dayKeyFromOrdinal(BASE + caseCounter++);
}

test('the worked example 900, 850, 850, 700 gives positions 1, 2, 2, 4', async () => {
  const d = freshDay();
  const scores: [string, number][] = [
    ['t2_a', 900],
    ['t2_b', 850],
    ['t2_c', 850],
    ['t2_d', 700],
  ];
  for (const [u, s] of scores) await redis.zAdd(K.lb(d), { member: u, score: s });
  expect(await sharedRank(d, 't2_a')).toEqual({ position: 1, total: 4 });
  expect(await sharedRank(d, 't2_b')).toEqual({ position: 2, total: 4 });
  expect(await sharedRank(d, 't2_c')).toEqual({ position: 2, total: 4 });
  expect(await sharedRank(d, 't2_d')).toEqual({ position: 4, total: 4 });
  expect(await sharedRank(d, 't2_absent')).toBeNull();
});

// Feature: patchwork-daily-mosaic, Property 38: Shared rank
test('Property 38: position is one plus the number of strictly higher scores', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ u: fc.integer({ min: 0, max: 19 }), score: fc.integer({ min: 0, max: 1000 }) }), {
        minLength: 1,
        maxLength: 20,
      }),
      async (entries) => {
        const d = freshDay();
        const best = new Map<string, number>();
        for (const { u, score } of entries) best.set(`t2_${u}`, score);
        for (const [u, s] of best) await redis.zAdd(K.lb(d), { member: u, score: s });
        for (const [u, s] of best) {
          const higher = [...best.values()].filter((x) => x > s).length;
          expect(await sharedRank(d, u)).toEqual({ position: higher + 1, total: best.size });
        }
      },
    ),
    { numRuns: PBT_RUNS },
  );
});
