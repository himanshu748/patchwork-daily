import type { SoundPlayer } from '../lib/sound';

/** Inside the 400 to 1,200 ms range of Req 16.2. */
export const STITCH_MS = 800;
/** Reduced motion: a fade of at most 200 ms with no movement (Req 16.3, Req 26.9). */
export const STITCH_FADE_MS = 200;

function place(el: HTMLElement, r: DOMRect): void {
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
}

/** Moves the solved Tile image from the grid to its slot in the Mosaic, then removes it. Always resolves. */
export function playStitch(
  from: DOMRect,
  to: DOMRect,
  tileImage: HTMLCanvasElement,
  opts: { readonly reducedMotion: boolean; readonly sound: SoundPlayer },
): Promise<void> {
  return new Promise((resolve) => {
    const el = tileImage;
    el.className = 'stitch-flyer';
    el.setAttribute('aria-hidden', 'true');
    place(el, opts.reducedMotion ? to : from);
    document.body.appendChild(el);
    opts.sound.playStitch();

    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      el.remove();
      resolve();
    };
    const duration = opts.reducedMotion ? STITCH_FADE_MS : STITCH_MS;
    setTimeout(finish, duration + 400);
    if (typeof el.animate !== 'function') {
      finish();
      return;
    }
    const animation = opts.reducedMotion
      ? el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'linear', fill: 'forwards' })
      : el.animate(
          [
            { transform: 'translate(0px, 0px) scale(1)' },
            { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})` },
          ],
          { duration, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'forwards' },
        );
    animation.finished.then(finish, finish);
  });
}
