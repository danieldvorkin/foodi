import express, { type Request } from 'express';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAiService } from './ai/service.js';
import type { AiClient } from './ai/types.js';
import { createApiKeyProviders } from './auth/providers/api-key.js';
import { createMockProvider, MOCK_CLIENT_ID } from './auth/providers/mock.js';
import { createOidcProvider } from './auth/providers/oidc.js';
import { createOpenAiProvider } from './auth/providers/openai.js';
import type { AuthProvider } from './auth/providers/types.js';
import { authRoutes } from './auth/routes.js';
import { createAuthStore } from './auth/store.js';
import type { Config } from './config.js';
import { openDb } from './db/index.js';
import { randomToken } from './lib/crypto.js';
import type { Logger } from './lib/logger.js';
import { attachUser } from './middleware/auth.js';
import { csrfOriginCheck } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createMockAuthorizationServer, MOCK_ADMIN_EMAILS } from './mock/authorization-server.js';
import { adminRoutes } from './routes/admin.js';
import { ingredientRoutes } from './routes/ingredients.js';
import { createMediaStore, mediaRoutes } from './routes/media.js';
import { profileRoutes } from './routes/profile.js';
import { recipeRoutes } from './routes/recipes.js';
import { socialRoutes } from './routes/social.js';
import { createAudit } from './services/audit.js';
import { createSettings } from './services/settings.js';
import { createNotifier } from './services/notify.js';
import { createHouse } from './services/house.js';
import { createCommerce } from './services/commerce.js';
import { createPermissions } from './services/permissions.js';
import { createJobs } from './services/jobs.js';
import { generateJobHandler } from './ai/generate-job.js';
import { imageJobHandler } from './ai/image-job.js';
import { createPhotoFinder } from './photos/finder.js';
import { createGoogleSource } from './photos/google.js';
import { createPexelsSource } from './photos/pexels.js';
import { createPhotoService } from './photos/service.js';
import type { PhotoSource } from './photos/types.js';
import { createWikimediaSource } from './photos/wikimedia.js';
import { adminShopRoutes, shopRoutes } from './routes/shop.js';
import { createStripeProvider } from './payments/stripe.js';
import { createTestProvider } from './payments/test.js';
import { adminCommerceRoutes, commerceRoutes, stripeWebhook } from './routes/commerce.js';
import { notificationRoutes } from './routes/notifications.js';
import { blogRoutes } from './routes/blog.js';
import { bookRoutes } from './routes/books.js';

export interface AppDeps {
  config: Config;
  log: Logger;
  /** Test seams. */
  aiClients?: Partial<Record<string, AiClient>>;
  photoSources?: PhotoSource[];
  photoFetch?: typeof fetch;
}

export async function createApp({ config, log, aiClients, photoSources, photoFetch }: AppDeps) {
  const db = openDb(config.dbPath);
  const store = createAuthStore(db, {
    encryptionKey: config.encryptionKey,
    bootstrapFirstAdmin: config.bootstrapFirstAdmin,
    // The mock admin persona is only an admin while the (dev-only) mock provider is on.
    adminEmails: config.enableMockProvider ? [...config.adminEmails, ...MOCK_ADMIN_EMAILS] : config.adminEmails,
  });
  const settings = createSettings(db);
  const audit = createAudit(db);
  const permissions = createPermissions(db);
  const notifier = createNotifier(db);
  const house = createHouse(db, settings, notifier, log);
  if (config.houseKitchen) house.ensure();
  const paymentProvider = config.stripe ? createStripeProvider(config.stripe) : createTestProvider(config.appOrigin);
  if (!config.stripe) log.warn('no STRIPE_SECRET_KEY: payments run in test mode (fake checkout, nothing is charged)');
  const commerce = createCommerce({ db, settings, notifier, provider: paymentProvider, appOrigin: config.appOrigin, log });
  const ai = createAiService({ config, db, log, store, settings, ...(aiClients ? { clients: aiClients } : {}) });
  const mediaStore = createMediaStore(db, config.uploadDir, log);
  // Library photos, best first: Pexels and Google when keys are set, Wikimedia Commons always.
  const sources = photoSources ?? [
    ...(config.photos.pexelsApiKey ? [createPexelsSource(config.photos.pexelsApiKey)] : []),
    ...(config.photos.googleCseKey && config.photos.googleCseCx ? [createGoogleSource(config.photos.googleCseKey, config.photos.googleCseCx)] : []),
    createWikimediaSource(),
  ];
  const photos = createPhotoService({ db, mediaStore, settings, finder: createPhotoFinder({ sources, log, ...(photoFetch ? { fetchImpl: photoFetch } : {}) }), log });
  const jobs = createJobs(db, notifier, log);
  jobs.register('generate', generateJobHandler(db, ai, notifier, jobs));
  jobs.register('image', imageJobHandler(db, ai, photos, log));
  jobs.start();

  // ---- providers --------------------------------------------------------------------------
  const providers: AuthProvider[] = [];
  const openai = createOpenAiProvider(config, log);
  if (openai) providers.push(openai);
  if (config.genericOAuth) {
    providers.push(
      createOidcProvider({
        id: 'sso',
        vendor: config.genericOAuth.vendor,
        label: config.genericOAuth.label,
        issuer: config.genericOAuth.issuer,
        clientId: config.genericOAuth.clientId,
        clientSecret: config.genericOAuth.clientSecret,
        scopes: config.genericOAuth.scopes,
      }),
    );
  }
  providers.push(...createApiKeyProviders(config));
  if (config.enableMockProvider) providers.push(createMockProvider(config));

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // ---- security headers -------------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'", config.appOrigin],
          'base-uri': ["'self'"],
          'object-src': ["'none'"],
          ...(config.cookieSecure ? { 'upgrade-insecure-requests': [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );

  app.use((req, res, next) => {
    req.requestId = randomToken(8);
    res.setHeader('x-request-id', req.requestId);
    const started = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/health') return;
      log.debug({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started, requestId: req.requestId }, 'request');
    });
    next();
  });

  // ---- dev-only mock identity provider ----------------------------------------------------
  if (config.enableMockProvider) {
    const mockAs = await createMockAuthorizationServer({
      issuer: `${config.apiOrigin}/mock-oauth`,
      clientId: MOCK_CLIENT_ID,
      redirectUri: `${config.apiOrigin}/api/auth/mock/callback`,
    });
    app.use('/mock-oauth', express.urlencoded({ extended: false, limit: '8kb' }), mockAs);
    log.warn('mock identity provider and mock AI are enabled (development only)');
  }

  // Stripe's webhook needs the raw body and carries no browser origin; it authenticates by signature.
  app.use('/api/payments/stripe/webhook', stripeWebhook(config, commerce, log));

  // ---- API --------------------------------------------------------------------------------
  const api = express.Router();
  api.use(express.json({ limit: '256kb', strict: true }));
  api.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });
  api.use(csrfOriginCheck([config.appOrigin, config.apiOrigin]));
  api.use(attachUser(store));

  const keyFor = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0');
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: keyFor, message: { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Wait a few minutes.' } } });
  const generateLimiter = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: keyFor, message: { error: { code: 'rate_limited', message: 'Slow down — a few recipes a minute is plenty.' } } });
  const writeLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: keyFor, message: { error: { code: 'rate_limited', message: 'Too many changes at once. Try again in a minute.' } } });
  const generalLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: keyFor });

  api.use(generalLimiter);
  api.get('/health', (_req, res) => res.json({ ok: true, env: config.env }));
  api.use(['/auth/key', '/auth/register', '/auth/login', '/auth/password'], authLimiter);
  api.use('/auth/:provider/start', authLimiter);
  api.use('/auth', authRoutes({ config, log, store, providers, settings, audit, permissions, ai }));
  api.use('/profile', writeLimiter, profileRoutes(db));
  api.use('/ingredients', ingredientRoutes());
  api.use('/recipes/generate', generateLimiter);
  api.use('/recipes', writeLimiter, recipeRoutes(db, ai, notifier, jobs, photos));
  api.use('/social', writeLimiter, socialRoutes(db, notifier, commerce));
  api.use('/blog', writeLimiter, blogRoutes(db, notifier));
  api.use('/books', writeLimiter, bookRoutes(db, notifier));
  api.use('/commerce', writeLimiter, commerceRoutes(db, commerce, settings));
  api.use('/shop', writeLimiter, shopRoutes(db, commerce, settings, notifier));
  api.use('/admin/commerce', adminCommerceRoutes(commerce, audit));
  api.use('/admin/shop', adminShopRoutes(db, permissions, notifier, audit));
  api.use('/notifications', notificationRoutes(notifier));
  api.use('/media', writeLimiter, mediaRoutes(db, mediaStore, settings));
  api.use('/admin', adminRoutes({ db, config, store, settings, audit, providerIds: providers.map((p) => p.id), mediaStore, notifier, permissions, jobs }));
  api.use(notFoundHandler);
  app.use('/api', api);

  // ---- production: serve the built client -------------------------------------------------
  const clientDist = resolve(process.cwd(), '../client/dist');
  if (config.isProd && existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, path) => { if (path.endsWith('.html')) res.setHeader('cache-control', 'no-cache'); } }));
    app.get('/{*splat}', (_req, res) => res.sendFile(resolve(clientDist, 'index.html'), { headers: { 'cache-control': 'no-cache' } }));
  }

  app.use(errorHandler(log));

  const sweeper = setInterval(() => {
    store.purgeExpiredSessions();
    void mediaStore.sweepOrphans();
  }, 6 * 3600_000);
  sweeper.unref();
  // The house kitchen shares a recipe now and then (rate in Admin → Settings).
  const houseTimer = setInterval(() => {
    if (!config.houseKitchen) return;
    try {
      house.tick();
    } catch (e) {
      log.error({ err: e }, 'house kitchen tick failed');
    }
  }, 15 * 60_000);
  houseTimer.unref();

  return {
    app,
    db,
    store,
    providers,
    house,
    commerce,
    permissions,
    jobs,
    close: () => {
      jobs.stop();
      clearInterval(sweeper);
      clearInterval(houseTimer);
      db.close();
    },
  };
}
