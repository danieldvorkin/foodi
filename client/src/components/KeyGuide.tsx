import { useState, type FormEvent, type ReactNode } from 'react';

/**
 * Getting an API key, step by step, for people who have never seen a developer console: four
 * cards, each with a picture of what they'll see, one instruction, and a button to the exact
 * page. Ticks are remembered per vendor so coming back from the other tab keeps their place.
 */
export type GuideVendor = 'openai' | 'anthropic';

interface Step {
  title: string;
  detail: ReactNode;
  href?: string;
  cta?: string;
  art: ReactNode;
}

const COST = 'About 2¢ per recipe, so $5 is roughly 200 recipes.';

function stepsFor(vendor: GuideVendor): Step[] {
  if (vendor === 'openai') {
    return [
      { title: 'Create a free OpenAI platform account', detail: <>This is OpenAI’s developer site — separate from ChatGPT. A ChatGPT subscription doesn’t include it, and you don’t need one.</>, href: 'https://platform.openai.com/signup', cta: 'Open platform.openai.com ↗', art: <ArtAccount brand="OpenAI" /> },
      { title: 'Add $5 of credit', detail: <>{COST} Under Billing, add a payment method and buy $5. You can switch auto-recharge off.</>, href: 'https://platform.openai.com/settings/organization/billing/overview', cta: 'Open Billing ↗', art: <ArtCredit /> },
      { title: 'Create a secret key', detail: <>On the API keys page click <b>Create new secret key</b>, name it <b>foodi</b>, then <b>Copy</b>. It’s shown once — if you lose it, make another.</>, href: 'https://platform.openai.com/api-keys', cta: 'Open API keys ↗', art: <ArtKey label="Create new secret key" prefix="sk-proj-" /> },
      { title: 'Paste it here', detail: <>foodi checks it with one tiny request (a fraction of a cent) and tells you if the account still needs credit. Then it’s encrypted and never shown again.</>, art: <ArtPaste /> },
    ];
  }
  return [
    { title: 'Create a free Anthropic Console account', detail: <>The Console is Anthropic’s developer site — separate from the Claude app. A Claude subscription doesn’t include it, and you don’t need one.</>, href: 'https://console.anthropic.com/', cta: 'Open console.anthropic.com ↗', art: <ArtAccount brand="Anthropic" /> },
    { title: 'Add $5 of credit', detail: <>{COST} Under Billing, add a payment method and buy $5 of credit.</>, href: 'https://console.anthropic.com/settings/billing', cta: 'Open Billing ↗', art: <ArtCredit /> },
    { title: 'Create an API key', detail: <>On the API keys page click <b>Create Key</b>, name it <b>foodi</b>, then <b>Copy</b>. It’s shown once — if you lose it, make another.</>, href: 'https://console.anthropic.com/settings/keys', cta: 'Open API keys ↗', art: <ArtKey label="Create Key" prefix="sk-ant-" /> },
    { title: 'Paste it here', detail: <>foodi checks it with one tiny request (a fraction of a cent) and tells you if the account still needs credit. Then it’s encrypted and never shown again.</>, art: <ArtPaste /> },
  ];
}

function readDone(vendor: GuideVendor): Set<number> {
  try {
    const raw = localStorage.getItem(`foodi.keyguide.${vendor}`);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}
function writeDone(vendor: GuideVendor, done: Set<number>) {
  try {
    localStorage.setItem(`foodi.keyguide.${vendor}`, JSON.stringify([...done]));
  } catch {
    /* private mode: ticks just don't persist */
  }
}

export function KeyGuide({ vendor, keyValue, onKeyChange, onSubmit, busy, error, prefix }: { vendor: GuideVendor; keyValue: string; onKeyChange: (v: string) => void; onSubmit: () => void; busy: boolean; error: string | null; prefix: string }) {
  const steps = stepsFor(vendor);
  const [done, setDone] = useState<Set<number>>(() => readDone(vendor));
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const current = steps.findIndex((_, i) => i < steps.length - 1 && !done.has(i));
  const active = current === -1 ? steps.length - 1 : current;

  function toggle(i: number) {
    setDone((d) => {
      const n = new Set(d);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      writeDone(vendor, n);
      return n;
    });
  }

  async function paste() {
    setPasteNote(null);
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) setPasteNote('Nothing on the clipboard yet — copy the key first.');
      else onKeyChange(text);
    } catch {
      setPasteNote('Couldn’t read the clipboard — paste into the box instead.');
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <ol className="keyguide" aria-label="Steps">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={i} className={`keyguide-step${i === active ? ' is-active' : ''}${done.has(i) ? ' is-done' : ''}`} aria-current={i === active ? 'step' : undefined}>
            <div className="keyguide-art" aria-hidden="true">
              {s.art}
            </div>
            <div className="keyguide-body">
              <h2>
                <span className="keyguide-n num">{i + 1}</span> {s.title}
              </h2>
              <p className="muted">{s.detail}</p>
              {last ? (
                <form className="keyguide-form" onSubmit={submit}>
                  <label htmlFor="key" className="sr-only">
                    API key
                  </label>
                  <div className="keyguide-paste">
                    <input id="key" className="input input-lg" type="password" autoComplete="off" spellCheck={false} placeholder={`${prefix}…`} value={keyValue} onChange={(e) => onKeyChange(e.target.value)} required minLength={20} />
                    <button type="button" className="btn" onClick={paste} title="Paste from the clipboard">
                      📋 Paste
                    </button>
                  </div>
                  {pasteNote && <p className="hint">{pasteNote}</p>}
                  {error && (
                    <p className="error-text" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="btn btn-primary btn-lg" type="submit" disabled={busy || keyValue.trim().length < 20}>
                    {busy ? 'Checking key…' : 'Connect'}
                  </button>
                </form>
              ) : (
                <div className="keyguide-actions">
                  <a href={s.href} target="_blank" rel="noreferrer noopener" className={`btn${i === active ? ' btn-primary' : ''}`}>
                    {s.cta}
                  </a>
                  <label className="keyguide-tick">
                    <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} /> Done
                  </label>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---- pictures: what each page roughly looks like, in foodi's palette ---- */

function Window({ children, title }: { children: ReactNode; title: string }) {
  return (
    <svg viewBox="0 0 220 132" className="keyguide-svg">
      <rect x="1" y="1" width="218" height="130" rx="10" fill="var(--plate)" stroke="var(--line-strong)" />
      <rect x="1" y="1" width="218" height="22" rx="10" fill="var(--flour)" />
      <rect x="1" y="12" width="218" height="11" fill="var(--flour)" />
      <circle cx="14" cy="12" r="3.5" fill="var(--line-strong)" />
      <circle cx="25" cy="12" r="3.5" fill="var(--line-strong)" />
      <circle cx="36" cy="12" r="3.5" fill="var(--line-strong)" />
      <text x="110" y="16" textAnchor="middle" fontSize="8" fill="var(--stone)" fontFamily="inherit">
        {title}
      </text>
      {children}
    </svg>
  );
}

function ArtAccount({ brand }: { brand: string }) {
  return (
    <Window title={brand === 'OpenAI' ? 'platform.openai.com' : 'console.anthropic.com'}>
      <text x="110" y="52" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink)" fontFamily="inherit">
        Create your account
      </text>
      <rect x="55" y="62" width="110" height="16" rx="5" fill="var(--ground)" stroke="var(--line)" />
      <text x="62" y="73" fontSize="8" fill="var(--mute)" fontFamily="inherit">
        you@example.com
      </text>
      <rect x="55" y="86" width="110" height="18" rx="6" fill="var(--sage)" />
      <text x="110" y="98" textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--sage-ink)" fontFamily="inherit">
        Sign up
      </text>
      <text x="110" y="120" textAnchor="middle" fontSize="7" fill="var(--mute)" fontFamily="inherit">
        {brand === 'OpenAI' ? 'not the same as ChatGPT' : 'not the same as the Claude app'}
      </text>
    </Window>
  );
}

function ArtCredit() {
  return (
    <Window title="Billing">
      <rect x="22" y="36" width="176" height="60" rx="8" fill="var(--sage-soft)" stroke="var(--line)" />
      <text x="34" y="54" fontSize="8" fill="var(--stone)" fontFamily="inherit">
        Credit balance
      </text>
      <text x="34" y="80" fontSize="22" fontWeight="600" fill="var(--sage)" fontFamily="inherit">
        $5.00
      </text>
      <rect x="118" y="60" width="68" height="18" rx="6" fill="var(--sage)" />
      <text x="152" y="72" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="var(--sage-ink)" fontFamily="inherit">
        + Add credit
      </text>
      <text x="110" y="116" textAnchor="middle" fontSize="7.5" fill="var(--mute)" fontFamily="inherit">
        ≈ 200 recipes · auto-recharge can stay off
      </text>
    </Window>
  );
}

function ArtKey({ label, prefix }: { label: string; prefix: string }) {
  return (
    <Window title="API keys">
      <rect x="22" y="32" width="176" height="18" rx="6" fill="var(--sage)" />
      <text x="110" y="44" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="var(--sage-ink)" fontFamily="inherit">
        {label}
      </text>
      <text x="26" y="66" fontSize="7.5" fill="var(--stone)" fontFamily="inherit">
        Name
      </text>
      <rect x="22" y="70" width="80" height="16" rx="5" fill="var(--ground)" stroke="var(--line)" />
      <text x="28" y="81" fontSize="8" fill="var(--ink)" fontFamily="inherit">
        foodi
      </text>
      <rect x="22" y="96" width="140" height="18" rx="5" fill="var(--ground)" stroke="var(--line)" />
      <text x="28" y="108" fontSize="8" fill="var(--ink)" fontFamily="ui-monospace, monospace">
        {prefix}•••••••••••••
      </text>
      <rect x="166" y="96" width="32" height="18" rx="5" fill="var(--flour)" stroke="var(--line-strong)" />
      <text x="182" y="108" textAnchor="middle" fontSize="7.5" fill="var(--ink)" fontFamily="inherit">
        Copy
      </text>
    </Window>
  );
}

function ArtPaste() {
  return (
    <Window title="foodi">
      <rect x="22" y="48" width="140" height="22" rx="6" fill="var(--ground)" stroke="var(--sage)" />
      <text x="30" y="62" fontSize="8" fill="var(--ink)" fontFamily="ui-monospace, monospace">
        sk-••••••••••••••••
      </text>
      <rect x="166" y="48" width="32" height="22" rx="6" fill="var(--flour)" stroke="var(--line-strong)" />
      <text x="182" y="62" textAnchor="middle" fontSize="7.5" fill="var(--ink)" fontFamily="inherit">
        Paste
      </text>
      <circle cx="40" cy="96" r="9" fill="var(--sage)" />
      <path d="M35 96 l3.5 3.5 6.5-7" fill="none" stroke="var(--sage-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="56" y="99" fontSize="8.5" fill="var(--ink)" fontFamily="inherit">
        Connected — go cook something
      </text>
    </Window>
  );
}
