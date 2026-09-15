import { randomBytes } from 'node:crypto';
console.log(`FOODI_SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`FOODI_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
