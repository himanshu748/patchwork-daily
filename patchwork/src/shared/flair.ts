import type { Hex } from './palette';
import { PALETTE, contrastRatio } from './palette';

export type FlairTier = 'Thread' | 'Quilter' | 'Weaver';

export function flairTierFor(currentStreak: number): FlairTier | null {
  if (currentStreak >= 30) return 'Weaver';
  if (currentStreak >= 7) return 'Quilter';
  if (currentStreak >= 3) return 'Thread';
  return null;
}

const TIER_ENTRY: Readonly<Record<FlairTier, 1 | 2 | 3>> = { Thread: 2, Quilter: 1, Weaver: 3 };

/** Background from the light Palette; text colour is whichever of dark or light text contrasts more. */
export function flairStyle(tier: FlairTier): { readonly text: string; readonly backgroundColor: Hex; readonly textColor: 'dark' | 'light' } {
  const backgroundColor = PALETTE[TIER_ENTRY[tier]].light;
  const textColor = contrastRatio(backgroundColor, '#ffffff') >= contrastRatio(backgroundColor, '#000000') ? 'light' : 'dark';
  return { text: tier, backgroundColor, textColor };
}
