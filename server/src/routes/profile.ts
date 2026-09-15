import { Router } from 'express';
import { PantrySchema, ProfileSchema, getIngredient, type Profile } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { now } from '../lib/time.js';

export function getProfile(db: Db, userId: string): Profile | null {
  const row = one<{ json: string }>(db, 'SELECT json FROM profiles WHERE user_id = ?', userId);
  if (!row) return null;
  const parsed = ProfileSchema.safeParse(JSON.parse(row.json));
  return parsed.success ? parsed.data : null;
}

export function profileRoutes(db: Db) {
  const r = Router();
  r.use(requireAuth);

  r.get('/', (req, res) => {
    res.json({ profile: getProfile(db, req.user!.id) });
  });

  r.put('/', (req, res) => {
    const profile = parse(ProfileSchema, req.body);
    tx(db, () => {
      run(
        db,
        `INSERT INTO profiles (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        req.user!.id,
        JSON.stringify(profile),
        now(),
      );
      run(db, 'UPDATE users SET display_name = ? WHERE id = ?', profile.displayName, req.user!.id);
    });
    res.json({ profile });
  });

  r.get('/pantry', (req, res) => {
    const rows = all<{ ingredient_id: string }>(db, 'SELECT ingredient_id FROM pantry_items WHERE user_id = ? ORDER BY added_at', req.user!.id);
    res.json({ ingredientIds: rows.map((x) => x.ingredient_id).filter((id) => getIngredient(id)) });
  });

  r.put('/pantry', (req, res) => {
    const { ingredientIds } = parse(PantrySchema, req.body);
    const valid = [...new Set(ingredientIds.filter((id) => getIngredient(id)))];
    tx(db, () => {
      run(db, 'DELETE FROM pantry_items WHERE user_id = ?', req.user!.id);
      const t = now();
      for (const id of valid) run(db, 'INSERT INTO pantry_items (user_id, ingredient_id, added_at) VALUES (?, ?, ?)', req.user!.id, id, t);
    });
    res.json({ ingredientIds: valid });
  });

  return r;
}
