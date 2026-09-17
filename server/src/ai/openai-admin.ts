import { AiError } from './types.js';

/**
 * The slice of OpenAI's Administration API foodi needs to hand people their own keys:
 * a project to keep them in, one service account per person (its key comes back once, at
 * creation), and deletion when they leave or bring their own key. Needs an organisation
 * admin key (sk-admin-…); everything is billed to that organisation.
 */
export interface OpenAiAdmin {
  createProject(name: string): Promise<{ id: string; name: string }>;
  getProject(id: string): Promise<{ id: string; name: string; status: string } | null>;
  createServiceAccount(projectId: string, name: string): Promise<{ id: string; apiKey: string; keyId: string | null }>;
  deleteServiceAccount(projectId: string, serviceAccountId: string): Promise<void>;
}

interface ServiceAccountResponse {
  id: string;
  name: string;
  api_key?: { id?: string; value?: string };
}

export function createOpenAiAdmin(opts: { adminKey: string; apiBase: string; fetchImpl?: typeof fetch }): OpenAiAdmin {
  const f = opts.fetchImpl ?? fetch;

  async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; json: T | null }> {
    let res: Response;
    try {
      res = await f(`${opts.apiBase}${path}`, {
        method,
        headers: { authorization: `Bearer ${opts.adminKey}`, 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new AiError('network', `Could not reach OpenAI: ${(e as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new AiError('credential_rejected', 'OpenAI rejected the admin key. It needs api.management.write on the organisation.', res.status);
    if (res.status === 429) throw new AiError('rate_limited', 'OpenAI is rate-limiting admin requests. Try again shortly.', res.status);
    let json: T | null = null;
    try {
      json = (await res.json()) as T;
    } catch {
      json = null;
    }
    if (!res.ok && res.status !== 404) {
      const msg = (json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
      throw new AiError('vendor_error', `OpenAI admin request failed: ${msg}`, res.status);
    }
    return { status: res.status, json };
  }

  return {
    async createProject(name) {
      const { json } = await call<{ id: string; name: string }>('POST', '/v1/organization/projects', { name });
      if (!json?.id) throw new AiError('bad_output', 'OpenAI returned no project id.');
      return { id: json.id, name: json.name };
    },
    async getProject(id) {
      const { status, json } = await call<{ id: string; name: string; status: string }>('GET', `/v1/organization/projects/${encodeURIComponent(id)}`);
      return status === 404 || !json?.id ? null : { id: json.id, name: json.name, status: json.status };
    },
    async createServiceAccount(projectId, name) {
      const { json } = await call<ServiceAccountResponse>('POST', `/v1/organization/projects/${encodeURIComponent(projectId)}/service_accounts`, { name });
      if (!json?.id || !json.api_key?.value) throw new AiError('bad_output', 'OpenAI returned a service account without a key.');
      return { id: json.id, apiKey: json.api_key.value, keyId: json.api_key.id ?? null };
    },
    async deleteServiceAccount(projectId, serviceAccountId) {
      await call('DELETE', `/v1/organization/projects/${encodeURIComponent(projectId)}/service_accounts/${encodeURIComponent(serviceAccountId)}`);
    },
  };
}
