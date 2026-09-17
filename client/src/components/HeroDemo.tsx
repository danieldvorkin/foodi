import { useEffect, useState } from 'react';
import { clock } from '../lib/format';

const DEMO = {
  title: 'Crispy chicken thighs with lemon and greens',
  steps: [
    { title: 'Dry the skin', text: 'Pat the thighs dry and salt both sides. Dry skin is what crisps.', timer: 0, need: ['chicken thighs', 'salt'] },
    { title: 'Sear skin-side down', text: 'Lay them in a cold pan, skin down. Turn the heat to medium and don’t move them until the skin releases on its own.', timer: 480, need: ['chicken thighs', 'olive oil'] },
    { title: 'Flip and finish', text: 'Flip, add the garlic and lemon halves cut-side down, and cook until the juices run clear.', timer: 300, need: ['garlic', 'lemon'] },
    { title: 'Wilt the greens', text: 'Take the chicken out to rest. Toss the kale into the pan drippings until just wilted.', timer: 120, need: ['kale'] },
  ],
};

/** The landing hero: a real cook-mode step, ticking. Reduced motion shows a still frame. */
export function HeroDemo() {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [i, setI] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const step = DEMO.steps[i]!;

  // One ticking clock; every seven seconds it moves to the next step.
  useEffect(() => {
    if (reduce) return;
    const tick = window.setInterval(() => {
      setElapsed((e) => {
        if (e + 1 >= 7) {
          setI((x) => (x + 1) % DEMO.steps.length);
          return 0;
        }
        return e + 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [reduce]);

  const total = step.timer || 1;
  const remaining = reduce ? Math.round(total * 0.62) : Math.max(0, step.timer - elapsed * Math.max(1, Math.round(step.timer / 40)));
  const frac = step.timer ? 1 - remaining / total : 0;

  return (
    <div className="hero-demo" aria-label="Preview of cook mode">
      <div className="hero-demo-top">
        <span className="num">
          Step {i + 1} of {DEMO.steps.length}
        </span>
        <span className="muted">{DEMO.title}</span>
      </div>
      <h3 key={`t${i}`} className="hero-demo-title">
        {step.title}
      </h3>
      <p key={`p${i}`} className="hero-demo-text">
        {step.text}
      </p>
      <div className="hero-demo-bottom">
        <div className="hero-demo-need">
          {step.need.map((n) => (
            <span key={n} className="chip chip-static">
              {n}
            </span>
          ))}
        </div>
        {step.timer > 0 && (
          <div className="timer-pill" aria-hidden="true">
            <Ring fraction={frac} size={30} />
            <span className="num">{clock(remaining)}</span>
          </div>
        )}
      </div>
      <div className="hero-demo-dots" aria-hidden="true">
        {DEMO.steps.map((_, k) => (
          <span key={k} className={k === i ? 'is-on' : k < i ? 'is-done' : ''} />
        ))}
      </div>
    </div>
  );
}

export function Ring({ fraction, size = 30, stroke = 3 }: { fraction: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--sage)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, fraction)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.9s linear' }}
      />
    </svg>
  );
}
