import { loadDotEnv } from './env.js';
loadDotEnv();
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const log = createLogger(config.logLevel, !config.isProd && config.env !== 'test');
const { app, close } = await createApp({ config, log });

const server = app.listen(config.port, () => {
  log.info({ port: config.port, env: config.env }, `foodi api listening on ${config.apiOrigin}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info({ sig }, 'shutting down');
    server.close(() => {
      close();
      process.exit(0);
    });
  });
}
