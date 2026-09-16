import { loadDotEnv } from '../env.js';
loadDotEnv();
import { loadConfig } from '../config.js';
import { all, openDb, run } from '../db/index.js';

const who = process.argv[2];
if (!who) {
  console.error('Usage: npm run make-admin -- <email | handle | user id>');
  process.exit(1);
}
const config = loadConfig();
const db = openDb(config.dbPath);
const matches = all<{ id: string; handle: string; role: string; email: string | null }>(db, 'SELECT id, handle, role, email FROM users WHERE lower(email) = ? OR handle = ? OR id = ?', who.toLowerCase(), who.toLowerCase(), who);
if (matches.length === 0) {
  console.error(`No user matches "${who}". They need to sign in once first.`);
  process.exit(1);
}
if (matches.length > 1) {
  // Never guess between accounts: an attacker who pre-registered the same email would love that.
  console.error(`"${who}" matches ${matches.length} accounts. Use the handle or id instead:`);
  for (const m of matches) console.error(`  ${m.id}  @${m.handle}  ${m.email ?? ''}  (${m.role})`);
  process.exit(1);
}
const user = matches[0]!;
run(db, `UPDATE users SET role = 'admin' WHERE id = ?`, user.id);
console.log(`@${user.handle} is now an admin (was ${user.role}).`);
db.close();
