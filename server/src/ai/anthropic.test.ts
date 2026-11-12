import { describe, expect, it } from 'vitest';
import { encodePng } from '../lib/png.js';
import { createAnthropicClient } from './anthropic.js';

describe('anthropic fridge check', () => {
  const items = [
    { id: 'shp_1', text: 'lemons' },
    { id: 'shp_2', text: 'oat milk' },
  ];
  const photo = encodePng(4, 4, () => [200, 200, 200]);
  const credential = { kind: 'api_key' as const, apiKey: 'sk-ant-test' };
  const sent: { tool_choice?: { name: string }; tools?: { name: string }[] }[] = [];
  const reply =
    (status: number, body: unknown): typeof fetch =>
    async (_url, init) => {
      sent.push(JSON.parse(init!.body as string) as (typeof sent)[number]);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };

  it('forces the scan tool and keeps only the listed ids', async () => {
    const input = { found: [{ itemId: 'shp_2', confidence: 0.7, box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } }, { itemId: 'shp_9', confidence: 1, box: null }], seen: ['butter'] };
    const client = createAnthropicClient({ apiBase: 'http://vendor.test', model: 'claude-test', fetchImpl: reply(200, { content: [{ type: 'tool_use', name: 'report_scan', input }], usage: { input_tokens: 1200, output_tokens: 60 } }) });
    expect(await client.scanIngredients!(photo, items, credential)).toEqual({
      found: [{ itemId: 'shp_2', text: 'oat milk', confidence: 0.7, box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } }],
      seen: ['butter'],
      model: 'claude-test',
      usage: { inputTokens: 1200, outputTokens: 60 },
    });
    expect(sent.at(-1)).toMatchObject({ tool_choice: { name: 'report_scan' }, tools: [{ name: 'report_scan' }] });
  });

  it('reports a rejected key, and an answer without the tool with its billed tokens', async () => {
    const rejected = createAnthropicClient({ apiBase: 'http://vendor.test', model: 'claude-test', fetchImpl: reply(401, {}) });
    await expect(rejected.scanIngredients!(photo, items, credential)).rejects.toMatchObject({ code: 'credential_rejected' });
    const rambling = createAnthropicClient({ apiBase: 'http://vendor.test', model: 'claude-test', fetchImpl: reply(200, { content: [{ type: 'text', text: 'I see a fridge.' }], stop_reason: 'max_tokens', usage: { input_tokens: 1200, output_tokens: 6000 } }) });
    await expect(rambling.scanIngredients!(photo, items, credential)).rejects.toMatchObject({ code: 'bad_output', usage: { inputTokens: 1200, outputTokens: 6000 } });
  });
});
