import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      FOODI_SESSION_SECRET: 'test-session-secret-at-least-32-characters-long!!',
      FOODI_ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
      FOODI_DB_PATH: ':memory:',
      FOODI_UPLOAD_DIR: `${tmpdir()}/foodi-test-uploads-${process.pid}`,
      FOODI_ENABLE_MOCK_PROVIDER: 'true',
      FOODI_LOG_LEVEL: 'silent',
    },
  },
});
