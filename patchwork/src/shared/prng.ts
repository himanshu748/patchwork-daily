/** FNV-1a 32-bit over the UTF-16 code units of `text`. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function seedFor(...parts: readonly (string | number)[]): number {
  return fnv1a32(parts.join('|'));
}

export interface Prng {
  nextU32(): number;
  /** Uniform integer in [0, maxExclusive), unbiased by rejection sampling. */
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

const TWO_POW_32 = 4_294_967_296;

/** mulberry32: 32-bit integer state, Math.imul only, identical on every JS engine. */
export function createPrng(seed: number): Prng {
  let state = seed >>> 0;
  const nextU32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > TWO_POW_32) {
      throw new RangeError('maxExclusive must be an integer from 1 to 2^32');
    }
    const limit = TWO_POW_32 - (TWO_POW_32 % maxExclusive);
    for (;;) {
      const x = nextU32();
      if (x < limit) return x % maxExclusive;
    }
  };
  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
    return items[int(items.length)] as T;
  };
  return { nextU32, int, pick };
}

/** Deterministic Fisher-Yates shuffle that returns a new array. */
export function shuffled<T>(items: readonly T[], prng: Prng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = prng.int(i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
