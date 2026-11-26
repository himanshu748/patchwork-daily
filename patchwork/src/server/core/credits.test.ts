import { redis, reddit } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { expect, vi } from 'vitest';
import type { DayKey } from '../../shared/daykey';
import { PBT_RUNS } from '../../shared/pbt';
import { seedDay } from '../test/harness';
import { readCredits } from './credits';
import { K } from './keys';

const test = createDevvitTest();
const D = '2035-02-03' as DayKey;
const HELP_UNIT = 1_000_000;

function mockUsers(): void {
  vi.spyOn(reddit, 'getUserById').mockImplementation(async (id) => {
    if (id.endsWith('_missing')) return undefined;
    return { username: `name_${id.slice(3)}` } as never;
  });
}

test('credits example: 64 first stitchers, helper order, expired helper data and unavailable names', async () => {
  mockUsers();
  await seedDay(D);
  const first: Record<string, string> = {};
  for (let t = 0; t < 64; t++) first[String(t)] = t === 7 ? 't2_first_missing' : `t2_first${t}`;
  await redis.hSet(K.first(D, 0), first);
  await redis.zAdd(K.helpers(D), { member: 't2_slow', score: 3 * HELP_UNIT + 10 });
  await redis.zAdd(K.helpers(D), { member: 't2_fast', score: 3 * HELP_UNIT + 20 });
  await redis.zAdd(K.helpers(D), { member: 't2_helper_missing', score: 4 * HELP_UNIT });

  const res = await readCredits(D);
  expect(res.status).toBe('ok');
  if (res.status !== 'ok') return;
  expect(res.credits.firstStitchers).toHaveLength(64);
  expect(res.credits.firstStitchers.map((x) => x.tile)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  expect(res.credits.firstStitchers[7]?.name).toBeNull();
  expect(res.credits.topHelpers.map((x) => x.name)).toEqual([null, 'name_fast', 'name_slow']);
  expect(res.credits.topHelpers.map((x) => x.helpCount)).toEqual([4, 3, 3]);
  expect(res.credits.helpersExpired).toBe(false);

  await redis.del(K.helpers(D));
  const expired = await readCredits(D);
  expect(expired.status).toBe('ok');
  if (expired.status === 'ok') expect(expired.credits.helpersExpired).toBe(true);
});

test('credits example: incomplete mosaic is not complete', async () => {
  await seedDay('2035-02-04' as DayKey);
  expect((await readCredits('2035-02-04' as DayKey)).status).toBe('not-complete');
});

// Feature: patchwork-daily-mosaic, Property 29: Credits
test('Property 29: credits order, lookup failure and helper ordering hold for complete mosaics', async () => {
  mockUsers();
  await seedDay(D);
  const arb = fc.record({
    caseId: fc.uuid(),
    missingFirst: fc.array(fc.integer({ min: 0, max: 63 }), { maxLength: 12 }),
    helpers: fc.array(
      fc.record({
        count: fc.integer({ min: 1, max: 20 }),
        tie: fc.integer({ min: 0, max: 999_999 }),
        missing: fc.boolean(),
      }),
      { maxLength: 15 },
    ),
  });
  await fc.assert(
    fc.asyncProperty(arb, async ({ caseId, missingFirst, helpers }) => {
      const stem = caseId.replaceAll('-', '');
      const first: Record<string, string> = {};
      const firstIds: string[] = [];
      for (let t = 0; t < 64; t++) {
        const id = missingFirst.includes(t) ? `t2_${stem}f${t}_missing` : `t2_${stem}f${t}`;
        first[String(t)] = id;
        firstIds.push(id);
      }
      await redis.hSet(K.first(D, 0), first);
      await redis.del(K.helpers(D));

      const rows = helpers.map((h, i) => {
        const id = `t2_${stem}h${i}${h.missing ? '_missing' : ''}`;
        return { id, score: h.count * HELP_UNIT + h.tie, count: h.count };
      });
      for (const row of rows) await redis.zAdd(K.helpers(D), { member: row.id, score: row.score });

      const res = await readCredits(D);
      expect(res.status).toBe('ok');
      if (res.status !== 'ok') return;
      expect(res.credits.firstStitchers).toHaveLength(64);
      for (const entry of res.credits.firstStitchers) {
        const id = firstIds[entry.tile] as string;
        expect(entry.name).toBe(id.endsWith('_missing') ? null : `name_${id.slice(3)}`);
      }
      const expected = rows.slice().sort((a, b) => b.score - a.score).slice(0, 10);
      expect(res.credits.topHelpers.map((x) => x.helpCount)).toEqual(expected.map((x) => x.count));
      expect(res.credits.topHelpers.map((x) => x.name)).toEqual(
        expected.map((x) => (x.id.endsWith('_missing') ? null : `name_${x.id.slice(3)}`)),
      );
      expect(res.credits.topHelpers.map((x) => x.rank)).toEqual(expected.map((_, i) => i + 1));
      expect(res.credits.helpersExpired).toBe(rows.length === 0);
    }),
    { numRuns: PBT_RUNS },
  );
});
