import { describe, expect, it } from 'vitest';
import { createOpenAiAdmin } from './openai-admin.js';

function fake(handler: (method: string, path: string, body: unknown) => { status: number; body: unknown }) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const auth = (init?.headers as Record<string, string>)['authorization'] ?? null;
    const path = url.replace('https://api.openai.com', '');
    calls.push({ method: init?.method ?? 'GET', path, body, auth });
    const r = handler(init?.method ?? 'GET', path, body);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

describe('openai admin client', () => {
  it('creates a project and a service account, returning the one-time key, and deletes it again', async () => {
    const f = fake((method, path) => {
      if (method === 'POST' && path === '/v1/organization/projects') return { status: 200, body: { id: 'proj_1', name: 'foodi people', status: 'active' } };
      if (method === 'GET' && path === '/v1/organization/projects/proj_1') return { status: 200, body: { id: 'proj_1', name: 'foodi people', status: 'active' } };
      if (method === 'POST' && path === '/v1/organization/projects/proj_1/service_accounts') return { status: 200, body: { id: 'svc_1', name: 'foodi @ada', api_key: { id: 'key_1', value: 'sk-svc-abc' } } };
      if (method === 'DELETE' && path === '/v1/organization/projects/proj_1/service_accounts/svc_1') return { status: 200, body: { id: 'svc_1', deleted: true } };
      return { status: 404, body: { error: { message: 'nope' } } };
    });
    const admin = createOpenAiAdmin({ adminKey: 'sk-admin-test', apiBase: 'https://api.openai.com', fetchImpl: f.fetchImpl });
    expect(await admin.createProject('foodi people')).toEqual({ id: 'proj_1', name: 'foodi people' });
    expect(await admin.getProject('proj_1')).toMatchObject({ id: 'proj_1', status: 'active' });
    expect(await admin.getProject('proj_gone')).toBeNull();
    expect(await admin.createServiceAccount('proj_1', 'foodi @ada')).toEqual({ id: 'svc_1', apiKey: 'sk-svc-abc', keyId: 'key_1' });
    await admin.deleteServiceAccount('proj_1', 'svc_1');
    expect(f.calls.every((c) => c.auth === 'Bearer sk-admin-test')).toBe(true);
    expect(f.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/organization/projects/proj_1/service_accounts/svc_1' });
  });

  it('turns auth failures and vendor errors into typed errors', async () => {
    const denied = createOpenAiAdmin({ adminKey: 'bad', apiBase: 'https://api.openai.com', fetchImpl: fake(() => ({ status: 401, body: { error: { message: 'no' } } })).fetchImpl });
    await expect(denied.createProject('x')).rejects.toMatchObject({ code: 'credential_rejected' });
    const broken = createOpenAiAdmin({ adminKey: 'k', apiBase: 'https://api.openai.com', fetchImpl: fake(() => ({ status: 500, body: { error: { message: 'boom' } } })).fetchImpl });
    await expect(broken.createServiceAccount('p', 'n')).rejects.toMatchObject({ code: 'vendor_error', message: expect.stringContaining('boom') });
  });
});
