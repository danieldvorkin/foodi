import type { PhotoCandidate, PhotoSource } from './types.js';

const API = 'https://commons.wikimedia.org/w/api.php';
/** Originals come from upload.wikimedia.org; the sized thumbnails we prefer from thumb.wikimedia.org. */
export const WIKIMEDIA_FILE_HOSTS = ['upload.wikimedia.org', 'thumb.wikimedia.org'] as const;
/** Commons asks API users to identify themselves; anonymous UAs get throttled. */
export const USER_AGENT = 'foodi/1.0 (https://foodi.fly.dev; recipe cover photos)';

/** Something on the page must say it is food: Commons files are categorised well enough for this. */
const FOOD_SIGNAL =
  /\b(food|foods|dish|dishes|cuisine|cuisines|meal|meals|cooking|cooked|recipe|breakfast|brunch|lunch|dinner|supper|dessert|desserts|soup|soups|salad|salads|bread|breads|cake|cakes|pastry|pastries|curry|curries|sandwich|sandwiches|pasta|noodle|noodles|rice|pizza|taco|tacos|burger|burgers|sushi|stew|stews|grilled|roast|roasted|baked|fried|snack|snacks|cheese|meat|seafood|fish dishes|vegetable dishes|fruit dishes|street food|restaurant|plated|plate of|bowl of|dumpling|dumplings|kebab|casserole|pie|pies|sauce|sauces|eggs|egg dishes|chicken dishes|beef dishes|pork dishes|lamb dishes|tofu|vegan|vegetarian)\b/i;
/** Titles and categories that are almost never a plate of food: scans, art, packaging, maps. */
const NOT_A_PHOTO =
  /\b(logo|icon|map|diagram|chart|drawing|illustration|painting|engraving|lithograph|menu|label|packag|poster|sign|screenshot|flag|coat of arms|stamp|coin|banknote|catalog|catalogue|book|page|scan|manuscript|document|advertis|herbarium|seed trade|botanical|plate \d|cartoon|sculpture|statue)\b/i;

interface Page {
  title: string;
  imageinfo?: {
    url: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    width: number;
    height: number;
    mime: string;
    descriptionurl: string;
    extmetadata?: Record<string, { value: string }>;
  }[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#'
        ? String.fromCodePoint(
            parseInt(
              e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1),
              e[1] === 'x' || e[1] === 'X' ? 16 : 10,
            ),
          )
        : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();
}
/** Keep a credit readable: whole words, with an ellipsis when it has to be cut. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 24))}…`;
}

/**
 * Wikimedia Commons: free-licensed photos, no API key. Results are ordered by relevance, so
 * short, concrete queries ("shakshuka") do far better than long generated titles.
 */
export function createWikimediaSource(fetchImpl: typeof fetch = fetch): PhotoSource {
  return {
    id: 'wikimedia',
    async search(query, limit) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        generator: 'search',
        gsrsearch: `${query} filetype:bitmap`,
        gsrnamespace: '6',
        gsrlimit: String(Math.min(limit * 2, 30)),
        prop: 'imageinfo',
        iiprop: 'url|mime|size|extmetadata',
        iiurlwidth: '1280',
        iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|Credit|Categories',
      });
      const res = await fetchImpl(`${API}?${params}`, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Wikimedia search failed (${res.status})`);
      const body = (await res.json()) as { query?: { pages?: Page[] } };
      const out: PhotoCandidate[] = [];
      for (const page of body.query?.pages ?? []) {
        const info = page.imageinfo?.[0];
        if (!info) continue;
        if (info.mime !== 'image/jpeg' && info.mime !== 'image/png') continue;
        if (info.width < 700 || info.height < 500) continue;
        if (NOT_A_PHOTO.test(page.title)) continue;
        const url = info.thumburl ?? info.url;
        if (!(WIKIMEDIA_FILE_HOSTS as readonly string[]).includes(new URL(url).hostname)) continue;
        const meta = info.extmetadata ?? {};
        const categories = meta['Categories']?.value ?? '';
        if (NOT_A_PHOTO.test(categories)) continue;
        if (!FOOD_SIGNAL.test(`${page.title} ${categories}`)) continue;
        const license = stripTags(meta['LicenseShortName']?.value ?? '');
        if (!license) continue; // no licence recorded → not safe to reuse
        const credit = shorten(
          stripTags(meta['Artist']?.value ?? meta['Credit']?.value ?? '') || 'Wikimedia Commons',
          80,
        );
        out.push({
          provider: 'wikimedia',
          url,
          width: info.thumbwidth ?? info.width,
          height: info.thumbheight ?? info.height,
          credit,
          license: license.slice(0, 40),
          sourceUrl: info.descriptionurl,
          title: page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
        });
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}
