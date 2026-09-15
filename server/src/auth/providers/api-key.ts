import type { Config } from '../../config.js';
import { hmac } from '../../lib/crypto.js';
import type { ApiKeyProvider } from './types.js';

/**
 * "Continue with Claude" / "Connect an OpenAI key". The person pastes a key from the vendor
 * console; we verify it with the cheapest authenticated call the vendor offers and derive a
 * stable identity from an HMAC of the key (so the key itself is never used as an identifier).
 */
export function createApiKeyProviders(config: Config): ApiKeyProvider[] {
  const subjectFor = (vendor: string, key: string) => hmac(config.sessionSecret, `${vendor}:${key}`).slice(0, 40);

  const anthropic: ApiKeyProvider = {
    id: 'anthropic',
    vendor: 'anthropic',
    label: 'Connect Claude (API key)',
    kind: 'api_key',
    note: 'Anthropic doesn’t allow apps to sign you in with a Claude account, so paste an API key from console.anthropic.com. It’s encrypted on this server and only used to write your recipes.',
    async verify(apiKey) {
      if (!apiKey.startsWith('sk-ant-')) return { ok: false, reason: 'Anthropic keys start with sk-ant-.' };
      const res = await fetch(`${config.anthropic.apiBase}/v1/models?limit=1`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'Anthropic rejected that key. Check it and try again.' };
      if (!res.ok) return { ok: false, reason: `Anthropic responded with ${res.status}. Try again in a moment.` };
      return { ok: true, identity: { provider: 'anthropic', subject: subjectFor('anthropic', apiKey), email: null, displayName: null } };
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
      const res = await fetch(`${config.openai.apiBase}/v1/models?limit=1`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'OpenAI rejected that key. Check it and try again.' };
      if (!res.ok) return { ok: false, reason: `OpenAI responded with ${res.status}. Try again in a moment.` };
      return { ok: true, identity: { provider: 'openai-key', subject: subjectFor('openai', apiKey), email: null, displayName: null } };
    },
  };

  return [anthropic, openai];
}
