import { Router } from 'express';
import { AddListItemsSchema, canonicalUnit, categorize, ClearListSchema, parseQuantity, parseQuickAdd, tidy, UpdateListItemSchema, type ShoppingItem } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { canReadRecipe } from '../services/access.js';
import { parseContent, type RecipeRow } from './recipes.js';

interface ItemRow {
  id: string;
  user_id: string;
  text: string;
  quantity: number | null;
  unit: string | null;
  ingredient_id: string | null;
  category: ShoppingItem['category'];
  checked: number;
  recipe_id: string | null;
  recipe_title: string | null;
  plan_entry_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function toItem(r: ItemRow): ShoppingItem {
  return { id: r.id, text: r.text, quantity: r.quantity, unit: r.unit, ingredientId: r.ingredient_id, category: r.category, checked: Boolean(r.checked), recipeId: r.recipe_id, recipeTitle: r.recipe_title, planEntryId: r.plan_entry_id, position: r.position, createdAt: r.created_at };
}

/** One line to add, before merging. */
export interface Line {
  text: string;
  quantity: number | null;
  unit: string | null;
  ingredientId: string | null;
  recipeId?: string | null;
  recipeTitle?: string | null;
  planEntryId?: string | null;
}

/**
 * A recipe's ingredients as list lines, scaled to `servings`. Optional garnishes are skipped
 * unless asked for by index; quantities that aren't numbers ("a handful") stay as text on the line.
 */
export function linesFromRecipe(row: RecipeRow, servings: number | undefined, indexes: number[] | undefined): Line[] {
  const c = parseContent(row);
  const factor = servings && c.servings ? servings / c.servings : 1;
  const wanted = indexes ? new Set(indexes) : null;
  const out: Line[] = [];
  c.ingredients.forEach((ing, i) => {
    if (wanted ? !wanted.has(i) : ing.optional) return;
    const q = parseQuantity(ing.quantity);
    const { category: _c, ingredientId } = categorize(ing.item, ing.ingredientId);
    const text = q === null && ing.quantity ? `${ing.quantity} ${ing.item}` : ing.item;
    out.push({ text, quantity: q === null ? null : tidy(q * factor), unit: canonicalUnit(ing.unit), ingredientId, recipeId: row.id, recipeTitle: row.title });
  });
  return out;
}

export function listRoutes(db: Db) {
  const r = Router();
  r.use(requireAuth);

  const mine = (userId: string) => all<ItemRow>(db, 'SELECT * FROM shopping_items WHERE user_id = ? ORDER BY position, created_at', userId).map(toItem);
  const nextPosition = (userId: string) => one<{ n: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM shopping_items WHERE user_id = ?', userId)!.n;

  /**
   * Put lines on the list. A line merges into an existing unchecked line for the same
   * ingredient (or same text) and unit when both have numbers: 2 lemons + 3 lemons = 5 lemons.
   * Anything else becomes its own line. Returns how many lines were added vs merged.
   */
  function addLines(userId: string, lines: Line[]): { added: number; merged: number } {
    let added = 0;
    let merged = 0;
    tx(db, () => {
      let pos = nextPosition(userId);
      for (const l of lines) {
        const { category, ingredientId } = categorize(l.text, l.ingredientId);
        const key = ingredientId ?? l.text.trim().toLowerCase();
        const existing =
          l.quantity !== null
            ? one<ItemRow>(
                db,
                `SELECT * FROM shopping_items WHERE user_id = ? AND checked = 0 AND quantity IS NOT NULL
                 AND COALESCE(unit, '') = COALESCE(?, '') AND (ingredient_id = ? OR (ingredient_id IS NULL AND lower(text) = ?)) LIMIT 1`,
                userId,
                l.unit,
                ingredientId ?? '',
                key,
              )
            : undefined;
        if (existing) {
          run(db, 'UPDATE shopping_items SET quantity = ?, updated_at = ? WHERE id = ?', tidy(existing.quantity! + l.quantity!), now(), existing.id);
          merged++;
          continue;
        }
        run(
          db,
          `INSERT INTO shopping_items (id, user_id, text, quantity, unit, ingredient_id, category, checked, recipe_id, recipe_title, plan_entry_id, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
          newId('shp'),
          userId,
          l.text.trim(),
          l.quantity,
          l.unit,
          ingredientId,
          category,
          l.recipeId ?? null,
          l.recipeTitle ?? null,
          l.planEntryId ?? null,
          pos++,
          now(),
          now(),
        );
        added++;
      }
    });
    return { added, merged };
  }

  r.get('/', (req, res) => {
    const items = mine(req.user!.id);
    res.json({ items, counts: { open: items.filter((i) => !i.checked).length, checked: items.filter((i) => i.checked).length } });
  });

  r.post('/items', (req, res) => {
    const userId = req.user!.id;
    const body = parse(AddListItemsSchema, req.body);
    let result: { added: number; merged: number };
    if ('text' in body) {
      const q = parseQuickAdd(body.text);
      result = addLines(userId, [{ text: q.text, quantity: q.quantity, unit: q.unit, ingredientId: null }]);
    } else {
      const { recipeId, servings, ingredientIndexes } = body.fromRecipe;
      const row = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', recipeId);
      if (!row || !canReadRecipe(db, row.id, req.user)) throw notFound('That recipe isn’t available.');
      const lines = linesFromRecipe(row, servings, ingredientIndexes);
      if (!lines.length) throw badRequest('Nothing to add — pick at least one ingredient.');
      result = addLines(userId, lines);
    }
    const items = mine(userId);
    res.status(201).json({ items, ...result });
  });

  r.patch('/items/:id', (req, res) => {
    const userId = req.user!.id;
    const body = parse(UpdateListItemSchema, req.body);
    const row = one<ItemRow>(db, 'SELECT * FROM shopping_items WHERE id = ? AND user_id = ?', req.params['id'], userId);
    if (!row) throw notFound('That line is gone.');
    const text = body.text ?? row.text;
    const cat = body.text !== undefined ? categorize(text, null) : { category: row.category, ingredientId: row.ingredient_id };
    run(
      db,
      'UPDATE shopping_items SET text = ?, quantity = ?, unit = ?, checked = ?, category = ?, ingredient_id = ?, updated_at = ? WHERE id = ?',
      text,
      body.quantity !== undefined ? body.quantity : row.quantity,
      body.unit !== undefined ? canonicalUnit(body.unit) : row.unit,
      body.checked !== undefined ? (body.checked ? 1 : 0) : row.checked,
      cat.category,
      cat.ingredientId,
      now(),
      row.id,
    );
    res.json({ item: toItem(one<ItemRow>(db, 'SELECT * FROM shopping_items WHERE id = ?', row.id)!) });
  });

  r.delete('/items/:id', (req, res) => {
    const { changes } = run(db, 'DELETE FROM shopping_items WHERE id = ? AND user_id = ?', req.params['id'], req.user!.id);
    if (!Number(changes)) throw notFound('That line is gone.');
    res.json({ ok: true });
  });

  r.post('/clear', (req, res) => {
    const { checkedOnly } = parse(ClearListSchema, req.body ?? {});
    const { changes } = run(db, checkedOnly ? 'DELETE FROM shopping_items WHERE user_id = ? AND checked = 1' : 'DELETE FROM shopping_items WHERE user_id = ?', req.user!.id);
    res.json({ removed: Number(changes), items: mine(req.user!.id) });
  });

  return { router: r, addLines };
}
