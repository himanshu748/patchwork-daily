export interface SoundPlayer {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  playStitch(): void;
}

/** WebAudio oscillators, no audio files. Off at every open; suspended while the page is hidden (Req 16.7 to Req 16.9, F17). */
export function createSoundPlayer(): SoundPlayer {
  let enabled = false;
  let ctx: AudioContext | null = null;

  const warn = (e: unknown): void => console.warn('Sound unavailable', e);

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') ctx.suspend().catch(warn);
    else if (enabled) ctx.resume().catch(warn);
  });

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on: boolean) {
      enabled = on;
      if (!on) {
        ctx?.suspend().catch(warn);
        return;
      }
      try {
        // Created inside the toggle's click so the browser allows audio.
        ctx ??= new AudioContext();
        ctx.resume().catch(warn);
      } catch (e) {
        warn(e);
      }
    },
    playStitch() {
      if (!enabled || !ctx || document.visibilityState === 'hidden') return;
      const start = ctx.currentTime;
      [523.25, 783.99].forEach((freq, i) => {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = start + i * 0.12;
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.32);
      });
    },
  };
}
