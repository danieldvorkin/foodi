import { getIngredient, matchIngredient, type Profile, type RecipeContent } from '@foodi/shared';
import type { AuthStore } from '../auth/store.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { one, run } from '../db/index.js';
import { HttpError } from '../lib/errors.js';
import { newId } from '../lib/crypto.js';
import type { Logger } from '../lib/logger.js';
import { now } from '../lib/time.js';
import type { Settings } from '../services/settings.js';
import { createAnthropicClient } from './anthropic.js';
import { createMockClient } from './mock.js';
import { createOpenAiClient } from './openai.js';
import { AiError, type AiClient, type GenerateInput } from './types.js';

export function createAiService(deps: { config: Config; db: Db; log: Logger; store: AuthStore; settings: Settings; clients?: Partial<Record<string, AiClient>> }) {
  const { config, db, log, store, settings } = deps;
  const clients: Record<string, AiClient> = {
    anthropic: deps.clients?.['anthropic'] ?? createAnthropicClient({ apiBase: config.anthropic.apiBase, model: config.anthropic.model }),
    openai: deps.clients?.['openai'] ?? createOpenAiClient({ apiBase: config.openai.apiBase, model: config.openai.model, imageModel: config.openai.imageModel }),
    ...(config.enableMockProvider ? { mock: deps.clients?.['mock'] ?? createMockClient() } : {}),
  };

  function assertQuota(userId: string, pending = 0) {
    const s = settings.get();
    // People on a key foodi provided have their own, usually smaller, allowance.
    const managed = store.getCredentialMeta(userId)?.kind === 'managed';
    const caps = [s.maxGenerationsPerUserPerDay, ...(managed ? [s.managedGenerationsPerUserPerDay] : [])].filter((n) => n > 0);
    if (!caps.length) return;
    const max = Math.min(...caps);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const row = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND created_at > ? AND status = 'ok' AND kind = 'recipe'`, userId, since);
    if ((row?.n ?? 0) + pending >= max) throw new HttpError(429, 'quota', managed ? `You've used today's ${max} recipes on foodi's AI. Connect your own OpenAI or Claude key in Settings for more, or try again tomorrow.` : `You've reached today's limit of ${max} recipes. Try again tomorrow.`);
  }

  /** Everything that must be true before a generation is even queued. */
  function preflight(userId: string, pending = 0) {
    assertQuota(userId, pending);
    const cred = store.getCredentialMeta(userId);
    if (!cred) throw new HttpError(409, 'no_credential', 'No AI account is connected. Connect one in Settings.');
    if (!clients[cred.vendor]) throw new HttpError(409, 'vendor_unavailable', `The ${cred.vendor} provider is not enabled on this server.`);
  }

  async function generate(userId: string, input: GenerateInput): Promise<{ content: RecipeContent; vendor: string; model: string; generationId: string }> {
    assertQuota(userId);
    const cred = store.getCredential(userId);
    if (!cred) throw new HttpError(409, 'no_credential', 'No AI account is connected. Connect one in Settings.');
    const client = clients[cred.vendor];
    if (!client) throw new HttpError(409, 'vendor_unavailable', `The ${cred.vendor} provider is not enabled on this server.`);

    const started = Date.now();
    const generationId = newId('gen');
    const record = (status: 'ok' | 'failed', extra: { inputTokens?: number | null; outputTokens?: number | null; errorCode?: string | null; model?: string }) =>
      run(
        db,
        `INSERT INTO generations (id, user_id, vendor, model, status, latency_ms, input_tokens, output_tokens, error_code, recipe_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        generationId,
        userId,
        client.vendor,
        extra.model ?? client.model,
        status,
        Date.now() - started,
        extra.inputTokens ?? null,
        extra.outputTokens ?? null,
        extra.errorCode ?? null,
        now(),
      );

    try {
      const out = await client.generate(input, cred.payload);
      const content = postProcess(out.content, input.profile);
      record('ok', { inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, model: out.model });
      return { content, vendor: client.vendor, model: out.model, generationId };
    } catch (err) {
      const code = err instanceof AiError ? err.code : 'unknown';
      record('failed', { errorCode: code });
      log.warn({ userId, vendor: client.vendor, code, err: (err as Error).message }, 'generation failed');
      if (err instanceof AiError) {
        const status = err.code === 'rate_limited' ? 429 : err.code === 'credential_rejected' || err.code === 'credential_unusable' ? 409 : 502;
        throw new HttpError(status, `ai_${err.code}`, err.message);
      }
      throw err;
    }
  }

  function linkRecipeId(generationId: string, recipeId: string) {
    run(db, 'UPDATE generations SET recipe_id = ? WHERE id = ?', recipeId, generationId);
  }

  /** What the connected vendor can do beyond writing recipes. */
  function capabilities(userId: string): { images: boolean; vision: boolean } {
    const cred = store.getCredentialMeta(userId);
    const client = cred ? clients[cred.vendor] : undefined;
    // Photos on foodi's dime are an admin decision (gpt-image-1 costs a few cents each).
    const images = Boolean(client?.generateImage) && (cred?.kind !== 'managed' || settings.get().managedImages);
    return { images, vision: Boolean(client?.describeImage) };
  }

  /** Log an image or vision call the same way recipe calls are logged, so admin sees cost and failure rate. */
  function recordAux(userId: string, kind: 'image' | 'vision', vendor: string, model: string, status: 'ok' | 'failed', latencyMs: number, extra: { inputTokens?: number | null; outputTokens?: number | null; errorCode?: string | null; recipeId?: string | null } = {}) {
    run(
      db,
      `INSERT INTO generations (id, user_id, vendor, model, status, latency_ms, input_tokens, output_tokens, error_code, recipe_id, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('gen'),
      userId,
      vendor,
      model,
      status,
      latencyMs,
      extra.inputTokens ?? null,
      extra.outputTokens ?? null,
      extra.errorCode ?? null,
      extra.recipeId ?? null,
      now(),
      kind,
    );
  }

  return { generate, linkRecipeId, preflight, capabilities, recordAux, clients, store };
}

/** Link ingredient lines to the preset library and tidy up model output. */
export function postProcess(content: RecipeContent, profile: Profile): RecipeContent {
  const ingredients = content.ingredients.map((line) => {
    const preset = (line.ingredientId && getIngredient(line.ingredientId)) || matchIngredient(line.item);
    return { ...line, ingredientId: preset?.id ?? null };
  });
  const derivedAllergens = new Set(content.allergens.map((a) => a.toLowerCase()));
  for (const line of ingredients) {
    const preset = line.ingredientId ? getIngredient(line.ingredientId) : undefined;
    for (const a of preset?.allergens ?? []) derivedAllergens.add(a.toLowerCase());
  }
  const steps = content.steps.map((s) => ({
    ...s,
    ingredientRefs: [...new Set(s.ingredientRefs.filter((i) => i >= 0 && i < ingredients.length))],
  }));
  void profile;
  return { ...content, ingredients, steps, allergens: [...derivedAllergens] };
}

/** Which of the recipe's allergens the person said they can't have. */
export function allergenWarnings(content: RecipeContent, profile: Profile | null): string[] {
  if (!profile) return [];
  const mine = profile.allergies.map((a) => a.toLowerCase());
  const norm = (s: string) => s.toLowerCase().replace(/s$/, '');
  return content.allergens.filter((a) => mine.some((m) => norm(m) === norm(a) || (m === 'nuts' && /nut/.test(a)) || a.toLowerCase().includes(m)));
}
