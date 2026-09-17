import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

  it('walks through bringing your own key: open the vendor page, paste, connect', async () => {
    const calls = stubApi({
      'GET /api/auth/me': me,
      'GET /api/auth/providers': providers,
      'POST /api/auth/key': { ...me, vendor: 'openai', credentialKind: 'api_key', credentialHint: 'cdef', managedAvailable: false },
    });
    const router = mount('/connect/openai');
    expect(await screen.findByRole('link', { name: /Open OpenAI’s key page/ })).toHaveAttribute('href', 'https://platform.openai.com/api-keys');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Paste the key here'), 'sk-test-0123456789abcdef0123456789abcdef');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ vendor: 'openai', apiKey: 'sk-test-0123456789abcdef0123456789abcdef' });
  });
});
