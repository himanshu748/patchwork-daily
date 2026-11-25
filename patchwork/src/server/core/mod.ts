import { cache, context, reddit } from '@devvit/web/server';
import { K } from './keys';

export class ModCheckFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModCheckFailed';
  }
}

/**
 * Full permission check for every moderator action (F22, Decision D23): 'all' or 'posts'. Throws
 * ModCheckFailed when the check itself fails, so callers fail closed with a retryable message.
 */
export async function isModerator(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const user = await reddit.getUserById(userId as `t2_${string}`);
    if (!user) return false;
    const perms = await user.getModPermissionsForSubreddit(context.subredditName);
    return perms.includes('all') || perms.includes('posts');
  } catch (error) {
    throw new ModCheckFailed(error instanceof Error ? error.message : 'moderator check failed');
  }
}

/** A hint for showing the "Review" control only (Decision D16); every review action re-runs isModerator. */
export async function reviewHint(username: string | undefined): Promise<boolean> {
  if (!username) return false;
  try {
    const names = await cache(
      async () => {
        const mods = await reddit.getModerators({ subredditName: context.subredditName }).all();
        return mods.map((m) => m.username);
      },
      { key: K.cacheMods, ttl: 300 },
    );
    return names.includes(username);
  } catch (error) {
    console.warn('moderator list unavailable', error instanceof Error ? error.message : 'unknown error');
    return false;
  }
}
