import { Router } from 'express';
import { BrowseQuerySchema, RecipeContentSchema, type BrowseRecipe, type BrowseRecipeDetail } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../middleware/validate.js';
import type { MediaRow } from './media.js';

interface Row {
  id: string;
  title: string;
  content: string;
  created_at: string;
  handle: string;
  display_name: string | null;
  avatar_emoji: string;
  is_system: number;
  cover_id: string | null;
  cover_ext: string | null;
}

const SELECT = `
  SELECT r.id, r.title, r.content, r.created_at, u.handle, u.display_name, u.avatar_emoji, u.is_system,
         (SELECT m.id FROM media m WHERE m.recipe_id = r.id AND m.kind = 'image' ORDER BY m.position, m.created_at LIMIT 1) AS cover_id,
         (SELECT m.ext FROM media m WHERE m.recipe_id = r.id AND m.kind = 'image' ORDER BY m.position, m.created_at LIMIT 1) AS cover_ext
  FROM recipes r JOIN users u ON u.id = r.user_id
  WHERE r.visibility = 'public' AND u.disabled_at IS NULL`;

function toBrowse(row: Row): BrowseRecipe {
  const c = RecipeContentSchema.parse(JSON.parse(row.content));
  return {
    id: row.id,
    emoji: c.emoji,
    title: row.title,
    summary: c.summary,
    mealType: c.mealType,
    cuisine: c.cuisine,
    totalMinutes: c.totalMinutes,
    difficulty: c.difficulty,
    servings: c.servings,
    dietLabels: c.dietLabels,
    tags: c.tags,
    cover: row.cover_id ? `/share/recipes/${row.id}/cover.${row.cover_ext}` : null,
    author: { handle: row.handle, displayName: row.display_name ?? row.handle, avatar: row.avatar_emoji, isHouse: Boolean(row.is_system) },
    createdAt: row.created_at,
  };
}

/**
 * The shop window: public recipes for people without an account. Search and filters are
 * applied in SQL where cheap (title, the JSON text, time) and in code for the rest, over a
 * bounded window, newest first with a created_at cursor.
 */
export function browseRoutes(db: Db) {
  const r = Router();

  r.get('/', (req, res) => {
    const q = parse(BrowseQuerySchema, req.query);
    const needle = q.q.toLowerCase();
    const params: unknown[] = [];
    let where = '';
    if (needle) {
      where += ' AND (lower(r.title) LIKE ? OR lower(r.content) LIKE ?)';
      params.push(`%${needle}%`, `%${needle}%`);
    }
    if (q.cursor) {
      where += ' AND r.created_at < ?';
      params.push(q.cursor);
    }
    // Over-fetch, then filter the JSON-only fields in code and trim to the page.
    const rows = all<Row>(db, `${SELECT}${where} ORDER BY r.created_at DESC LIMIT ?`, ...params, q.limit * 4 + 1);
    const items: BrowseRecipe[] = [];
    let nextCursor: string | null = null;
    for (const row of rows) {
      const it = toBrowse(row);
      if (q.meal && it.mealType !== q.meal) continue;
      if (q.diet && !it.dietLabels.includes(q.diet)) continue;
      if (q.difficulty && it.difficulty !== q.difficulty) continue;
      if (q.maxMinutes && it.totalMinutes > q.maxMinutes) continue;
      if (items.length === q.limit) {
        nextCursor = items[items.length - 1]!.createdAt;
        break;
      }
      items.push(it);
    }
    // More rows than we looked at may still qualify: hand back a cursor when the window was full.
    if (!nextCursor && rows.length > q.limit * 4) nextCursor = rows[rows.length - 1]!.created_at;
    res.setHeader('cache-control', 'public, max-age=60');
    res.json({ recipes: items, nextCursor });
  });

  /** One public recipe, method withheld: the moment to ask them to join. */
  r.get('/:id', (req, res) => {
    const row = one<Row>(db, `${SELECT} AND r.id = ?`, req.params['id']);
    if (!row) throw notFound('That recipe isn’t public.');
    const c = RecipeContentSchema.parse(JSON.parse(row.content));
    const media = all<MediaRow>(db, `SELECT * FROM media WHERE recipe_id = ? AND kind = 'image' ORDER BY position, created_at LIMIT 6`, row.id);
    const detail: BrowseRecipeDetail = {
      ...toBrowse(row),
      ingredients: c.ingredients,
      stepTitles: c.steps.map((s) => s.title),
      stepCount: c.steps.length,
      activeMinutes: c.activeMinutes,
      equipment: c.equipment,
      allergens: c.allergens,
      media: media.map((m) => ({ id: m.id, kind: m.kind, width: m.width, height: m.height, credit: m.credit, license: m.license, sourceUrl: m.source_url, source: m.source, generated: Boolean(m.generated), url: `/share/recipes/${row.id}/cover.${m.ext}` })),
    };
    res.setHeader('cache-control', 'public, max-age=60');
    res.json({ recipe: detail });
  });

  return r;
}
