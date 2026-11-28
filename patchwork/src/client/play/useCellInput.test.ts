import { expect, it, vi } from 'vitest';
import { useCellInput } from './useCellInput';

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
}));

it.each([
  { type: 'pointerup', action: 'release', shouldFocus: true },
  { type: 'pointercancel', action: 'cancelPress', shouldFocus: false },
])('updates actual focus only when the pointer gesture ends with $type', ({ type, action, shouldFocus }) => {
  const dispatch = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- The mocked hooks let the input handlers run without a DOM.
  const { gridProps } = useCellInput(5, dispatch, { disabled: false, onInput: vi.fn() });
  const focus = vi.fn();
  const querySelector = vi.fn(() => ({ focus }));
  const grid = {
    querySelector,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
  gridProps.ref(grid as unknown as Parameters<typeof gridProps.ref>[0]);

  const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 30, clientY: 30, currentTarget: grid, preventDefault: vi.fn() };
  type GridPointer = Parameters<typeof gridProps.onPointerDown>[0];
  gridProps.onPointerDown({ ...pointer, type: 'pointerdown' } as unknown as GridPointer);
  const end = type === 'pointerup' ? gridProps.onPointerUp : gridProps.onPointerCancel;
  end({ ...pointer, type } as unknown as GridPointer);

  expect(dispatch.mock.calls).toEqual([[{ type: 'press', cell: 6 }], [{ type: action }]]);
  if (shouldFocus) {
    expect(querySelector).toHaveBeenCalledWith('[data-cell="6"]');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  } else {
    expect(focus).not.toHaveBeenCalled();
  }
});
