import { useEffect, useRef, type ReactNode } from 'react';
import { initials } from '../lib/format';

export function Avatar({ name, emoji, size = 'md' }: { name: string; emoji?: string | null; size?: 'md' | 'lg' }) {
  return (
    <span className={`avatar${size === 'lg' ? ' avatar-lg' : ''}${emoji ? ' avatar-emoji' : ''}`} aria-hidden="true">
      {emoji || initials(name) || '·'}
    </span>
  );
}

export function EmojiPicker({ options, value, onChange, allowCustom }: { options: readonly string[]; value: string; onChange: (v: string) => void; allowCustom?: boolean }) {
  return (
    <div className="row" style={{ gap: 'var(--s-3)' }}>
      <div className="emoji-pick" role="radiogroup">
        {options.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={value === e} aria-pressed={value === e} onClick={() => onChange(e)} aria-label={e}>
            {e}
          </button>
        ))}
      </div>
      {allowCustom && (
        <input
          className="input"
          style={{ width: 72, minHeight: 40, textAlign: 'center', fontSize: 20 }}
          value={options.includes(value) ? '' : value}
          placeholder="✨"
          maxLength={8}
          aria-label="Custom emoji"
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 'var(--s-4)' }}>{action}</div>}
    </div>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  multi = true,
  labels,
}: {
  options: readonly T[];
  value: T[] | T;
  onChange: (next: T[] | T) => void;
  multi?: boolean;
  labels?: Partial<Record<T, string>>;
}) {
  const selected = new Set(Array.isArray(value) ? value : [value]);
  return (
    <div className="chips" role={multi ? 'group' : 'radiogroup'}>
      {options.map((o) => {
        const on = selected.has(o);
        return (
          <button
            key={o}
            type="button"
            className="chip"
            aria-pressed={multi ? on : undefined}
            role={multi ? undefined : 'radio'}
            aria-checked={multi ? undefined : on}
            data-on={on || undefined}
            onClick={() => {
              if (!multi) return onChange(o);
              const next = new Set(selected);
              if (on) next.delete(o);
              else next.add(o);
              onChange([...next] as T[]);
            }}
          >
            {labels?.[o] ?? o}
          </button>
        );
      })}
    </div>
  );
}

/** Free-text chips: type, press Enter or comma to add. */
export function TagInput({ value, onChange, placeholder, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: readonly string[] }) {
  const ref = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const t = raw.trim().replace(/,+$/, '').trim();
    if (!t || value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t]);
  };
  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }}>
      {suggestions.length > 0 && (
        <div className="chips">
          {suggestions.map((s) => {
            const on = value.some((v) => v.toLowerCase() === s.toLowerCase());
            return (
              <button key={s} type="button" className="chip" aria-pressed={on} onClick={() => (on ? onChange(value.filter((v) => v.toLowerCase() !== s.toLowerCase())) : add(s))}>
                {s}
              </button>
            );
          })}
        </div>
      )}
      <div className="chips">
        {value
          .filter((v) => !suggestions.some((s) => s.toLowerCase() === v.toLowerCase()))
          .map((v) => (
            <button key={v} type="button" className="chip is-on" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
              {v} <span aria-hidden="true">×</span>
            </button>
          ))}
        <input
          ref={ref}
          className="input"
          style={{ maxWidth: 260, minHeight: 36 }}
          placeholder={placeholder ?? 'Add your own…'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(e.currentTarget.value);
              e.currentTarget.value = '';
            }
          }}
          onBlur={(e) => {
            add(e.currentTarget.value);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="stack" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 style={{ fontSize: 'var(--t-20)' }}>{title}</h2>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status" style={{ gap: 10 }}>
      <span className="spinner" />
      {label && <span className="muted small">{label}</span>}
    </span>
  );
}

export function Meta({ items }: { items: (string | { label: string; value: string })[] }) {
  return (
    <div className="meta">
      {items.map((it, i) =>
        typeof it === 'string' ? (
          <span key={i}>{it}</span>
        ) : (
          <span key={i}>
            <b>{it.value}</b> {it.label}
          </span>
        ),
      )}
    </div>
  );
}
