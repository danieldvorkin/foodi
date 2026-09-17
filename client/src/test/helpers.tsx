import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';
import { ToastProvider } from '../components/Toast';

/** Render inside a router (so <Link>/<NavLink> work) and the toast provider. */
export function renderWithRouter(ui: ReactElement, { path = '/', routes = [] as RouteObject[] } = {}) {
  const router = createMemoryRouter([{ path, element: <ToastProvider>{ui}</ToastProvider> }, ...routes], { initialEntries: [path] });
  return { ...render(<RouterProvider router={router} />), router };
}

/** Stub `fetch` with a map of "METHOD /api/path" → response body (or a function of the request). */
export function stubApi(routes: Record<string, unknown | ((init: RequestInit | undefined, url: string) => unknown)>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]!;
      const key = Object.keys(routes).find((k) => {
        const [m, p] = k.split(' ');
        return m === method && p === path;
      });
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (!key) return new Response(JSON.stringify({ error: { code: 'not_found', message: `no stub for ${method} ${path}` } }), { status: 404, headers: { 'content-type': 'application/json' } });
      const value = routes[key];
      const body = typeof value === 'function' ? (value as (i: RequestInit | undefined, u: string) => unknown)(init, url) : value;
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

export function apiError(status: number, message: string) {
  return new Response(JSON.stringify({ error: { code: 'error', message } }), { status, headers: { 'content-type': 'application/json' } });
}
