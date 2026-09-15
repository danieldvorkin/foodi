import { loadDotEnv } from '../env.js';
loadDotEnv();
import { loadConfig } from '../config.js';
import { openDb, one, run } from '../db/index.js';

const who = process.argv[2];
if (!who) {
  console.error('Usage: npm run make-admin -- <email | handle | user id>');
  process.exit(1);
}
const config = loadConfig();
const db = openDb(config.dbPath);
const user = one<{ id: string; handle: string; role: string }>(db, 'SELECT id, handle, role FROM users WHERE email = ? OR handle = ? OR id = ?', who.toLowerCase(), who.toLowerCase(), who);
if (!user) {
  console.error(`No user matches "${who}". They need to sign in once first.`);
  process.exit(1);
}
run(db, `UPDATE users SET role = 'admin' WHERE id = ?`, user.id);
console.log(`@${user.handle} is now an admin (was ${user.role}).`);
db.close();
