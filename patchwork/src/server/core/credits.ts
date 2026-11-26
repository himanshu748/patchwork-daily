import { cache, reddit } from '@devvit/web/server';
import type { CreditsResponse } from '../../shared/api';
import type { DayKey } from '../../shared/daykey';
import { readMeta } from './day';
import { K } from './keys';
import { rx } from './redisx';

const HELP_UNIT = 1_000_000;
const USER_CACHE_SECONDS = 60;

export type CreditsRead = { readonly status: 'ok'; readonly credits: CreditsResponse } | { readonly status: 'not-complete' };

async function userName(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    return await cache(
      async () => {
        const user = await reddit.getUserById(userId as `t2_${string}`);
        return user?.username ?? null;
      },
      { key: `pw-user-${userId}`, ttl: USER_CACHE_SECONDS },
    );
  } catch {
    return null;
  }
}

function creatorIdFrom(source: string | undefined, ugcJson: string | undefined): string | null {
  if (!source?.startsWith('ugc:') || ugcJson === undefined) return null;
  try {
    const ugc = JSON.parse(ugcJson) as { creatorId?: unknown; creator?: unknown; u?: unknown };
    const id = ugc.creatorId ?? ugc.creator ?? ugc.u;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Credits for one Complete_Mosaic (Req 19.2 to Req 19.7). Redis failures reject to the route as
 * CREDITS_FAILED; an unavailable Reddit user only makes that one name null.
 */
export async function readCredits(d: DayKey): Promise<CreditsRead> {
  const meta = await readMeta(d);
  if (!meta) return { status: 'not-complete' };
  const g = meta.activeGen;
  const first = await rx.hGetAll(K.first(d, g));
  if (Object.keys(first).length < 64) return { status: 'not-complete' };

  const helperRows = await rx.zRange(K.helpers(d), 0, 9, { by: 'rank', reverse: true });
  const source = meta.source;
  let creator: { readonly name: string | null } | null = null;
  if (source?.startsWith('ugc:')) {
    const ugcJson = await rx.hGet(K.ugc, source.slice(4));
    creator = { name: await userName(creatorIdFrom(source, ugcJson) ?? undefined) };
  }

  const firstIds = Array.from({ length: 64 }, (_, tile) => first[String(tile)]);
  const helperIds = helperRows.map((row) => row.member);
  const names = new Map<string, string | null>();
  await Promise.all(
    [...new Set([...firstIds, ...helperIds].filter((id): id is string => typeof id === 'string'))].map(async (id) => {
      names.set(id, await userName(id));
    }),
  );

  return {
    status: 'ok',
    credits: {
      firstStitchers: firstIds.map((id, tile) => ({ tile, name: id ? (names.get(id) ?? null) : null })),
      topHelpers: helperRows.map((row, i) => ({
        rank: i + 1,
        name: names.get(row.member) ?? null,
        helpCount: Math.floor(row.score / HELP_UNIT),
      })),
      helpersExpired: helperRows.length === 0,
      creator,
    },
  };
}
