import type { DayKey } from '../../shared/daykey';

/** Every Redis key Patchwork uses (design.md Data Models (a)); no other module writes key strings. */
export const K = {
  install: 'pw:install',
  days: 'pw:days',
  posts: 'pw:posts',
  postClaim: (d: DayKey): string => `pw:claim:post:${d}`,
  postAttempts: 'pw:post:attempts',
  meta: (d: DayKey): string => `pw:d:${d}:meta`,
  genClaim: (d: DayKey, g: number): string => `pw:claim:gen:${d}:${g}`,
  tiles: (d: DayKey, g: number): string => `pw:d:${d}:g:${g}:tiles`,
  ctr: (d: DayKey, g: number): string => `pw:d:${d}:g:${g}:ctr`,
  solves: (d: DayKey, g: number): string => `pw:d:${d}:g:${g}:solves`,
  first: (d: DayKey, g: number): string => `pw:d:${d}:g:${g}:first`,
  userDay: (d: DayKey, u: string): string => `pw:d:${d}:u:${u}`,
  lb: (d: DayKey): string => `pw:d:${d}:lb`,
  helpers: (d: DayKey): string => `pw:d:${d}:helpers`,
  timedist: 'pw:timedist',
  user: (u: string): string => `pw:u:${u}`,
  userDays: (u: string): string => `pw:u:${u}:days`,
  dirty: 'pw:dirty',
  rt: (d: DayKey, w: number): string => `pw:rt:${d}:${w}`,
  ugc: 'pw:ugc',
  ugcPending: 'pw:ugc:pending',
  /** Cache-helper keys (F31); the helper namespaces them itself. */
  cacheSnapshot: (d: DayKey): string => `pw-snap-${d}`,
  cacheMods: 'pw-mods',
} as const;

/** Fields of the user-day hash `pw:d:{d}:u:{u}`. */
export const F = {
  scored: (g: number): string => `s:${g}`,
  extra: (g: number): string => `x:${g}`,
  stitched: (g: number, t: number): string => `st:${g}:${t}`,
  mistakes: (g: number): string => `m:${g}`,
  scoredDone: 'sd',
  result: 'r',
  help: 'h',
  firstStitchAt: 'f',
  firstInteraction: 'fi',
  share: (nonce: string): string => `sh:${nonce}`,
} as const;

/** Fields of the meta hash `pw:d:{d}:meta`. */
export const M = {
  postId: 'postId',
  dayNumber: 'dayNumber',
  tileSize: 'tileSize',
  startDate: 'startDate',
  activeGen: 'activeGen',
  genSeq: 'genSeq',
  seed: (g: number): string => `g${g}:seed`,
  motifIndex: (g: number): string => `g${g}:motifIndex`,
  variant: (g: number): string => `g${g}:variant`,
  motif: (g: number): string => `g${g}:motif`,
  source: (g: number): string => `g${g}:source`,
  done: (g: number): string => `g${g}:done`,
  sticky: 'sticky',
  previewS: 'previewS',
} as const;

/** 14 days, the retention of per-player per-day data (Decision D12). */
export const RETENTION_SECONDS = 1_209_600;
export const CLAIM_SECONDS = 45;
