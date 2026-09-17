import type { Db } from '../db/index.js';
import { one } from '../db/index.js';

/**
 * Who may read a recipe: its owner, an admin, anyone when it's shared, or anyone who has paid
 * for a book it's in. Used by the recipe, media and book routes so the rules can't drift.
 */
export function canReadRecipe(db: Db, recipeId: string, user: { id: string; role: string } | undefined): boolean {
  if (!user) return false;
  const row = one<{ user_id: string; visibility: string }>(db, 'SELECT user_id, visibility FROM recipes WHERE id = ?', recipeId);
  if (!row) return false;
  if (row.user_id === user.id || user.role === 'admin' || row.visibility === 'public') return true;
  return hasBoughtRecipe(db, recipeId, user.id) || isInPreview(db, recipeId);
}

/** Recipes inside the free preview of a public book that's for sale are readable by anyone signed in. */
export function isInPreview(db: Db, recipeId: string): boolean {
  return Boolean(
    one(
      db,
      `SELECT 1 FROM recipe_book_items i JOIN recipe_books k ON k.id = i.book_id
       WHERE i.recipe_id = ? AND k.for_sale = 1 AND k.visibility = 'public'
         AND (SELECT COUNT(*) FROM recipe_book_items j WHERE j.book_id = i.book_id AND (j.position < i.position OR (j.position = i.position AND j.added_at < i.added_at))) < k.preview_count
       LIMIT 1`,
      recipeId,
    ),
  );
}

export function hasBoughtRecipe(db: Db, recipeId: string, userId: string): boolean {
  return Boolean(
    one(
      db,
      `SELECT 1 FROM purchases p JOIN recipe_book_items i ON i.book_id = p.book_id
       WHERE p.buyer_id = ? AND p.status = 'paid' AND i.recipe_id = ? LIMIT 1`,
      userId,
      recipeId,
    ),
  );
}

export function hasBoughtBook(db: Db, bookId: string, userId: string): boolean {
  return Boolean(one(db, `SELECT 1 FROM purchases WHERE buyer_id = ? AND book_id = ? AND status = 'paid' LIMIT 1`, userId, bookId));
}
