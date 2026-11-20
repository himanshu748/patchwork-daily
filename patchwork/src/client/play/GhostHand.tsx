import { useEffect, useState } from 'react';
import type { GhostPlan } from '../../shared/ghost';

const STEP_MS = 450;
const HOLD_MS = 900;

/**
 * A hand that taps the Cells the first row Clue forces, with no text (Req 10.10). The Cells it shows are
 * drawn over the grid and never enter the play state, so stopping it leaves nothing behind (Req 10.11).
 * Under reduced motion it is a still image over the first Cell (Req 26.8).
 */
export function GhostHand(props: {
  readonly plan: GhostPlan;
  readonly cell: number;
  readonly reducedMotion: boolean;
  readonly onDone: () => void;
}) {
  const { plan, cell, reducedMotion, onDone } = props;
  const targets = plan.cells.length > 0 ? plan.cells : [0];
  const [step, setStep] = useState(0);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (reducedMotion) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    targets.forEach((_, i) => timers.push(setTimeout(() => setStep(i + 1), STEP_MS * (i + 1))));
    // With no forced Cell the tap fills and clears the first Cell without leaving a state.
    const clearAt = STEP_MS * (targets.length + 1) + (plan.cells.length > 0 ? HOLD_MS : 0);
    timers.push(setTimeout(() => setCleared(true), clearAt));
    timers.push(setTimeout(onDone, clearAt + STEP_MS));
    return () => timers.forEach(clearTimeout);
    // The plan is fixed for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const handIndex = reducedMotion ? 0 : Math.min(Math.max(step - 1, 0), targets.length - 1);
  const handCol = targets[handIndex] ?? 0;
  const shown = reducedMotion || cleared ? [] : targets.slice(0, step);

  return (
    <div className="ghost" aria-hidden="true">
      {shown.map((c) => (
        <div key={c} className="ghost-cell" style={{ left: c * cell, top: plan.row * cell, width: cell, height: cell }} />
      ))}
      {!cleared && (
        <svg
          className={step > 0 && !reducedMotion ? 'ghost-hand tapping' : 'ghost-hand'}
          viewBox="0 0 32 40"
          width={cell * 0.8}
          height={cell}
          style={{ transform: `translate(${handCol * cell + cell * 0.35}px, ${plan.row * cell + cell * 0.45}px)` }}
        >
          <path
            d="M10 4a3 3 0 0 1 6 0v13l2-1a3 3 0 0 1 3 1l1-0.5a3 3 0 0 1 3 1.5l1-0.3a3 3 0 0 1 3 2.3V30a8 8 0 0 1-8 8h-4a9 9 0 0 1-7-3.5L3 27a2.6 2.6 0 0 1 4-3.4l3 3z"
          />
        </svg>
      )}
    </div>
  );
}
