import type { DayKey } from '../../shared/daykey';
import { parseDayKey } from '../../shared/daykey';
import type { StreakState } from '../../shared/streak';
import { computeStreak } from '../../shared/streak';
import { K } from './keys';
import { rx } from './redisx';

/** Every Day_Key with a recorded score; written once per Day_Key inside the Stitch transaction (F33). */
export async function readDays(userId: string): Promise<DayKey[]> {
  const members = await rx.zRange(K.userDays(userId), 0, -1, { by: 'rank' });
  return members.map((m) => parseDayKey(m.member)).filter((d): d is DayKey => d !== null);
}

/** Recomputed from the append-only day list on every read, so nothing can double-count (Req 15.2). */
export async function readStreak(userId: string): Promise<StreakState> {
  return computeStreak(await readDays(userId));
}
