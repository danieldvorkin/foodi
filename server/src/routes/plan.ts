import { Router } from 'express';
import { z } from 'zod';
import { addDays, CreatePlanEntrySchema, UpdatePlanEntrySchema, weekStart, type PlanEntry } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { canReadRecipe } from '../services/access.js';
import { linesFromRecipe, type Line } from './list.js';
import { parseContent, type RecipeRow } from './recipes.js';

interface EntryRow {
  id: string;
  user_id: string;
  date: string;
  slot: PlanEntry['slot'];
  recipe_id: string | null;
  title: string;
  emoji: string;
  servings: number;
  note: string;
  done: number;
  position: number;
  created_at: string;
  updated_at: string;
}

const WeekQuery = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export function planRoutes(db: Db, list: { addLines: (userId: string, lines: Line[]) => { added: number; merged: number } }) {
  const r = Router();
  r.use(requireAuth);

  function toEntry(row: EntryRow, user: { id: string; role: string }): PlanEntry {
    return {
      id: row.id,
      date: row.date,
      slot: row.slot,
      recipeId: row.recipe_id,
      title: row.title,
      emoji: row.emoji,
      servings: row.servings,
      note: row.note,
      done: Boolean(row.done),
      position: row.position,
      recipeAvailable: Boolean(row.recipe_id && canReadRecipe(db, row.recipe_id, user)),
      createdAt: row.created_at,
    };
  }
  const load = (id: string, userId: string) => {
    const row = one<EntryRow>(db, 'SELECT * FROM plan_entries WHERE id = ? AND user_id = ?', id, userId);
    if (!row) throw notFound('That plan entry is gone.');
    return row;
  };
  const weekRows = (userId: string, start: string) => all<EntryRow>(db, 'SELECT * FROM plan_entries WHERE user_id = ? AND date >= ? AND date < ? ORDER BY date, slot, position, created_at', userId, start, addDays(start, 7));

  /** A week of entries. ?week= any date in it; defaults to the current week (UTC). */
  r.get('/', (req, res) => {
    const q = parse(WeekQuery, req.query);
    const start = weekStart(q.week ?? new Date().toISOString().slice(0, 10));
    res.json({ week: start, entries: weekRows(req.user!.id, start).map((x) => toEntry(x, req.user!)) });
  });

  /** The next few meals from today, for the feed rail. */
  r.get('/upcoming', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = all<EntryRow>(db, `SELECT * FROM plan_entries WHERE user_id = ? AND date >= ? AND done = 0 AND slot != 'prep' ORDER BY date, slot, position LIMIT 3`, req.user!.id, today);
    res.json({ entries: rows.map((x) => toEntry(x, req.user!)) });
  });

  /** Recipes to put on the plan: yours, saved, and the house kitchen's, by title. */
  r.get('/candidates', (req, res) => {
    const q = String(req.query['q'] ?? '')
      .trim()
      .slice(0, 60)
      .toLowerCase();
    const rows = all<{ id: string; title: string; content: string; mine: number }>(
      db,
      `SELECT r.id, r.title, r.content, (r.user_id = ?) AS mine FROM recipes r JOIN users u ON u.id = r.user_id
       WHERE (r.user_id = ? OR (u.is_system = 1 AND r.visibility = 'public')) AND (? = '' OR lower(r.title) LIKE ?)
       ORDER BY mine DESC, r.updated_at DESC LIMIT 20`,
      req.user!.id,
      req.user!.id,
      q,
      `%${q}%`,
    );
    res.json({
      recipes: rows.map((x) => {
        const c = JSON.parse(x.content) as { emoji?: string; servings?: number; totalMinutes?: number };
        return { id: x.id, title: x.title, emoji: c.emoji ?? '🍽️', servings: c.servings ?? 2, totalMinutes: c.totalMinutes ?? null, mine: Boolean(x.mine) };
      }),
    });
  });

  r.post('/entries', (req, res) => {
    const me = req.user!;
    const body = parse(CreatePlanEntrySchema, req.body);
    let title = body.title ?? '';
    let emoji = body.emoji ?? '🍽️';
    let servings = body.servings ?? 2;
    if (body.recipeId) {
      const row = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', body.recipeId);
      if (!row || !canReadRecipe(db, row.id, me)) throw notFound('That recipe isn’t available.');
      const c = parseContent(row);
      title = body.title ?? row.title;
      emoji = body.emoji ?? c.emoji;
      servings = body.servings ?? c.servings;
    }
    const position = one<{ n: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM plan_entries WHERE user_id = ? AND date = ? AND slot = ?', me.id, body.date, body.slot)!.n;
    const id = newId('pln');
    run(
      db,
      `INSERT INTO plan_entries (id, user_id, date, slot, recipe_id, title, emoji, servings, note, done, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      id,
      me.id,
      body.date,
      body.slot,
      body.recipeId ?? null,
      title,
      emoji,
      servings,
      body.note,
      position,
      now(),
      now(),
    );
    res.status(201).json({ entry: toEntry(load(id, me.id), me) });
  });

  r.patch('/entries/:id', (req, res) => {
    const me = req.user!;
    const body = parse(UpdatePlanEntrySchema, req.body);
    const row = load(req.params['id']!, me.id);
    const moved = (body.date && body.date !== row.date) || (body.slot && body.slot !== row.slot);
    const position = moved ? one<{ n: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM plan_entries WHERE user_id = ? AND date = ? AND slot = ?', me.id, body.date ?? row.date, body.slot ?? row.slot)!.n : row.position;
    run(
      db,
      'UPDATE plan_entries SET date = ?, slot = ?, servings = ?, note = ?, done = ?, title = ?, position = ?, updated_at = ? WHERE id = ?',
      body.date ?? row.date,
      body.slot ?? row.slot,
      body.servings ?? row.servings,
      body.note ?? row.note,
      body.done === undefined ? row.done : body.done ? 1 : 0,
      body.title ?? row.title,
      position,
      now(),
      row.id,
    );
    res.json({ entry: toEntry(load(row.id, me.id), me) });
  });

  r.delete('/entries/:id', (req, res) => {
    const { changes } = run(db, 'DELETE FROM plan_entries WHERE id = ? AND user_id = ?', req.params['id'], req.user!.id);
    if (!Number(changes)) throw notFound('That plan entry is gone.');
    // Shopping lines that came from it lose their link but stay on the list.
    run(db, 'UPDATE shopping_items SET plan_entry_id = NULL WHERE plan_entry_id = ?', req.params['id']);
    res.json({ ok: true });
  });

  /** Everything the week's recipes need, onto the shopping list at the planned servings. */
  r.post('/to-list', (req, res) => {
    const me = req.user!;
    const q = parse(WeekQuery, req.body ?? {});
    const start = weekStart(q.week ?? new Date().toISOString().slice(0, 10));
    const lines: Line[] = [];
    const skipped: string[] = [];
    for (const e of weekRows(me.id, start)) {
      if (e.done || !e.recipe_id) continue;
      const row = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', e.recipe_id);
      if (!row || !canReadRecipe(db, row.id, me)) {
        skipped.push(e.title);
        continue;
      }
      for (const l of linesFromRecipe(row, e.servings, undefined)) lines.push({ ...l, planEntryId: e.id });
    }
    if (!lines.length) throw badRequest(skipped.length ? 'None of this week’s recipes can be opened any more.' : 'Nothing on the plan this week uses a recipe yet.');
    const result = list.addLines(me.id, lines); // addLines runs its own transaction
    res.json({ ...result, skipped, week: start });
  });

  return r;
}
