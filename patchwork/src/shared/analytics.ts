export const ANALYTICS_EVENTS = [
  'post_view',
  'first_interaction',
  'tile_assigned',
  'tile_solved',
  'extra_tile_solved',
  'share_comment',
  'return_next_day',
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export interface AnalyticsProps {
  readonly dayKey?: string;
  readonly dayNumber?: number;
  readonly tileIndex?: number;
  readonly tileSize?: number;
  readonly solveSeconds?: number;
  readonly mistakes?: number;
  readonly isExtra?: boolean;
}

const ALLOWED_TYPES: Readonly<Record<keyof AnalyticsProps, 'string' | 'number' | 'boolean'>> = {
  dayKey: 'string',
  dayNumber: 'number',
  tileIndex: 'number',
  tileSize: 'number',
  solveSeconds: 'number',
  mistakes: 'number',
  isExtra: 'boolean',
};

export const MAX_PROPS = 10;
export const MAX_STRING = 64;

/**
 * Null (the event is dropped) for an unknown name, more than 10 properties, a key outside AnalyticsProps,
 * a value of the wrong type, or a string longer than 64 characters. Usernames, user IDs, comment text,
 * Solutions and fill grids have no key to travel in.
 */
export function validateEvent(
  name: string,
  props: Readonly<Record<string, unknown>>,
): { readonly name: AnalyticsEvent; readonly props: AnalyticsProps } | null {
  if (!(ANALYTICS_EVENTS as readonly string[]).includes(name)) return null;
  if (typeof props !== 'object' || props === null) return null;
  const entries = Object.entries(props);
  if (entries.length > MAX_PROPS) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of entries) {
    if (!Object.hasOwn(ALLOWED_TYPES, key)) return null;
    const type = ALLOWED_TYPES[key as keyof AnalyticsProps];
    if (typeof value !== type) return null;
    if (typeof value === 'string' && value.length > MAX_STRING) return null;
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    out[key] = value as string | number | boolean;
  }
  return { name: name as AnalyticsEvent, props: out as AnalyticsProps };
}
