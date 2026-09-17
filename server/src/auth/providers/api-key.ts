import type { Config } from '../../config.js';
import { hmac } from '../../lib/crypto.js';
import type { ApiKeyProvider } from './types.js';

/**
 * "Continue with Claude" / "Connect an OpenAI key". The person pastes a key from the vendor
 * console; we verify it with the cheapest authenticated call the vendor offers and derive a
 * stable identity from an HMAC of the key (so the key itself is never used as an identifier).
 */
/** Billing page and the reason a person sees when their account has no credit. */
export const NO_CREDITS = {
  openai: 'That OpenAI key works, but the account has no credit yet. Add $5 at platform.openai.com → Billing, then connect again.',
  anthropic: 'That Anthropic key works, but the account has no credit yet. Add $5 at console.anthropic.com → Billing, then connect again.',
} as const;

export function createApiKeyProviders(config: Config, fetchOverride?: typeof fetch): ApiKeyProvider[] {
  const subjectFor = (vendor: string, key: string) => hmac(config.sessionSecret, `${vendor}:${key}`).slice(0, 40);
  // Resolved per call so a test can stub the global after the providers are built.
  const fetchImpl: typeof fetch = (input, init) => (fetchOverride ?? globalThis.fetch)(input, init);
  const bodyText = (res: Response) => res.text().catch(() => '');

  const anthropic: ApiKeyProvider = {
    id: 'anthropic',
    vendor: 'anthropic',
    label: 'Connect Claude (API key)',
    kind: 'api_key',
    note: 'Anthropic doesn’t allow apps to sign you in with a Claude account, so paste an API key from console.anthropic.com. It’s encrypted on this server and only used to write your recipes.',
    async verify(apiKey) {
      if (!apiKey.startsWith('sk-ant-')) return { ok: false, reason: 'Anthropic keys start with sk-ant-.' };
      const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
      const res = await fetchImpl(`${config.anthropic.apiBase}/v1/models?limit=1`, { headers });
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'Anthropic rejected that key. Check it and try again.' };
      if (!res.ok) return { ok: false, reason: `Anthropic responded with ${res.status}. Try again in a moment.` };
      // The models list works on an empty account; one tiny real request tells us about credit.
      const probe = await fetchImpl(`${config.anthropic.apiBase}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.anthropic.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      if (!probe.ok) {
        const text = await bodyText(probe);
        if (/credit balance|billing|purchase credits/i.test(text)) return { ok: false, reason: NO_CREDITS.anthropic };
        if (probe.status === 404 || /not_found_error|model/i.test(text)) return { ok: false, reason: `That key can’t use the model foodi needs (${config.anthropic.model}). Check the account’s model access.` };
      }
      return { ok: true, identity: { provider: 'anthropic', subject: subjectFor('anthropic', apiKey), email: null, emailVerified: false, displayName: null } };
    },
  };

  const openai: ApiKeyProvider = {
    id: 'openai-key',
    vendor: 'openai',
    label: 'Connect OpenAI (API key)',
    kind: 'api_key',
    note: 'Use a key from platform.openai.com. It stays encrypted on this server.',
    async verify(apiKey) {
      if (!apiKey.startsWith('sk-')) return { ok: false, reason: 'OpenAI keys start with sk-.' };
      const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
      const res = await fetchImpl(`${config.openai.apiBase}/v1/models?limit=1`, { headers });
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'OpenAI rejected that key. Check it and try again.' };
      if (!res.ok) return { ok: false, reason: `OpenAI responded with ${res.status}. Try again in a moment.` };
      // A key on an account with no credit lists models fine and fails on the first real call.
      const probe = await fetchImpl(`${config.openai.apiBase}/v1/responses`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.openai.model, input: 'hi', max_output_tokens: 16 }),
      });
      if (!probe.ok) {
        const text = await bodyText(probe);
        if (probe.status === 429 && /insufficient_quota/i.test(text)) return { ok: false, reason: NO_CREDITS.openai };
        if (probe.status === 404 || /model_not_found|does not exist/i.test(text)) return { ok: false, reason: `That key can’t use the model foodi needs (${config.openai.model}). Check the account’s model access.` };
      }
      return { ok: true, identity: { provider: 'openai-key', subject: subjectFor('openai', apiKey), email: null, emailVerified: false, displayName: null } };
    },
  };

  return [anthropic, openai];
}
