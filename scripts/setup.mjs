// One-shot local setup: creates .env from .env.example with fresh secrets if it doesn't exist.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('.env already exists — leaving it alone.');
  process.exit(0);
}
let env = readFileSync('.env.example', 'utf8');
env = env.replace(/^FOODI_SESSION_SECRET=.*$/m, `FOODI_SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
env = env.replace(/^FOODI_ENCRYPTION_KEY=.*$/m, `FOODI_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
writeFileSync('.env', env);
console.log('Wrote .env with fresh secrets. Run `npm run dev`.');
