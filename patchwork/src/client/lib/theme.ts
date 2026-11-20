import type { ColourMode } from '../../shared/palette';

const DARK = '(prefers-color-scheme: dark)';
const REDUCE = '(prefers-reduced-motion: reduce)';

function query(q: string): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(q) : null;
}

function watch(q: string, onChange: (matches: boolean) => void): () => void {
  const mql = query(q);
  if (!mql) return () => {};
  const listener = (e: MediaQueryListEvent): void => onChange(e.matches);
  mql.addEventListener('change', listener);
  return () => mql.removeEventListener('change', listener);
}

export function currentMode(): ColourMode {
  return query(DARK)?.matches ? 'dark' : 'light';
}

export function watchMode(onChange: (mode: ColourMode) => void): () => void {
  return watch(DARK, (dark) => onChange(dark ? 'dark' : 'light'));
}

export function prefersReducedMotion(): boolean {
  return query(REDUCE)?.matches ?? false;
}

export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  return watch(REDUCE, onChange);
}
