import type { DayKey } from './daykey';
import { addDays, dayOrdinal } from './daykey';

export interface StreakState {
  readonly current: number;
  readonly best: number;
  /** Day_Keys on which a Grace_Use was recorded. */
  readonly graceDays: readonly DayKey[];
  readonly lastDay: DayKey | null;
}

/** Days before the current Day_Key that must hold no Grace_Use for a new one (one per 7 Day_Keys). */
export const GRACE_LOOKBACK_DAYS = 6;

/**
 * Replays every played Day_Key. A gap of 1 continues the streak; a gap of 2 continues it and records a
 * Grace_Use when no Grace_Use falls on the 6 Day_Keys before; anything else resets it to 1.
 */
export function computeStreak(playedDays: readonly DayKey[]): StreakState {
  const ordinals = [...new Set(playedDays.map((d) => dayOrdinal(d)))].sort((a, b) => a - b);
  let current = 0;
  let best = 0;
  let prev: number | null = null;
  const grace: number[] = [];
  for (const o of ordinals) {
    if (prev === null) current = 1;
    else {
      const gap = o - prev;
      if (gap === 1) current++;
      else if (gap === 2 && !grace.some((g) => g >= o - GRACE_LOOKBACK_DAYS && g <= o - 1)) {
        current++;
        grace.push(o);
      } else current = 1;
    }
    best = Math.max(best, current);
    prev = o;
  }
  const keyOf = (o: number): DayKey => addDays('1970-01-01' as DayKey, o);
  return { current, best, graceDays: grace.map(keyOf), lastDay: prev === null ? null : keyOf(prev) };
}

export function playedPreviousDay(playedDays: readonly DayKey[], today: DayKey): boolean {
  const yesterday = dayOrdinal(today) - 1;
  return playedDays.some((d) => dayOrdinal(d) === yesterday);
}
