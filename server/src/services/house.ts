import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import type { Logger } from '../lib/logger.js';
import { now } from '../lib/time.js';
import { postProcess } from '../ai/service.js';
import { HOUSE_RECIPES } from '../seed/recipes.js';
import { toContent } from '../seed/expand.js';
import type { SeedRecipe } from '../seed/types.js';
import type { Notifier } from './notify.js';
import type { Settings } from './settings.js';

export const HOUSE_HANDLE = 'foodi';

/**
 * The house kitchen: a system account that owns a library of starter recipes so people have
 * something to cook, save, shelve and adapt before they connect an AI. On boot it makes sure
 * the account, recipes and curated books exist; a timer then shares one recipe to the feed
 * every so often (Admin → Settings controls the rate).
 */
export function createHouse(db: Db, settings: Settings, notifier: Notifier, log: Logger) {
  function account(): { id: string } {
    const existing = one<{ id: string }>(db, 'SELECT id FROM users WHERE is_system = 1 LIMIT 1');
    if (existing) {
      // 🍳 reads as a magnifying glass at small sizes; the pan is clearer.
      run(db, `UPDATE users SET avatar_emoji = '🥘' WHERE id = ? AND avatar_emoji = '🍳'`, existing.id);
      return existing;
    }
    // If a person already took the handle, fall back rather than fail.
    const handle = one(db, 'SELECT 1 FROM users WHERE handle = ?', HOUSE_HANDLE) ? 'foodi_kitchen' : HOUSE_HANDLE;
    const id = 'usr_foodi_kitchen';
    run(
      db,
      `INSERT INTO users (id, role, display_name, email, handle, bio, avatar_emoji, disabled_at, created_at, last_seen_at, is_system)
       VALUES (?, 'consumer', 'foodi kitchen', NULL, ?, ?, '🥘', NULL, ?, NULL, 1)`,
      id,
      handle,
      'Recipes from the house kitchen — tested, varied, and free to save, shelve or adapt. No AI needed.',
      now(),
    );
    log.info({ handle }, 'created the house kitchen account');
    return { id };
  }

  /** Insert any house recipe not already present (matched by title). Returns how many were added. */
  function importRecipes(ownerId: string): number {
    const have = new Set(all<{ title: string }>(db, 'SELECT title FROM recipes WHERE user_id = ?', ownerId).map((r) => r.title));
    let added = 0;
    for (const seed of HOUSE_RECIPES) {
      if (have.has(seed.title)) continue;
      const content = postProcess(toContent(seed), {} as never);
      const created = new Date(Date.now() - seed.daysAgo * 86400_000 - Math.floor(Math.random() * 6) * 3600_000).toISOString();
      run(
        db,
        `INSERT INTO recipes (id, user_id, source, visibility, title, prompt, requested_ingredient_ids, provider, model, content, favorite, created_at, updated_at)
         VALUES (?, ?, 'user', 'public', ?, '', '[]', 'house', '', ?, 0, ?, ?)`,
        newId('rcp'),
        ownerId,
        content.title,
        JSON.stringify(content),
        created,
        created,
      );
      added++;
    }
    return added;
  }

  const BOOKS: { name: string; emoji: string; description: string; pick: (r: SeedRecipe) => boolean }[] = [
    { name: 'Weeknights under 30', emoji: '⚡', description: 'Dinner and lunch on the table in half an hour or less.', pick: (r) => r.total <= 30 && (r.meal === 'dinner' || r.meal === 'lunch') },
    { name: 'Plant-based', emoji: '🌱', description: 'Fully vegan, no substitutions needed.', pick: (r) => r.diet.includes('vegan') },
    { name: 'Gluten-free comforts', emoji: '🌾', description: 'Big, warming plates that happen to have no gluten.', pick: (r) => r.diet.includes('gluten-free') && r.meal === 'dinner' },
    { name: 'Sunday projects', emoji: '🕰️', description: 'Worth an afternoon: braises, roasts, and things that rest overnight.', pick: (r) => r.level === 'hard' || r.total >= 60 },
    { name: 'High-protein', emoji: '💪', description: 'Meals that pull their weight.', pick: (r) => r.diet.includes('high-protein') },
    { name: 'Sweet things', emoji: '🍰', description: 'Desserts and drinks to finish on.', pick: (r) => r.meal === 'dessert' || r.meal === 'drink' },
  ];

  /** Create the curated books if missing and make sure every matching recipe is on the shelf. */
  function ensureBooks(ownerId: string) {
    const recipes = all<{ id: string; title: string; content: string }>(db, 'SELECT id, title, content FROM recipes WHERE user_id = ?', ownerId);
    const byTitle = new Map(recipes.map((r) => [r.title, r]));
    for (const book of BOOKS) {
      let row = one<{ id: string }>(db, 'SELECT id FROM recipe_books WHERE owner_id = ? AND name = ?', ownerId, book.name);
      if (!row) {
        row = { id: newId('bok') };
        run(db, `INSERT INTO recipe_books (id, owner_id, name, emoji, description, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'public', ?, ?)`, row.id, ownerId, book.name, book.emoji, book.description, now(), now());
      }
      const shelved = new Set(all<{ recipe_id: string }>(db, 'SELECT recipe_id FROM recipe_book_items WHERE book_id = ?', row.id).map((x) => x.recipe_id));
      let pos = one<{ n: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM recipe_book_items WHERE book_id = ?', row.id)!.n;
      for (const seed of HOUSE_RECIPES) {
        const rec = byTitle.get(seed.title);
        if (!rec || shelved.has(rec.id) || !book.pick(seed)) continue;
        const emoji = (JSON.parse(rec.content) as { emoji?: string }).emoji ?? '🍽️';
        run(db, 'INSERT INTO recipe_book_items (book_id, recipe_id, position, note, added_at, title_snapshot, emoji_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)', row.id, rec.id, pos++, '', now(), rec.title, emoji);
      }
    }
  }

  function post(ownerId: string, recipe: { id: string; title: string }, createdAt = now()) {
    const seed = HOUSE_RECIPES.find((r) => r.title === recipe.title);
    const id = newId('pst');
    run(db, `INSERT INTO posts (id, author_id, recipe_id, caption, created_at) VALUES (?, ?, ?, ?, ?)`, id, ownerId, recipe.id, seed?.caption ?? '', createdAt);
    return id;
  }

  /** First boot with an empty feed: share the older half of the library, spread over the past weeks. */
  function backfill(ownerId: string) {
    if (one(db, 'SELECT 1 FROM posts WHERE author_id = ?', ownerId)) return 0;
    const recipes = all<{ id: string; title: string; created_at: string }>(db, 'SELECT id, title, created_at FROM recipes WHERE user_id = ?', ownerId);
    let n = 0;
    for (const r of recipes) {
      const seed = HOUSE_RECIPES.find((s) => s.title === r.title);
      if (!seed || seed.daysAgo > 25) continue; // the rest drip out over the coming days
      post(ownerId, r, r.created_at);
      n++;
    }
    return n;
  }

  /** Share one not-yet-posted recipe if it's time. Called from a timer. */
  function tick(): boolean {
    const perDay = settings.get().housePostsPerDay;
    if (perDay <= 0) return false;
    const { id: ownerId } = account();
    const last = one<{ t: string }>(db, 'SELECT MAX(created_at) AS t FROM posts WHERE author_id = ?', ownerId)?.t;
    if (last && Date.now() - new Date(last).getTime() < (24 * 3600_000) / perDay) return false;
    const candidates = all<{ id: string; title: string }>(
      db,
      `SELECT id, title FROM recipes WHERE user_id = ? AND visibility = 'public' AND id NOT IN (SELECT recipe_id FROM posts WHERE author_id = ?)`,
      ownerId,
      ownerId,
    );
    if (candidates.length === 0) return false;
    const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
    const postId = post(ownerId, pick);
    notifier.sendToFollowers(ownerId, 'post', { postId });
    log.info({ title: pick.title }, 'house kitchen shared a recipe');
    return true;
  }

  function ensure() {
    return tx(db, () => {
      const { id } = account();
      const added = importRecipes(id);
      ensureBooks(id);
      const posted = backfill(id);
      if (added || posted) log.info({ added, posted }, 'house kitchen library ready');
      return { id, added, posted };
    });
  }

  return { ensure, tick, account };
}
export type House = ReturnType<typeof createHouse>;
