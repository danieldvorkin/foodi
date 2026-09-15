import { RecipeContentSchema } from '@foodi/shared';
import type { CredentialPayload } from '../auth/providers/types.js';
import { buildUserMessage, recipeJsonSchema, SYSTEM_PROMPT } from './prompt.js';
import { AiError, type AiClient, type GenerateInput, type GenerateOutput } from './types.js';

/** Calls the Responses API with a strict JSON schema output. Works with an API key (from the
 *  key form or from the post-sign-in token exchange); a bare OAuth access token is tried as a
 *  bearer and reported clearly if the vendor won't accept it. */
export function createOpenAiClient(opts: { apiBase: string; model: string; fetchImpl?: typeof fetch }): AiClient {
  const f = opts.fetchImpl ?? fetch;
  return {
    vendor: 'openai',
    model: opts.model,
    async generate(input: GenerateInput, credential: CredentialPayload): Promise<GenerateOutput> {
      const bearer = credential.kind === 'api_key' ? credential.apiKey : credential.accessToken;
      let res: Response;
      try {
        res = await f(`${opts.apiBase}/v1/responses`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
          body: JSON.stringify({
            model: opts.model,
            instructions: SYSTEM_PROMPT,
            input: buildUserMessage(input),
            text: { format: { type: 'json_schema', name: 'recipe', strict: true, schema: recipeJsonSchema() } },
            max_output_tokens: 6000,
          }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (e) {
        throw new AiError('network', `Could not reach OpenAI: ${(e as Error).message}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new AiError(
          credential.kind === 'oauth' ? 'credential_unusable' : 'credential_rejected',
          credential.kind === 'oauth'
            ? 'Your ChatGPT sign-in can’t be used for the API on this account. Connect an OpenAI API key in Settings.'
            : 'OpenAI rejected the connected key.',
          res.status,
        );
      }
      if (res.status === 429) throw new AiError('rate_limited', 'OpenAI is rate limiting this account. Try again shortly.', 429);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AiError('vendor_error', `OpenAI returned ${res.status}: ${text.slice(0, 300)}`, res.status);
      }
      const data = (await res.json()) as {
        output?: { type: string; content?: { type: string; text?: string }[] }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = data.output
        ?.filter((o) => o.type === 'message')
        .flatMap((o) => o.content ?? [])
        .find((c) => c.type === 'output_text')?.text;
      if (!text) throw new AiError('bad_output', 'The model did not return a recipe.');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiError('bad_output', 'The recipe came back as invalid JSON.');
      }
      const parsed = RecipeContentSchema.safeParse(json);
      if (!parsed.success) throw new AiError('bad_output', `The recipe came back malformed: ${parsed.error.issues[0]?.path.join('.')}`);
      return {
        content: parsed.data,
        model: opts.model,
        usage: { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null },
      };
    },
  };
}
