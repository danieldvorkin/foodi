import { RecipeContentSchema } from '@foodi/shared';
import type { CredentialPayload } from '../auth/providers/types.js';
import { imageMime } from '../lib/media-scrub.js';
import { buildUserMessage, coerceRecipeShape, parseVerdict, RECIPE_TOOL_NAME, recipeJsonSchema, SYSTEM_PROMPT, visionRubric } from './prompt.js';
import { AiError, type AiClient, type GenerateInput, type GenerateOutput, type VisionOutput } from './types.js';

/** Calls the Messages API directly with forced tool use for a schema-shaped result. */
export function createAnthropicClient(opts: { apiBase: string; model: string; fetchImpl?: typeof fetch }): AiClient {
  const f = opts.fetchImpl ?? fetch;
  return {
    vendor: 'anthropic',
    model: opts.model,
    /** Anthropic models can look at photos but not make them. */
    async describeImage(image: Buffer, recipe: { title: string; keyIngredients: string[]; library?: boolean }, credential: CredentialPayload): Promise<VisionOutput> {
      if (credential.kind !== 'api_key') throw new AiError('credential_unusable', 'This account has no Anthropic API key connected.');
      let res: Response;
      try {
        res = await f(`${opts.apiBase}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': credential.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: 200,
            messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: imageMime(image), data: image.toString('base64') } }, { type: 'text', text: visionRubric(recipe) }] }],
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        throw new AiError('network', `Could not reach Anthropic: ${(e as Error).message}`);
      }
      if (res.status === 401 || res.status === 403) throw new AiError('credential_rejected', 'Anthropic rejected the connected key.', res.status);
      if (res.status === 429) throw new AiError('rate_limited', 'Anthropic is rate limiting this key. Try again shortly.', 429);
      if (!res.ok) throw new AiError('vendor_error', `Anthropic returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`, res.status);
      const data = (await res.json()) as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const verdict = parseVerdict(data.content.find((c) => c.type === 'text')?.text ?? '');
      if (!verdict) throw new AiError('bad_output', 'The vision model did not return a verdict.');
      return { verdict, model: opts.model, usage: { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null } };
    },
    async generate(input: GenerateInput, credential: CredentialPayload): Promise<GenerateOutput> {
      if (credential.kind !== 'api_key') {
        throw new AiError('credential_unusable', 'This account has no Anthropic API key connected.');
      }
      let res: Response;
      try {
        res = await f(`${opts.apiBase}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': credential.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: 6000,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildUserMessage(input) }],
            tools: [{ name: RECIPE_TOOL_NAME, description: 'Save the finished recipe.', input_schema: recipeJsonSchema() }],
            tool_choice: { type: 'tool', name: RECIPE_TOOL_NAME },
          }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (e) {
        throw new AiError('network', `Could not reach Anthropic: ${(e as Error).message}`);
      }
      if (res.status === 401 || res.status === 403) throw new AiError('credential_rejected', 'Anthropic rejected the connected key.', res.status);
      if (res.status === 429) throw new AiError('rate_limited', 'Anthropic is rate limiting this key. Try again shortly.', 429);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AiError('vendor_error', `Anthropic returned ${res.status}: ${text.slice(0, 300)}`, res.status);
      }
      const data = (await res.json()) as {
        content: { type: string; name?: string; input?: unknown }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const tool = data.content.find((c) => c.type === 'tool_use' && c.name === RECIPE_TOOL_NAME);
      if (!tool) throw new AiError('bad_output', 'The model did not return a recipe.');
      const parsed = RecipeContentSchema.safeParse(coerceRecipeShape(tool.input));
      if (!parsed.success) throw new AiError('bad_output', `The recipe came back malformed: ${parsed.error.issues[0]?.path.join('.')} — ${parsed.error.issues[0]?.message}`);
      return {
        content: parsed.data,
        model: opts.model,
        usage: { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null },
      };
    },
  };
}
