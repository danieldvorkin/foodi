import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load the repo-root .env (or a local one) without a dependency. Real env vars win. */
export function loadDotEnv() {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
  }
  return null;
}
