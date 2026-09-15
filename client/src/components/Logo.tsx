import { Link } from 'react-router';

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--sage)" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="var(--sage-ink)" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="2.2" fill="var(--sage-ink)" />
    </svg>
  );
}

export function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="wordmark" aria-label="foodi home">
      <Mark />
      <span>foodi</span>
    </Link>
  );
}
