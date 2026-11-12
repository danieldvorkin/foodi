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
  const reply = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('reads JSON wrapped in prose and keeps only the listed ids', async () => {
    const text = 'Here you go:\n{"found":[{"itemId":"shp_2","confidence":0.7,"box":{"x":0.2,"y":0.2,"w":0.3,"h":0.3}},{"itemId":"shp_9","confidence":1,"box":null}],"seen":["butter"]}';
    const client = createAnthropicClient({ apiBase: 'http://vendor.test', model: 'claude-test', fetchImpl: reply(200, { content: [{ type: 'text', text }], usage: { input_tokens: 1200, output_tokens: 60 } }) });
    expect(await client.scanIngredients!(photo, items, credential)).toEqual({
      found: [{ itemId: 'shp_2', text: 'oat milk', confidence: 0.7, box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } }],
      seen: ['butter'],
      model: 'claude-test',
      usage: { inputTokens: 1200, outputTokens: 60 },
    });
  });

  it('reports a rejected key and an unreadable answer', async () => {
    const rejected = createAnthropicClient({ apiBase: 'http://vendor.test', model: 'claude-test', fetchImpl: reply(401, {}) });
    await expect(rejected.scanIngredients!(photo, items, credential)).rejects.toMatchObject({ code: 'credential_rejected' });
    const rambling = createAnthropicClient({ apiBase: 'http://vendor.test', model: 'claude-test', fetchImpl: reply(200, { content: [{ type: 'text', text: 'I see a fridge.' }] }) });
    await expect(rambling.scanIngredients!(photo, items, credential)).rejects.toMatchObject({ code: 'bad_output' });
  });
});
