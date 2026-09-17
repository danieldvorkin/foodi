import { useEffect, useState } from 'react';
import { isRouteErrorResponse, Link, Outlet, ScrollRestoration, useRouteError } from 'react-router';
import { ApiError } from '../api/client';
import { ToastProvider } from '../components/Toast';
import { Wordmark } from '../components/Logo';

export function Root() {
  return (
    <ToastProvider>
      <Outlet />
      <ScrollRestoration />
    </ToastProvider>
  );
}

/** True when the API itself is unreachable or restarting (deploy, machine start), not a bug in the page. */
function isOutage(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504;
  if (isRouteErrorResponse(err)) return err.status >= 502 && err.status <= 504;
  return err instanceof TypeError && /fetch/i.test(err.message);
}

export function ErrorPage() {
  const err = useRouteError();
  const outage = isOutage(err);
  const [tries, setTries] = useState(0);

  // During a deploy the server is back within seconds; poll and reload rather than making people guess.
  useEffect(() => {
    if (!outage) return;
    const t = window.setInterval(async () => {
      setTries((n) => n + 1);
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        if (r.ok) window.location.reload();
      } catch {
        /* still down */
      }
    }, 4000);
    return () => window.clearInterval(t);
  }, [outage]);

  let title = 'Something went wrong';
  let detail = 'Reload the page. If it keeps happening, the API server may be down.';
  if (outage) {
    title = 'foodi is restarting';
    detail = 'The server is briefly unavailable — usually a deploy, which takes under a minute. This page will reload itself as soon as it’s back.';
  } else if (isRouteErrorResponse(err)) {
    title = err.status === 404 ? 'That page doesn’t exist' : `Error ${err.status}`;
    detail = err.status === 404 ? 'Check the address, or head back to the feed.' : err.statusText;
  } else if (err instanceof Error) {
    detail = err.message;
  }
  return (
    <main className="page-narrow stack-lg" style={{ paddingTop: 'var(--s-8)' }}>
      <Wordmark />
      <div className="stack">
        <h1>{title}</h1>
        <p className="muted measure">{detail}</p>
        {outage && (
          <p className="muted small" role="status">
            <span className="spinner" style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Checking again{tries ? ` (${tries})` : ''}…
          </p>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload now
        </button>
        <Link to="/app" className="btn">
          Go to the feed
        </Link>
      </div>
    </main>
  );
}
