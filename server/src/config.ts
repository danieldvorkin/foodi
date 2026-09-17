import { z } from 'zod';

const bool = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v === 'true' || v === '1'),
  z.boolean(),
);
const boolDefault = (d: boolean) => z.preprocess((v) => (v === undefined || v === '' ? d : v === 'true' || v === '1'), z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Public origin of the app as the browser sees it (Vite in dev, this server in prod). */
  FOODI_APP_ORIGIN: z.string().url().default('http://localhost:5100'),
  /** Origin of this API server, used to build OAuth redirect URIs. */
  FOODI_API_ORIGIN: z.string().url().default('http://localhost:4100'),
  FOODI_DB_PATH: z.string().default('./data/foodi.db'),
  FOODI_UPLOAD_DIR: z.string().default('./data/uploads'),
  FOODI_SESSION_SECRET: z.string().min(32),
  /** 32 bytes, hex encoded. Encrypts provider tokens and API keys at rest. */
  FOODI_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  FOODI_COOKIE_SECURE: bool.optional(),
  FOODI_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  FOODI_TRUST_PROXY: boolDefault(false),
  /** First person to sign in becomes admin when no admin exists yet. Development only. */
  FOODI_BOOTSTRAP_FIRST_ADMIN: bool.optional(),
  /** Comma-separated emails auto-promoted to admin on sign-in. */
  FOODI_ADMIN_EMAILS: z.string().default(''),
  FOODI_ENABLE_MOCK_PROVIDER: bool.optional(),
  /** Seed and run the house kitchen (@foodi starter recipes + scheduled posts). On by default. */
  FOODI_HOUSE_KITCHEN: boolDefault(true),
  /** Stripe Checkout for book sales and promotions. Without a key, payments run in test mode. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_API_BASE: z.string().url().default('https://api.stripe.com'),

  // OpenAI — "Sign in with ChatGPT" (OAuth 2.0 + PKCE + OIDC)
  OPENAI_OAUTH_CLIENT_ID: z.string().optional(),
  OPENAI_OAUTH_CLIENT_SECRET: z.string().optional(),
  OPENAI_OAUTH_ISSUER: z.string().url().default('https://auth.openai.com'),
  OPENAI_OAUTH_AUTHORIZATION_URL: z.string().url().optional(),
  OPENAI_OAUTH_TOKEN_URL: z.string().url().optional(),
  OPENAI_OAUTH_JWKS_URL: z.string().url().optional(),
  OPENAI_OAUTH_SCOPES: z.string().default('openid profile email offline_access'),
  /** After sign-in, exchange the id_token for an API key (RFC 8693 token exchange). */
  OPENAI_OAUTH_EXCHANGE_API_KEY: boolDefault(true),
  OPENAI_API_BASE: z.string().url().default('https://api.openai.com'),
  OPENAI_MODEL: z.string().default('gpt-5'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  /** Optional: an organisation admin key (sk-admin-…) so foodi can hand each person their own API key. */
  OPENAI_ADMIN_KEY: z.string().optional(),
  /** Optional: the project those keys live in; created and remembered when blank. */
  OPENAI_PROJECT_ID: z.string().optional(),
  /** Optional photo libraries for recipe covers (Wikimedia Commons is always on). */
  PEXELS_API_KEY: z.string().optional(),
  GOOGLE_CSE_KEY: z.string().optional(),
  GOOGLE_CSE_CX: z.string().optional(),

  // Anthropic — API key only (third-party Claude.ai sign-in is not permitted by Anthropic)
  ANTHROPIC_API_BASE: z.string().url().default('https://api.anthropic.com'),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

  /** Optional: a generic OIDC provider for a future sanctioned Claude sign-in, or any other. */
  GENERIC_OAUTH_VENDOR: z.enum(['anthropic', 'openai']).optional(),
  GENERIC_OAUTH_LABEL: z.string().optional(),
  GENERIC_OAUTH_CLIENT_ID: z.string().optional(),
  GENERIC_OAUTH_CLIENT_SECRET: z.string().optional(),
  GENERIC_OAUTH_ISSUER: z.string().url().optional(),
  GENERIC_OAUTH_SCOPES: z.string().default('openid profile email'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}\n\nCopy .env.example to .env and fill in the blanks.`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  return {
    env: e.NODE_ENV,
    isProd,
    port: e.PORT,
    appOrigin: e.FOODI_APP_ORIGIN.replace(/\/$/, ''),
    apiOrigin: e.FOODI_API_ORIGIN.replace(/\/$/, ''),
    dbPath: e.FOODI_DB_PATH,
    uploadDir: e.FOODI_UPLOAD_DIR,
    sessionSecret: e.FOODI_SESSION_SECRET,
    encryptionKey: Buffer.from(e.FOODI_ENCRYPTION_KEY, 'hex'),
    cookieSecure: e.FOODI_COOKIE_SECURE ?? isProd,
    logLevel: e.FOODI_LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    trustProxy: e.FOODI_TRUST_PROXY,
    // Never in production, whatever the env says: the first registrant must not become admin.
    bootstrapFirstAdmin: !isProd && (e.FOODI_BOOTSTRAP_FIRST_ADMIN ?? true),
    adminEmails: e.FOODI_ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // The mock provider must never be reachable in production, and is opt-in everywhere else
    // (npm run setup turns it on in .env) so a missing NODE_ENV can't switch it on by accident.
    enableMockProvider: !isProd && (e.FOODI_ENABLE_MOCK_PROVIDER ?? false),
    houseKitchen: e.FOODI_HOUSE_KITCHEN,
    stripe: e.STRIPE_SECRET_KEY ? { secretKey: e.STRIPE_SECRET_KEY, webhookSecret: e.STRIPE_WEBHOOK_SECRET ?? null, apiBase: e.STRIPE_API_BASE.replace(/\/$/, '') } : null,
    openai: {
      clientId: e.OPENAI_OAUTH_CLIENT_ID,
      clientSecret: e.OPENAI_OAUTH_CLIENT_SECRET,
      issuer: e.OPENAI_OAUTH_ISSUER,
      authorizationUrl: e.OPENAI_OAUTH_AUTHORIZATION_URL,
      tokenUrl: e.OPENAI_OAUTH_TOKEN_URL,
      jwksUrl: e.OPENAI_OAUTH_JWKS_URL,
      scopes: e.OPENAI_OAUTH_SCOPES,
      exchangeApiKey: e.OPENAI_OAUTH_EXCHANGE_API_KEY,
      apiBase: e.OPENAI_API_BASE.replace(/\/$/, ''),
      model: e.OPENAI_MODEL,
      imageModel: e.OPENAI_IMAGE_MODEL,
      adminKey: e.OPENAI_ADMIN_KEY,
      projectId: e.OPENAI_PROJECT_ID,
    },
    anthropic: {
      apiBase: e.ANTHROPIC_API_BASE.replace(/\/$/, ''),
      model: e.ANTHROPIC_MODEL,
    },
    photos: { pexelsApiKey: e.PEXELS_API_KEY, googleCseKey: e.GOOGLE_CSE_KEY, googleCseCx: e.GOOGLE_CSE_CX },
    genericOAuth:
      e.GENERIC_OAUTH_CLIENT_ID && e.GENERIC_OAUTH_ISSUER && e.GENERIC_OAUTH_VENDOR
        ? {
            vendor: e.GENERIC_OAUTH_VENDOR,
            label: e.GENERIC_OAUTH_LABEL ?? 'Continue with SSO',
            clientId: e.GENERIC_OAUTH_CLIENT_ID,
            clientSecret: e.GENERIC_OAUTH_CLIENT_SECRET,
            issuer: e.GENERIC_OAUTH_ISSUER,
            scopes: e.GENERIC_OAUTH_SCOPES,
          }
        : null,
  };
}
