import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createApiKeyProviders, NO_CREDITS } from './api-key.js';

const config = loadConfig({ ...process.env, FOODI_APP_ORIGIN: 'http://localhost:5100', FOODI_API_ORIGIN: 'http://localhost:4100' });

/** Answer the models list, then the probe, from a script. */
function vendor(script: { models: number; probe: { status: number; body: string } }) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/models')) return new Response('{"data":[]}', { status: script.models });
    return new Response(script.probe.body, { status: script.probe.status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

describe('api-key providers', () => {
  it('OpenAI: a good key passes both the list and a one-token probe', async () => {
    const v = vendor({ models: 200, probe: { status: 200, body: '{"output":[]}' } });
    const [, openai] = createApiKeyProviders(config, v.fetchImpl);
    const r = await openai!.verify('sk-good-0123456789abcdef0123456789');
    expect(r.ok).toBe(true);
    expect(v.calls[1]).toMatch(/^POST .*\/v1\/responses$/);
  });

  it('OpenAI: a key on an account with no credit is turned away with billing instructions', async () => {
    const v = vendor({ models: 200, probe: { status: 429, body: '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}' } });
    const [, openai] = createApiKeyProviders(config, v.fetchImpl);
    expect(await openai!.verify('sk-broke-0123456789abcdef0123456789')).toEqual({ ok: false, reason: NO_CREDITS.openai });
  });

  it('OpenAI: a bad key, a rate limit, and a missing model each get their own reason', async () => {
    const [, bad] = createApiKeyProviders(config, vendor({ models: 401, probe: { status: 200, body: '{}' } }).fetchImpl);
    expect((await bad!.verify('sk-nope-0123456789abcdef0123456789')).ok).toBe(false);
    expect((await bad!.verify('pk-wrong-prefix-0123456789abcdef')).ok).toBe(false);
    const [, limited] = createApiKeyProviders(config, vendor({ models: 200, probe: { status: 429, body: '{"error":{"code":"rate_limit_exceeded"}}' } }).fetchImpl);
    expect((await limited!.verify('sk-busy-0123456789abcdef0123456789')).ok).toBe(true); // a busy account is still a working one
    const [, noModel] = createApiKeyProviders(config, vendor({ models: 200, probe: { status: 404, body: '{"error":{"code":"model_not_found"}}' } }).fetchImpl);
    const r = await noModel!.verify('sk-old-0123456789abcdef0123456789');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(config.openai.model);
  });

  it('Anthropic: an empty balance is caught by the probe', async () => {
    const [anthropic] = createApiKeyProviders(config, vendor({ models: 200, probe: { status: 400, body: '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}' } }).fetchImpl);
    expect(await anthropic!.verify('sk-ant-broke-0123456789abcdef')).toEqual({ ok: false, reason: NO_CREDITS.anthropic });
    const [good] = createApiKeyProviders(config, vendor({ models: 200, probe: { status: 200, body: '{"content":[]}' } }).fetchImpl);
    expect((await good!.verify('sk-ant-good-0123456789abcdef')).ok).toBe(true);
  });
});
