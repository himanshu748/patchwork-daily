import { context, reddit } from '@devvit/web/server';
import { flairStyle, flairTierFor } from '../../shared/flair';
import type { StreakState } from '../../shared/streak';
import { K } from './keys';
import { rx } from './redisx';
import { readStreak } from './streak';

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * Flair_Manager (Req 23). Opt-in only; at most one flair API call per streak update, made only when the tier
 * differs from the one Patchwork last applied (`ft`) or the previous call failed (`fe`). Flair Patchwork did
 * not set is never removed. Every failure is logged and swallowed (Req 23.8).
 */
export async function applyFlairAfterStreak(userId: string, streak: StreakState): Promise<void> {
  const prefs = await rx.hGetAll(K.user(userId));
  if (prefs.flair !== '1') return;
  const tier = flairTierFor(streak.current);
  const desired = tier ?? '';
  const applied = prefs.ft ?? '';
  if (desired === applied && prefs.fe !== '1') return;
  if (desired === '' && applied === '') {
    await rx.hSet(K.user(userId), { fe: '0' });
    return;
  }
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) throw new Error('no username');
    if (tier) {
      const style = flairStyle(tier);
      await reddit.setUserFlair({
        subredditName: context.subredditName,
        username,
        text: style.text,
        backgroundColor: style.backgroundColor,
        textColor: style.textColor,
      });
    } else {
      await reddit.removeUserFlair(context.subredditName, username);
    }
    await rx.hSet(K.user(userId), { ft: desired, fe: '0' });
  } catch (error) {
    console.warn('flair update failed', reason(error));
    await rx.hSet(K.user(userId), { fe: '1' }).catch(() => undefined);
  }
}

/** Opt-in applies the current tier; opt-out removes flair only if Patchwork set it (Req 23.3 to Req 23.5). */
export async function setFlairOptIn(userId: string, optIn: boolean): Promise<void> {
  await rx.hSet(K.user(userId), { flair: optIn ? '1' : '0' });
  if (optIn) {
    try {
      await applyFlairAfterStreak(userId, await readStreak(userId));
    } catch (error) {
      console.warn('flair opt-in apply failed', reason(error));
    }
    return;
  }
  const applied = (await rx.hGet(K.user(userId), 'ft')) ?? '';
  if (applied === '') return;
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) throw new Error('no username');
    await reddit.removeUserFlair(context.subredditName, username);
    await rx.hSet(K.user(userId), { ft: '', fe: '0' });
  } catch (error) {
    console.warn('flair removal failed', reason(error));
    await rx.hSet(K.user(userId), { fe: '1' }).catch(() => undefined);
  }
}
