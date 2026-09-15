import { isRouteErrorResponse, Link, Outlet, useRouteError } from 'react-router';
import { ToastProvider } from '../components/Toast';
import { Wordmark } from '../components/Logo';

export function Root() {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

export function ErrorPage() {
  const err = useRouteError();
  let title = 'Something went wrong';
  let detail = 'Reload the page. If it keeps happening, the API server may be down.';
  if (isRouteErrorResponse(err)) {
    title = err.status === 404 ? 'That page doesn’t exist' : `Error ${err.status}`;
    detail = err.status === 404 ? 'Check the address, or head back to your recipes.' : err.statusText;
  } else if (err instanceof Error) {
    detail = err.message;
  }
  return (
    <main className="page-narrow stack-lg" style={{ paddingTop: 'var(--s-8)' }}>
      <Wordmark />
      <div className="stack">
        <h1>{title}</h1>
        <p className="muted measure">{detail}</p>
      </div>
      <div className="row">
        <Link to="/app" className="btn btn-primary">
          Go to my recipes
        </Link>
        <Link to="/" className="btn">
          Home
        </Link>
      </div>
    </main>
  );
}
