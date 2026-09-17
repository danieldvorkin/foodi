import type { Logger } from '../lib/logger.js';
import { sniffMedia } from '../lib/media-scrub.js';
import { PEXELS_FILE_HOST } from './pexels.js';
import { PhotoError, type PhotoCandidate, type PhotoSource } from './types.js';
import { WIKIMEDIA_FILE_HOSTS } from './wikimedia.js';

/**
 * Library candidates may only be downloaded from their library's file host, whatever a search
 * response claims. Google results are arbitrary web hosts, so they are checked for a public
 * https host instead (never a private or loopback address).
 */
const DOWNLOAD_HOSTS = new Set<string>([...WIKIMEDIA_FILE_HOSTS, PEXELS_FILE_HOST]);
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[|::1)|^172\.(1[6-9]|2\d|3[01])\./i;
function allowedHost(c: PhotoCandidate): boolean {
  const u = new URL(c.url);
  if (u.protocol !== 'https:') return false;
  if (c.provider === 'google') return !PRIVATE_HOST.test(u.hostname) && u.hostname.includes('.');
  return DOWNLOAD_HOSTS.has(u.hostname);
}
const MAX_DOWNLOAD = 8 * 1024 * 1024;

/** Marketing adjectives and dietary qualifiers: rarely in a photo's title, and "dairy" finds cows. */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'for',
  'to',
  'my',
  'our',
  'your',
  'style',
  'easy',
  'quick',
  'simple',
  'classic',
  'best',
  'homemade',
  'weeknight',
  'perfect',
  'ultimate',
  'crispy',
  'creamy',
  'spicy',
  'zesty',
  'bright',
  'hearty',
  'cozy',
  'fresh',
  'golden',
  'smoky',
  'sticky',
  'silky',
  'loaded',
  'one-pan',
  'one-pot',
  'sheet-pan',
  'skillet',
  'minute',
  'healthy',
  'light',
  'rich',
  'tangy',
  'crunchy',
  'warm',
  'cold',
  'summer',
  'winter',
  'dairy-free',
  'gluten-free',
  'nut-free',
  'egg-free',
  'soy-free',
  'sugar-free',
  'grain-free',
  'low-carb',
  'keto',
  'paleo',
  'vegan',
  'vegetarian',
  'plant-based',
  'high-protein',
  'protein-packed',
  'lightened-up',
  'skinny',
  'guilt-free',
  'allergy-friendly',
]);
/** "X with Y", "X over Y", "X, served with Y": the dish is X. */
const TAIL = /\s+(with|over|on|in|served|topped|alongside|plus)\s+|,|\s+-\s+|\s+–\s+/i;

export interface PhotoSubject {
  title: string;
  cuisine: string | null;
  tags: string[];
  ingredients: { item: string }[];
}

/**
 * Search phrases from most to least specific. Long generated titles ("Bright Lemon Garlic
 * Roast Chicken with Herbs") rarely match a stock library word for word, so we cut the title
 * down to the dish itself, then its last two words, and finally the main ingredient.
 */
export function photoQueries(s: PhotoSubject): string[] {
  const clean = (t: string) =>
    t
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const head = clean(s.title.split(TAIL)[0] ?? s.title);
  const words = head.split(' ').filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  const out: string[] = [];
  const push = (q: string) => {
    q = q.trim();
    if (q && !out.some((x) => x.toLowerCase() === q.toLowerCase())) out.push(q);
  };
  // One-word queries ("salmon", "bean") pull in plants and animals; "dish" keeps them on the plate.
  if (words.length > 1) push(words.join(' '));
  if (words.length > 2) push(words.slice(-2).join(' '));
  if (words.length) push(`${words[words.length - 1]!} dish`);
  const main = s.ingredients[0]?.item ? clean(s.ingredients[0].item) : '';
  if (main) push(`${main} ${s.cuisine ? clean(s.cuisine) + ' ' : ''}dish`);
  return out.slice(0, 4);
}

/** Hits whose own title names more of the query come first; the library's order breaks ties. */
export function rankByTitle<T extends { title?: string }>(hits: T[], query: string): T[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w !== 'dish');
  const score = (h: T) => {
    const t = (h.title ?? '').toLowerCase().replace(/[_-]/g, ' ');
    return terms.filter((w) => t.includes(w)).length;
  };
  return hits
    .map((h, i) => ({ h, i, s: score(h) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.h);
}

export function createPhotoFinder(deps: {
  sources: PhotoSource[];
  fetchImpl?: typeof fetch;
  log: Logger;
}) {
  const fetchImpl = deps.fetchImpl ?? fetch;

  /**
   * Up to `n` fresh photos for a recipe (none in `seen`, the source pages already tried), taken
   * from the most specific query that has any, then broader ones. A source that errors is
   * skipped, not fatal.
   */
  async function findMany(
    subject: PhotoSubject,
    seen: Set<string>,
    n: number,
  ): Promise<PhotoCandidate[]> {
    const out: PhotoCandidate[] = [];
    const have = new Set(seen);
    for (const query of photoQueries(subject)) {
      for (const source of deps.sources) {
        let hits: PhotoCandidate[];
        try {
          hits = await source.search(query, 12);
        } catch (err) {
          deps.log.warn({ err, source: source.id, query }, 'photo search failed');
          continue;
        }
        for (const h of rankByTitle(hits, query)) {
          if (have.has(h.sourceUrl)) continue;
          have.add(h.sourceUrl);
          out.push(h);
          if (out.length >= n) return out;
        }
      }
      if (out.length) return out; // don't mix a broad query's hits into a specific one's
    }
    return out;
  }

  /** The single next photo (see findMany). */
  async function find(subject: PhotoSubject, seen: Set<string>): Promise<PhotoCandidate | null> {
    return (await findMany(subject, seen, 1))[0] ?? null;
  }

  /** Fetch the bytes, refusing anything off the allowlist, oversized, or not a JPEG/PNG. */
  async function download(
    c: PhotoCandidate,
  ): Promise<{ bytes: Buffer; mime: string; ext: string }> {
    if (!allowedHost(c)) throw new PhotoError('download_failed', 'That photo host is not allowed.');
    let res: Response;
    try {
      res = await fetchImpl(c.url, {
        headers: { 'user-agent': 'foodi/1.0 (https://foodi.fly.dev)' },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    } catch {
      throw new PhotoError('download_failed', 'The photo could not be downloaded.');
    }
    if (!res.ok)
      throw new PhotoError('download_failed', `The photo could not be downloaded (${res.status}).`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_DOWNLOAD) throw new PhotoError('download_failed', 'The photo is too large.');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD)
      throw new PhotoError('download_failed', 'The photo is too large.');
    const sniffed = sniffMedia(bytes);
    if (!sniffed || (sniffed.mime !== 'image/jpeg' && sniffed.mime !== 'image/png'))
      throw new PhotoError('bad_image', 'That file is not a JPEG or PNG.');
    return { bytes, mime: sniffed.mime, ext: sniffed.ext };
  }

  return { find, findMany, download, sources: deps.sources };
}

export type PhotoFinder = ReturnType<typeof createPhotoFinder>;
