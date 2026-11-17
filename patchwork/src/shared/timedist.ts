export const TIME_BUCKETS = 51;
export const PERCENTILE_MIN_ENTRIES = 10;

/** Buckets 0 to 49 are 0.1 Par wide; bucket 50 holds 5.0 Par or more. */
export function bucketFor(solveMs: number, parSeconds: number): number {
  return Math.min(TIME_BUCKETS - 1, Math.max(0, Math.floor(solveMs / (parSeconds * 100))));
}

/**
 * Share of entries in slower buckets plus half of the other entries in the user's own bucket, as an integer
 * percentage with halves rounded up. Null below 10 entries or when the user's bucket is empty.
 */
export function percentileFor(counts: readonly number[], userBucket: number): number | null {
  let total = 0;
  let slower = 0;
  for (let b = 0; b < counts.length; b++) {
    const c = Math.max(0, Math.floor(counts[b] ?? 0));
    total += c;
    if (b > userBucket) slower += c;
  }
  const own = Math.max(0, Math.floor(counts[userBucket] ?? 0));
  if (total < PERCENTILE_MIN_ENTRIES || own < 1) return null;
  return Math.floor((100 * (2 * slower + own - 1) + total) / (2 * total));
}
