import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { Me } from '@foodi/shared';
import { ToastProvider } from '../../components/Toast';
import { Connect, connectLoader } from '../connect';
import { stubApi } from '../../test/helpers';

const me: Me = {
  id: 'u1',
  role: 'consumer',
  displayName: 'Nell',
  email: 'nell@example.com',
  avatar: '🙂',
  handle: 'nell',
  signInMethods: ['password'],
  vendor: null,
  credentialKind: null,
  credentialHint: null,
  credentialUpdatedAt: null,
  hasProfile: true,
  permissions: [],
  autoPhotos: true,
  aiCapabilities: { images: false, vision: false },
  managed: null,
  managedAvailable: true,
  createdAt: new Date().toISOString(),
};
const providers = { providers: [{ id: 'openai-key', vendor: 'openai', label: 'Connect OpenAI (API key)', kind: 'api_key', note: null }, { id: 'anthropic-key', vendor: 'anthropic', label: 'Connect Claude', kind: 'api_key', note: null }], allowSignups: true, maintenanceMessage: '' };

function mount(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/connect', element: <ToastProvider><Connect /></ToastProvider>, loader: connectLoader },
      { path: '/connect/:vendor', element: <ToastProvider><Connect /></ToastProvider>, loader: connectLoader },
      { path: '/app', element: <p>the app</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('Connect', () => {
  beforeEach(() => window.localStorage.clear());
  it('offers foodi’s AI first when the server hands out keys, and one tap gets you cooking', async () => {
    const calls = stubApi({
      'GET /api/auth/me': me,
      'GET /api/auth/providers': providers,
      'POST /api/auth/managed': { ...me, vendor: 'openai', credentialKind: 'managed', managedAvailable: false, managed: { limitPerDay: 10, usedToday: 0, images: false } },
    });
    const router = mount('/connect');
    const button = await screen.findByRole('button', { name: 'Start cooking with foodi’s AI' });
    expect(screen.getByRole('link', { name: /OpenAI/ })).toHaveAttribute('href', '/connect/openai'); // your own is still right there
    await userEvent.setup().click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'));
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/auth/managed'))).toBe(true);
  });

  it('hides the fast path when the server doesn’t hand out keys', async () => {
    stubApi({ 'GET /api/auth/me': { ...me, managedAvailable: false }, 'GET /api/auth/providers': providers });
    mount('/connect');
    expect(await screen.findByRole('heading', { name: /Connect your AI/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /foodi’s AI/ })).toBeNull();
  });

  it('walks through bringing your own key in four illustrated steps, remembers ticks, and connects', async () => {
    const calls = stubApi({
      'GET /api/auth/me': me,
      'GET /api/auth/providers': providers,
      'POST /api/auth/key': { ...me, vendor: 'openai', credentialKind: 'api_key', credentialHint: 'cdef', managedAvailable: false },
    });
    const router = mount('/connect/openai');
    const steps = await screen.findAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(screen.getByRole('link', { name: /Open platform.openai.com/ })).toHaveAttribute('href', 'https://platform.openai.com/signup');
    expect(screen.getByRole('link', { name: /Open Billing/ })).toHaveAttribute('href', expect.stringContaining('billing'));
    expect(screen.getByRole('link', { name: /Open API keys/ })).toHaveAttribute('href', 'https://platform.openai.com/api-keys');
    expect(steps[0]).toHaveAttribute('aria-current', 'step');

    // Ticking a step moves the highlight on, and survives a reload (localStorage).
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox', { name: 'Done' })[0]!);
    expect(steps[0]).not.toHaveAttribute('aria-current');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(JSON.parse(window.localStorage.getItem('foodi.keyguide.openai') ?? '[]')).toEqual([0]);

    await user.type(screen.getByLabelText('API key'), 'sk-test-0123456789abcdef0123456789abcdef');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ vendor: 'openai', apiKey: 'sk-test-0123456789abcdef0123456789abcdef' });
  });

  it('shows the vendor’s reason when a key is turned away (no credit), and stays on the page', async () => {
    stubApi({
      'GET /api/auth/me': me,
      'GET /api/auth/providers': providers,
      'POST /api/auth/key': new Response(JSON.stringify({ error: { code: 'bad_request', message: 'That OpenAI key works, but the account has no credit yet. Add $5 at platform.openai.com → Billing, then connect again.' } }), { status: 400, headers: { 'content-type': 'application/json' } }),
    });
    const router = mount('/connect/openai');
    await screen.findAllByRole('listitem');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('API key'), 'sk-broke-0123456789abcdef0123456789abcdef');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no credit yet/);
    expect(router.state.location.pathname).toBe('/connect/openai');
  });
});
