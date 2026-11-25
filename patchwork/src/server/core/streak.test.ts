import { redis } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { addDays, dayStartMs } from '../../shared/daykey';
import { computeStreak } from '../../shared/streak';
import { PBT_RUNS } from '../../shared/pbt';
import { seedDay, solutionGrid, storedTile } from '../test/harness';
import { F, K } from './keys';
import { commitStitch } from './stitch';
import { validateSubmission } from './validate';

const test = createDevvitTest();

const WEEK_START = '2035-01-01' as DayKey;
const WEEK = Array.from({ length: 8 }, (_, i) => addDays(WEEK_START, i));

let seeded = false;
async function seedWeek(): Promise<void> {
  if (seeded) return;
  for (const d of WEEK) await seedDay(d);
  seeded = true;
}

async function scoredStitch(u: string, d: DayKey, at: number): Promise<{ returnNextDay: boolean; streak: { current: number; best: number } | null; again: boolean }> {
  const tile = 3;
  await redis.hSet(K.userDay(d, u), { [F.scored(0)]: JSON.stringify({ t: tile, at }) });
  const v = await validateSubmission(u, d, { dayKey: d, gen: 0, tileIndex: tile, grid: solutionGrid(storedTile(d, tile)) });
  if (v.status !== 'accepted') throw new Error('expected accepted');
  const s = await commitStitch(u, v, at + 2_000);
  if (s.status !== 'recorded') throw new Error(`expected recorded, got ${s.status}`);
  // A repeat submission of the same Tile never returns returnNextDay again.
  const v2 = await validateSubmission(u, d, { dayKey: d, gen: 0, tileIndex: tile, grid: solutionGrid(storedTile(d, tile)) });
  if (v2.status !== 'accepted') throw new Error('expected accepted');
  const repeat = await commitStitch(u, v2, at + 5_000);
  return {
    returnNextDay: s.returnNextDay,
    streak: s.streak ? { current: s.streak.current, best: s.streak.best } : null,
    again: repeat.status === 'already-stitched' && !repeat.returnNextDay,
  };
}

// Feature: patchwork-daily-mosaic, Property 41: `return_next_day` fires once
test('Property 41: returnNextDay fires exactly in the scoring response after a played previous day', async () => {
  await seedWeek();
  await fc.assert(
    fc.asyncProperty(fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }), fc.integer({ min: 0, max: 10_000 }), async (plays, salt) => {
      const u = `t2_streak_${salt}_${plays.map((p) => (p ? '1' : '0')).join('')}`;
      const played: DayKey[] = [];
      for (let i = 0; i < WEEK.length; i++) {
        if (!plays[i]) continue;
        const d = WEEK[i] as DayKey;
        const r = await scoredStitch(u, d, dayStartMs(d) + 60_000);
        expect(r.returnNextDay).toBe(plays[i - 1] === true);
        expect(r.again).toBe(true);
        played.push(d);
        const want = computeStreak(played);
        expect(r.streak).toEqual({ current: want.current, best: want.best });
      }
    }),
    { numRuns: PBT_RUNS },
  );
});
