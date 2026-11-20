import { useEffect, useState } from 'react';
import type { ColourMode } from '../../shared/palette';
import { currentMode, prefersReducedMotion, watchMode, watchReducedMotion } from '../lib/theme';

export function useColourMode(): ColourMode {
  const [mode, setMode] = useState(currentMode);
  useEffect(() => watchMode(setMode), []);
  return mode;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => watchReducedMotion(setReduced), []);
  return reduced;
}

/** Date.now(), refreshed every `intervalMs`. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useViewportWidth(): number {
  const read = (): number => document.documentElement.clientWidth || window.innerWidth;
  const [width, setWidth] = useState(read);
  useEffect(() => {
    const onResize = (): void => setWidth(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}
