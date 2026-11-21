import { describe, expect, it } from 'vitest';
import { createOpenAiClient } from './openai.js';
import type { GenerateInput } from './types.js';

describe('openai generate', () => {
  const credential = { kind: 'api_key' as const, apiKey: 'sk-test' };
  const input = { profile: { allergies: [], dislikes: [], cuisines: [], equipment: [], goals: [] }, prompt: 'something good', requestedIngredients: [], servings: 2, timeBudgetMinutes: 30, mealType: null, basedOn: null, avoidTitles: [], seed: null } as unknown as GenerateInput;
  const sent: { reasoning?: { effort: string }; max_output_tokens?: number }[] = [];
  const reply =
    (body: unknown): typeof fetch =>
    async (_url, init) => {
      sent.push(JSON.parse(init!.body as string) as (typeof sent)[number]);
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  // What a reasoning model returns when it spends the whole budget thinking: no message, no text.
  const truncated = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning' }], usage: { input_tokens: 900, output_tokens: 6000 } };

  it('leaves a reasoning model room to think, and says so when it still runs out', async () => {
    const client = createOpenAiClient({ apiBase: 'http://vendor.test', model: 'gpt-5', fetchImpl: reply(truncated) });
    await expect(client.generate(input, credential)).rejects.toMatchObject({ code: 'bad_output', message: /max_output_tokens/, usage: { inputTokens: 900, outputTokens: 6000 } });
    expect(sent.at(-1)).toMatchObject({ reasoning: { effort: 'low' }, max_output_tokens: 16000 });
  });

  it('omits the reasoning setting for a model that would reject it', async () => {
    const client = createOpenAiClient({ apiBase: 'http://vendor.test', model: 'gpt-4o', fetchImpl: reply(truncated) });
    await expect(client.generate(input, credential)).rejects.toMatchObject({ code: 'bad_output' });
    expect(sent.at(-1)!.reasoning).toBeUndefined();
  });
});
