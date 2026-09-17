import { Router } from 'express';
import { z } from 'zod';
import { AddBookItemSchema, RecipeContentSchema, UpsertBookSchema, type BookItem, type RecipeBook } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { coverForRecipe } from './media.js';
import type { Notifier } from '../services/notify.js';
import { hasBoughtBook } from '../services/access.js';

interface BookRow {
  id: string;
  owner_id: string;
  owner_handle: string;
  owner_name: string | null;
  owner_avatar: string;
  name: string;
  emoji: string;
  description: string;
  visibility: 'private' | 'public';
  created_at: string;
  updated_at: string;
  recipe_count: number;
  for_sale: number;
  price_cents: number;
  sales_pitch: string;
  preview_count: number;
  sales_count: number;
  promoted: number;
}

export const BOOK_SELECT = `
  SELECT k.id, k.owner_id, u.handle AS owner_handle, u.display_name AS owner_name, u.avatar_emoji AS owner_avatar,
         k.name, k.emoji, k.description, k.visibility, k.created_at, k.updated_at,
         k.for_sale, k.price_cents, k.sales_pitch, k.preview_count,
         (SELECT COUNT(*) FROM recipe_book_items i WHERE i.book_id = k.id) AS recipe_count,
         (SELECT COUNT(*) FROM purchases p WHERE p.book_id = k.id AND p.status = 'paid') AS sales_count,
         EXISTS(SELECT 1 FROM promotions pr WHERE pr.book_id = k.id AND pr.status = 'active') AS promoted
  FROM recipe_books k JOIN users u ON u.id = k.owner_id
  WHERE u.disabled_at IS NULL`;

export function toBook(db: Db, row: BookRow, me: string): RecipeBook {
  // The spine only peeks at recipes the viewer could open anyway.
  const peek = all<{ content: string }>(
    db,
    `SELECT r.content FROM recipe_book_items i JOIN recipes r ON r.id = i.recipe_id
     WHERE i.book_id = ? AND (r.visibility = 'public' OR r.user_id = ?) ORDER BY i.position LIMIT 4`,
    row.id,
    me,
  ).map((r) => (JSON.parse(r.content) as { emoji?: string }).emoji ?? '🍽️');
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    visibility: row.visibility,
    owner: { id: row.owner_id, handle: row.owner_handle, displayName: row.owner_name ?? row.owner_handle, avatar: row.owner_avatar },
    recipeCount: row.recipe_count,
    peek,
    isMine: row.owner_id === me,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    forSale: Boolean(row.for_sale),
    priceCents: row.price_cents,
    salesPitch: row.sales_pitch,
    previewCount: row.preview_count,
    purchased: row.owner_id !== me && hasBoughtBook(db, row.id, me),
    salesCount: row.sales_count,
    promoted: Boolean(row.promoted),
  };
}

/** Books a person can see on someone's profile: all of their own, only public ones of others. */
export function booksFor(db: Db, ownerId: string, me: string): RecipeBook[] {
  const rows =
    ownerId === me
      ? all<BookRow>(db, `${BOOK_SELECT} AND k.owner_id = ? ORDER BY k.updated_at DESC`, ownerId)
      : all<BookRow>(db, `${BOOK_SELECT} AND k.owner_id = ? AND k.visibility = 'public' ORDER BY k.updated_at DESC`, ownerId);
  return rows.map((x) => toBook(db, x, me));
}

export function bookRoutes(db: Db, notifier: Notifier) {
  const r = Router();
  r.use(requireAuth);

  function loadVisible(id: string, me: string): BookRow {
    const row = one<BookRow>(db, `${BOOK_SELECT} AND k.id = ?`, id);
    if (!row || (row.visibility === 'private' && row.owner_id !== me)) throw notFound('That book is gone, or private.');
    return row;
  }
  function loadOwned(id: string, me: string): BookRow {
    const row = one<BookRow>(db, `${BOOK_SELECT} AND k.id = ? AND k.owner_id = ?`, id, me);
    if (!row) throw notFound('That book is gone.');
    return row;
  }

  /** Your books. ?recipeId= adds `contains` so a picker can show which books already hold it. */
  r.get('/', (req, res) => {
    const me = req.user!.id;
    const recipeId = typeof req.query['recipeId'] === 'string' ? req.query['recipeId'] : null;
    const books = booksFor(db, me, me);
    const contains = recipeId ? new Set(all<{ book_id: string }>(db, 'SELECT book_id FROM recipe_book_items WHERE recipe_id = ?', recipeId).map((x) => x.book_id)) : null;
    res.json({ books: books.map((b) => ({ ...b, contains: contains ? contains.has(b.id) : undefined })) });
  });

  r.post('/', (req, res) => {
    const me = req.user!.id;
    const body = parse(UpsertBookSchema, req.body);
    const count = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM recipe_books WHERE owner_id = ?', me)!.n;
    if (count >= 50) throw badRequest('Fifty books is plenty. Merge a couple first.');
    const id = newId('bok');
    const t = now();
    run(db, `INSERT INTO recipe_books (id, owner_id, name, emoji, description, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, me, body.name, body.emoji, body.description, body.visibility, t, t);
    res.status(201).json({ book: toBook(db, loadOwned(id, me), me) });
  });

  r.get('/:id', (req, res) => {
    const me = req.user!.id;
    const row = loadVisible(req.params['id']!, me);
    const book = toBook(db, row, me);
    // A book for sale shows a preview to people who haven't bought it; the rest is title-only.
    const paywalled = book.forSale && !book.isMine && !book.purchased && req.user!.role !== 'admin';
    const items = all<{ recipe_id: string; note: string; added_at: string; title_snapshot: string; emoji_snapshot: string; content: string; visibility: string; user_id: string; handle: string; display_name: string | null }>(
      db,
      `SELECT i.recipe_id, i.note, i.added_at, i.title_snapshot, i.emoji_snapshot, r.content, r.visibility, r.user_id, u.handle, u.display_name
       FROM recipe_book_items i JOIN recipes r ON r.id = i.recipe_id JOIN users u ON u.id = r.user_id
       WHERE i.book_id = ? ORDER BY i.position, i.added_at`,
      row.id,
    );
    const list: BookItem[] = items
      .map((x, position): BookItem => {
        const bought = book.purchased || (book.forSale && book.isMine);
        const inPreview = paywalled && position < book.previewCount;
        const available = x.visibility === 'public' || x.user_id === me || bought || inPreview;
        if (paywalled && position >= book.previewCount) {
          const c = RecipeContentSchema.parse(JSON.parse(x.content));
          return {
            recipeId: x.recipe_id,
            emoji: c.emoji,
            title: c.title,
            summary: '',
            totalMinutes: c.totalMinutes,
            difficulty: c.difficulty,
            mealType: c.mealType,
            cover: null,
            author: { handle: x.handle, displayName: x.display_name ?? x.handle },
            note: '',
            addedAt: x.added_at,
            available: true,
            locked: true,
          };
        }
        if (!available) {
          // The author took it private: the owner keeps a placeholder with the title as it was
          // when shelved, never the recipe's current content.
          return {
            recipeId: x.recipe_id,
            emoji: x.emoji_snapshot || '🔒',
            title: x.title_snapshot || 'A recipe that is no longer shared',
            summary: '',
            totalMinutes: 0,
            difficulty: 'easy',
            mealType: 'dinner',
            cover: null,
            author: { handle: x.handle, displayName: x.display_name ?? x.handle },
            note: x.note,
            addedAt: x.added_at,
            available: false,
            locked: false,
          };
        }
        const c = RecipeContentSchema.parse(JSON.parse(x.content));
        return {
          recipeId: x.recipe_id,
          emoji: c.emoji,
          title: c.title,
          summary: c.summary,
          totalMinutes: c.totalMinutes,
          difficulty: c.difficulty,
          mealType: c.mealType,
          cover: coverForRecipe(db, x.recipe_id),
          author: { handle: x.handle, displayName: x.display_name ?? x.handle },
          note: x.note,
          addedAt: x.added_at,
          available: true,
          locked: false,
        };
      })
      // Recipes that went private since they were added only show (as placeholders) for the book's owner.
      .filter((x) => x.available || row.owner_id === me);
    res.json({ book, items: list });
  });

  r.put('/:id', (req, res) => {
    const me = req.user!.id;
    const row = loadOwned(req.params['id']!, me);
    const body = parse(UpsertBookSchema, req.body);
    run(db, 'UPDATE recipe_books SET name = ?, emoji = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?', body.name, body.emoji, body.description, body.visibility, now(), row.id);
    res.json({ book: toBook(db, loadOwned(row.id, me), me) });
  });

  r.delete('/:id', (req, res) => {
    const me = req.user!;
    const row = one<{ owner_id: string }>(db, 'SELECT owner_id FROM recipe_books WHERE id = ?', req.params['id']);
    if (!row) throw notFound('That book is gone.');
    if (row.owner_id !== me.id && me.role !== 'admin') throw forbidden('Only the owner can delete this book.');
    // Sellers can't pull a book buyers paid for; an admin moderating someone else's book can.
    if ((row.owner_id === me.id || me.role !== 'admin') && one(db, `SELECT 1 FROM purchases WHERE book_id = ? AND status = 'paid'`, req.params['id'])) {
      throw conflict('People have paid for this book, so it can’t be deleted. Take it off sale instead, or ask an admin.');
    }
    run(db, 'DELETE FROM recipe_books WHERE id = ?', req.params['id']);
    res.json({ ok: true });
  });

  /** Add a recipe you own or can see. The recipe's author hears about it (unless it's you). */
  r.post('/:id/items', (req, res) => {
    const me = req.user!.id;
    const row = loadOwned(req.params['id']!, me);
    const body = parse(AddBookItemSchema, req.body);
    const recipe = one<{ id: string; user_id: string; visibility: string; title: string; content: string }>(db, 'SELECT id, user_id, visibility, title, content FROM recipes WHERE id = ?', body.recipeId);
    if (!recipe || (recipe.user_id !== me && recipe.visibility !== 'public')) throw notFound('That recipe is private or gone.');
    if (row.for_sale && recipe.user_id !== me) throw badRequest('A book that’s for sale can only hold your own recipes.');
    if (row.recipe_count >= 200) throw badRequest('A book holds up to 200 recipes.');
    const already = one(db, 'SELECT 1 FROM recipe_book_items WHERE book_id = ? AND recipe_id = ?', row.id, recipe.id);
    if (!already) {
      const pos = one<{ n: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM recipe_book_items WHERE book_id = ?', row.id)!.n;
      const emoji = (JSON.parse(recipe.content) as { emoji?: string }).emoji ?? '🍽️';
      tx(db, () => {
        run(
          db,
          'INSERT INTO recipe_book_items (book_id, recipe_id, position, note, added_at, title_snapshot, emoji_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)',
          row.id,
          recipe.id,
          pos,
          body.note,
          now(),
          recipe.title,
          emoji,
        );
        run(db, 'UPDATE recipe_books SET updated_at = ? WHERE id = ?', now(), row.id);
      });
      if (row.visibility === 'public') notifier.send(recipe.user_id, 'book', { actorId: me, recipeId: recipe.id, bookId: row.id });
    } else if (body.note) run(db, 'UPDATE recipe_book_items SET note = ? WHERE book_id = ? AND recipe_id = ?', body.note, row.id, recipe.id);
    res.status(already ? 200 : 201).json({ ok: true, recipeCount: row.recipe_count + (already ? 0 : 1) });
  });

  r.patch('/:id/items/:recipeId', (req, res) => {
    const me = req.user!.id;
    const row = loadOwned(req.params['id']!, me);
    const body = parse(z.object({ note: z.string().trim().max(300) }), req.body);
    run(db, 'UPDATE recipe_book_items SET note = ? WHERE book_id = ? AND recipe_id = ?', body.note, row.id, req.params['recipeId']);
    res.json({ ok: true });
  });

  r.delete('/:id/items/:recipeId', (req, res) => {
    const me = req.user!.id;
    const row = loadOwned(req.params['id']!, me);
    run(db, 'DELETE FROM recipe_book_items WHERE book_id = ? AND recipe_id = ?', row.id, req.params['recipeId']);
    run(db, 'UPDATE recipe_books SET updated_at = ? WHERE id = ?', now(), row.id);
    res.json({ ok: true });
  });

  /** Reorder: the full list of recipe ids in the order you want them. */
  r.put('/:id/order', (req, res) => {
    const me = req.user!.id;
    const row = loadOwned(req.params['id']!, me);
    const { recipeIds } = parse(z.object({ recipeIds: z.array(z.string().min(1)).max(200) }), req.body);
    tx(db, () => {
      recipeIds.forEach((rid, i) => run(db, 'UPDATE recipe_book_items SET position = ? WHERE book_id = ? AND recipe_id = ?', i, row.id, rid));
      run(db, 'UPDATE recipe_books SET updated_at = ? WHERE id = ?', now(), row.id);
    });
    res.json({ ok: true });
  });

  return r;
}
