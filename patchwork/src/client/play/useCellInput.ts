import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { TileSize } from '../../shared/daykey';
import type { Direction, PlayAction } from '../../shared/play';
import { moveFocus } from '../../shared/play';

export const LONG_PRESS_MS = 400;

const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
const CELL_KEYS: Readonly<Record<string, 'Space' | 'KeyX' | 'Backspace' | 'Delete'>> = {
  ' ': 'Space',
  x: 'KeyX',
  X: 'KeyX',
  Backspace: 'Backspace',
  Delete: 'Delete',
};

interface Press {
  readonly pointerId: number;
  readonly start: number;
  last: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface CellInputOptions {
  /** True while submitting or animating; every Cell input is ignored (Req 10.9, Req 16.4). */
  readonly disabled: boolean;
  /** Called before any input is applied, so the Ghost_Hand can stop first (Req 10.11). */
  readonly onInput: () => void;
}

export interface GridProps {
  readonly ref: (el: HTMLDivElement | null) => void;
  readonly onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Pointer and keyboard input for the Play_Screen grid (design.md "Play_Screen input model"). The grid is
 * one tab stop with roving focus; Cells are found from the pointer position, so a drag works across Cells.
 */
export function useCellInput(
  size: TileSize,
  dispatch: (a: PlayAction) => void,
  opts: CellInputOptions,
): { readonly gridProps: GridProps; readonly focusCell: number } {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const press = useRef<Press | null>(null);
  const [focusCell, setFocusCell] = useState(0);
  const keyboardMoved = useRef(false);
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    optsRef.current = opts;
  });

  const cellAt = useCallback(
    (clientX: number, clientY: number): number => {
      const grid = gridRef.current;
      if (!grid) return -1;
      const r = grid.getBoundingClientRect();
      const col = Math.floor(((clientX - r.left) / r.width) * size);
      const row = Math.floor(((clientY - r.top) / r.height) * size);
      if (col < 0 || row < 0 || col >= size || row >= size) return -1;
      return row * size + col;
    },
    [size],
  );

  const end = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      clearTimeout(p.timer);
      press.current = null;
      if (e.type === 'pointercancel') {
        dispatch({ type: 'cancelPress' });
        return;
      }
      dispatch({ type: 'release' });
      setFocusCell(p.start);
      gridRef.current?.querySelector<HTMLElement>(`[data-cell="${p.start}"]`)?.focus({ preventScroll: true });
    },
    [dispatch],
  );

  useEffect(() => {
    if (!keyboardMoved.current) return;
    keyboardMoved.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${focusCell}"]`)?.focus();
  }, [focusCell]);

  useEffect(() => () => clearTimeout(press.current?.timer), []);

  const gridProps: GridProps = {
    ref: (el) => {
      gridRef.current = el;
    },
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      optsRef.current.onInput();
      if (optsRef.current.disabled || press.current) return;
      const cell = cellAt(e.clientX, e.clientY);
      if (cell < 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const p: Press = { pointerId: e.pointerId, start: cell, last: cell, timer: undefined };
      p.timer = setTimeout(() => {
        if (press.current === p && p.last === p.start) dispatch({ type: 'longPress', cell });
      }, LONG_PRESS_MS);
      press.current = p;
      dispatch({ type: 'press', cell });
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      const cell = cellAt(e.clientX, e.clientY);
      if (cell < 0 || cell === p.last) return;
      p.last = cell;
      clearTimeout(p.timer);
      dispatch({ type: 'dragTo', cell });
    },
    onPointerUp: end,
    onPointerCancel: end,
    onKeyDown: (e) => {
      const dir = ARROWS[e.key];
      const key = CELL_KEYS[e.key];
      if (!dir && !key) return;
      e.preventDefault();
      optsRef.current.onInput();
      if (dir) {
        keyboardMoved.current = true;
        setFocusCell((f) => moveFocus(f, dir, size));
      } else if (key && !optsRef.current.disabled) {
        dispatch({ type: 'key', key, cell: focusCell });
      }
    },
  };

  return { gridProps, focusCell };
}
