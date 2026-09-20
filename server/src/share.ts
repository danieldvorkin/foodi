import { createReadStream, statSync } from 'node:fs';
import { Router } from 'express';
import { formatMoney } from '@foodi/shared';
import type { Db } from './db/index.js';
import { all, one } from './db/index.js';
import type { MediaRow, MediaStore } from './routes/media.js';

/**
 * What a pasted link unfurls into (iMessage, WhatsApp, Slack, X, Discord…). The SPA can't set
 * these per page, so the server swaps the block between the share markers in index.html for
 * public things: recipes, people, books, blog posts and shop listings. Anything private, or
 * anything it doesn't recognise, gets the site card.
 */
export interface ShareTags {
  title: string;
  description: string;
  /** Absolute URL of a 1200×630-ish image. */
  image: string;
  imageAlt: string;
  url: string;
  type: 'website' | 'article' | 'profile';
}

export const SHARE_START = '<!-- share:start -->';
export const SHARE_END = '<!-- share:end -->';
const SITE_NAME = 'foodi';
const TAGLINE = 'Guided recipes, written around you — allergies, skill, time, what’s in the kitchen — cooked one step at a time with the AI you already have.';

export function defaultTags(origin: string): ShareTags {
  return {
    title: 'foodi — cook something tonight, we’ll walk you through it',
    description: TAGLINE,
    image: `${origin}/og.png`,
    imageAlt: 'foodi: a recipe card with step-by-step cooking and a timer',
    url: `${origin}/`,
    type: 'website',
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

export function shareBlock(t: ShareTags): string {
  const lines = [
    `<title>${esc(t.title)}</title>`,
    `<meta name="description" content="${esc(t.description)}" />`,
    `<link rel="canonical" href="${esc(t.url)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="${t.type}" />`,
    `<meta property="og:title" content="${esc(t.title)}" />`,
    `<meta property="og:description" content="${esc(t.description)}" />`,
    `<meta property="og:url" content="${esc(t.url)}" />`,
    `<meta property="og:image" content="${esc(t.image)}" />`,
    `<meta property="og:image:alt" content="${esc(t.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(t.title)}" />`,
    `<meta name="twitter:description" content="${esc(t.description)}" />`,
    `<meta name="twitter:image" content="${esc(t.image)}" />`,
    `<meta name="twitter:image:alt" content="${esc(t.imageAlt)}" />`,
  ];
  return `${SHARE_START}\n    ${lines.join('\n    ')}\n    ${SHARE_END}`;
}

/** index.html with its share block replaced. Leaves the file alone if the markers are missing. */
export function renderShareHtml(indexHtml: string, tags: ShareTags): string {
  const a = indexHtml.indexOf(SHARE_START);
  const b = indexHtml.indexOf(SHARE_END);
  if (a < 0 || b < 0 || b < a) return indexHtml;
  return indexHtml.slice(0, a) + shareBlock(tags) + indexHtml.slice(b + SHARE_END.length);
}

/** The cover of a public recipe, when it has one. */
function publicCover(db: Db, recipeId: string): MediaRow | undefined {
  return one<MediaRow>(
    db,
    `SELECT m.* FROM media m JOIN recipes r ON r.id = m.recipe_id
     WHERE m.recipe_id = ? AND m.kind = 'image' AND r.visibility = 'public'
     ORDER BY m.position, m.created_at LIMIT 1`,
    recipeId,
  );
}

/** Share tags for an app path, or null when it isn't a public thing we know how to describe. */
export function tagsForPath(db: Db, origin: string, path: string): ShareTags | null {
  const base = defaultTags(origin);
  let m: RegExpExecArray | null;

  if ((m = /^\/(?:app\/recipes|browse)\/([\w-]+)\/?$/.exec(path))) {
    const r = one<{ id: string; title: string; content: string; handle: string; display_name: string | null }>(
      db,
      `SELECT r.id, r.title, r.content, u.handle, u.display_name FROM recipes r JOIN users u ON u.id = r.user_id WHERE r.id = ? AND r.visibility = 'public'`,
      m[1],
    );
    if (!r) return null;
    const c = JSON.parse(r.content) as { summary?: string; emoji?: string; totalMinutes?: number; servings?: number };
    const cover = publicCover(db, r.id);
    const facts = [c.totalMinutes ? `${c.totalMinutes} min` : '', c.servings ? `serves ${c.servings}` : ''].filter(Boolean).join(' · ');
    return {
      ...base,
      title: `${c.emoji ? `${c.emoji} ` : ''}${r.title} — foodi`,
      description: clip(`${c.summary ?? ''}${facts ? ` (${facts})` : ''} By ${r.display_name ?? `@${r.handle}`} on foodi.`, 200),
      image: cover ? `${origin}/share/recipes/${r.id}/cover.${cover.ext}` : base.image,
      imageAlt: cover ? `Photo of ${r.title}` : base.imageAlt,
      url: `${origin}/browse/${r.id}`,
      type: 'article',
    };
  }

  if ((m = /^\/app\/u\/([\w.-]+)\/?$/.exec(path))) {
    const u = one<{ handle: string; display_name: string | null; bio: string; avatar_emoji: string; n: number }>(
      db,
      `SELECT u.handle, u.display_name, u.bio, u.avatar_emoji, (SELECT COUNT(*) FROM recipes r WHERE r.user_id = u.id AND r.visibility = 'public') AS n
       FROM users u WHERE u.handle = ? AND u.disabled_at IS NULL`,
      m[1],
    );
    if (!u) return null;
    return {
      ...base,
      title: `${u.avatar_emoji} ${u.display_name ?? `@${u.handle}`} on foodi`,
      description: clip(`${u.bio || `@${u.handle}`} · ${u.n} shared ${u.n === 1 ? 'recipe' : 'recipes'}.`, 200),
      url: `${origin}/app/u/${u.handle}`,
      type: 'profile',
    };
  }

  if ((m = /^\/app\/books\/([\w-]+)\/?$/.exec(path))) {
    const b = one<{ id: string; name: string; emoji: string; description: string; display_name: string | null; handle: string; n: number }>(
      db,
      `SELECT b.id, b.name, b.emoji, b.description, u.display_name, u.handle, (SELECT COUNT(*) FROM recipe_book_items i WHERE i.book_id = b.id) AS n
       FROM recipe_books b JOIN users u ON u.id = b.owner_id WHERE b.id = ? AND b.visibility = 'public'`,
      m[1],
    );
    if (!b) return null;
    return {
      ...base,
      title: `${b.emoji} ${b.name} — a recipe book on foodi`,
      description: clip(`${b.description || 'A recipe book'} · ${b.n} ${b.n === 1 ? 'recipe' : 'recipes'}, by ${b.display_name ?? `@${b.handle}`}.`, 200),
      url: `${origin}/app/books/${b.id}`,
      type: 'article',
    };
  }

  if ((m = /^\/app\/blog\/([\w-]+)\/?$/.exec(path))) {
    const p = one<{ id: string; title: string; body: string; display_name: string | null; handle: string; cover: string | null; ext: string | null }>(
      db,
      `SELECT p.id, p.title, p.body, u.display_name, u.handle, m.id AS cover, m.ext
       FROM blog_posts p JOIN users u ON u.id = p.author_id LEFT JOIN media m ON m.id = p.cover_media_id
       WHERE p.id = ? AND p.status = 'published'`,
      m[1],
    );
    if (!p) return null;
    return {
      ...base,
      title: `${p.title} — foodi blog`,
      description: clip(`${p.body.replace(/[#*_`>[\]()!-]/g, ' ')} — by ${p.display_name ?? `@${p.handle}`}`, 200),
      image: p.cover ? `${origin}/share/blog/${p.id}/cover.${p.ext}` : base.image,
      imageAlt: p.cover ? `Cover photo for ${p.title}` : base.imageAlt,
      url: `${origin}/app/blog/${p.id}`,
      type: 'article',
    };
  }

  if ((m = /^\/app\/shop\/([\w-]+)\/?$/.exec(path))) {
    const l = one<{ id: string; title: string; description: string; price_cents: number; currency: string; display_name: string | null; handle: string; cover: string | null; ext: string | null }>(
      db,
      `SELECT l.id, l.title, l.description, l.price_cents, l.currency, u.display_name, u.handle, m.id AS cover, m.ext
       FROM shop_listings l JOIN users u ON u.id = l.seller_id
       LEFT JOIN media m ON m.listing_id = l.id AND m.kind = 'image'
       WHERE l.id = ? AND l.status IN ('approved','sold_out') ORDER BY m.position LIMIT 1`,
      m[1],
    );
    if (!l) return null;
    return {
      ...base,
      title: `${l.title} · ${formatMoney(l.price_cents, l.currency)} — foodi shop`,
      description: clip(`${l.description} — sold by ${l.display_name ?? `@${l.handle}`}.`, 200),
      image: l.cover ? `${origin}/share/shop/${l.id}/cover.${l.ext}` : base.image,
      imageAlt: l.cover ? `Photo of ${l.title}` : base.imageAlt,
      url: `${origin}/app/shop/${l.id}`,
      type: 'article',
    };
  }

  return null;
}

/**
 * Anonymous image endpoints for link previews (unfurlers don't sign in), and robots/sitemap.
 * Only images attached to public things are served; the path carries the extension so the
 * previewer can tell the type from the URL alone.
 */
export function shareRoutes(db: Db, store: MediaStore) {
  const r = Router();

  function send(res: import('express').Response, m: MediaRow | undefined) {
    if (!m) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const path = store.pathFor(m);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.setHeader('content-type', m.mime);
    res.setHeader('content-length', size);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'public, max-age=86400');
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    createReadStream(path).pipe(res);
  }

  /** A taste of the house kitchen for the landing page: public house recipes that have a photo. */
  r.get('/featured.json', (_req, res) => {
    const rows = all<{ id: string; title: string; content: string; ext: string }>(
      db,
      `SELECT r.id, r.title, r.content, m.ext FROM recipes r
       JOIN users u ON u.id = r.user_id AND u.is_system = 1
       JOIN media m ON m.recipe_id = r.id AND m.kind = 'image'
       WHERE r.visibility = 'public' AND m.position = (SELECT MIN(position) FROM media WHERE recipe_id = r.id AND kind = 'image')
       ORDER BY r.created_at DESC LIMIT 8`,
    );
    const total = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM recipes r JOIN users u ON u.id = r.user_id AND u.is_system = 1 WHERE r.visibility = 'public'`)!.n;
    res.setHeader('cache-control', 'public, max-age=300');
    res.json({
      total,
      recipes: rows.map((x) => {
        const c = JSON.parse(x.content) as { emoji?: string; totalMinutes?: number; mealType?: string; cuisine?: string | null };
        return { id: x.id, title: x.title, emoji: c.emoji ?? '🍽️', totalMinutes: c.totalMinutes ?? null, cuisine: c.cuisine ?? null, cover: `/share/recipes/${x.id}/cover.${x.ext}` };
      }),
    });
  });

  r.get('/recipes/:id/cover.:ext', (req, res) => send(res, publicCover(db, req.params['id']!)));
  r.get('/blog/:id/cover.:ext', (req, res) =>
    send(res, one<MediaRow>(db, `SELECT m.* FROM media m JOIN blog_posts p ON p.cover_media_id = m.id WHERE p.id = ? AND p.status = 'published'`, req.params['id']!)),
  );
  r.get('/shop/:id/cover.:ext', (req, res) =>
    send(
      res,
      one<MediaRow>(db, `SELECT m.* FROM media m JOIN shop_listings l ON l.id = m.listing_id WHERE l.id = ? AND m.kind = 'image' AND l.status IN ('approved','sold_out') ORDER BY m.position LIMIT 1`, req.params['id']!),
    ),
  );

  return r;
}

export function robotsTxt(origin: string): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /admin', 'Disallow: /app/settings', 'Disallow: /onboarding', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}

/** Every public page, newest first, capped so the file stays small. */
export function sitemapXml(db: Db, origin: string): string {
  const urls: { loc: string; lastmod?: string }[] = [{ loc: `${origin}/` }, { loc: `${origin}/browse` }];
  for (const x of all<{ id: string; updated_at: string }>(db, `SELECT id, updated_at FROM recipes WHERE visibility = 'public' ORDER BY updated_at DESC LIMIT 2000`)) urls.push({ loc: `${origin}/browse/${x.id}`, lastmod: x.updated_at });
  for (const x of all<{ handle: string }>(db, `SELECT handle FROM users WHERE disabled_at IS NULL AND EXISTS (SELECT 1 FROM recipes r WHERE r.user_id = users.id AND r.visibility = 'public') LIMIT 1000`)) urls.push({ loc: `${origin}/app/u/${x.handle}` });
  for (const x of all<{ id: string; updated_at: string }>(db, `SELECT id, updated_at FROM recipe_books WHERE visibility = 'public' ORDER BY updated_at DESC LIMIT 1000`)) urls.push({ loc: `${origin}/app/books/${x.id}`, lastmod: x.updated_at });
  for (const x of all<{ id: string; updated_at: string }>(db, `SELECT id, updated_at FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 1000`)) urls.push({ loc: `${origin}/app/blog/${x.id}`, lastmod: x.updated_at });
  for (const x of all<{ id: string }>(db, `SELECT id FROM shop_listings WHERE status IN ('approved','sold_out') ORDER BY created_at DESC LIMIT 1000`)) urls.push({ loc: `${origin}/app/shop/${x.id}` });
  const body = urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod.slice(0, 10))}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
