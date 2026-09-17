import { useCallback, useEffect, useRef, useState } from 'react';

/** A countdown that survives re-renders and ticks on wall-clock time, not intervals. */
export function useTimer(totalSeconds: number, key: string) {
  const [remaining, setRemaining] = useState(totalSeconds);
  const [running, setRunning] = useState(false);
  const endAt = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  // Reset when the step (key) or its duration changes — state is adjusted during render; the
  // deadline ref is cleared by the running-effect's cleanup when `running` flips to false.
  const [seen, setSeen] = useState({ totalSeconds, key });
  if (seen.totalSeconds !== totalSeconds || seen.key !== key) {
    setSeen({ totalSeconds, key });
    setRemaining(totalSeconds);
    setRunning(false);
  }

  useEffect(() => {
    if (!running) {
      endAt.current = null;
      return;
    }
    const tick = () => {
      if (endAt.current == null) return;
      const left = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        setRunning(false);
        endAt.current = null;
        chime();
        return;
      }
      raf.current = window.setTimeout(tick, 250);
    };
    tick();
    return () => {
      if (raf.current) window.clearTimeout(raf.current);
    };
  }, [running]);

  const start = useCallback(() => {
    if (remaining <= 0) return;
    endAt.current = Date.now() + remaining * 1000;
    setRunning(true);
  }, [remaining]);
  const pause = useCallback(() => {
    setRunning(false);
    endAt.current = null;
  }, []);
  const reset = useCallback(() => {
    setRunning(false);
    endAt.current = null;
    setRemaining(totalSeconds);
  }, [totalSeconds]);
  const toggle = useCallback(() => (running ? pause() : start()), [running, pause, start]);

  return { remaining, running, start, pause, reset, toggle, done: remaining <= 0 };
}

function chime() {
  try {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.value = 0.0001;
      o.connect(g).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.28;
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.start(t);
      o.stop(t + 0.3);
    });
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } catch {
    /* audio is a nicety */
  }
}
