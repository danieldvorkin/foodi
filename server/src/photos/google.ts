import type { PhotoCandidate, PhotoSource } from './types.js';

const API = 'https://www.googleapis.com/customsearch/v1';

interface Item {
  title: string;
  link: string;
  displayLink: string;
  mime?: string;
  image?: { contextLink: string; width: number; height: number };
}

/**
 * Google Images through the Custom Search JSON API (a key plus a search-engine id with image
 * search on). Results come from anywhere on the web, so this source is opt-in: the credit names
 * the site and links to the page, and the search is limited to photos ≥ 800px marked as
 * reusable where Google knows the licence.
 */
export function createGoogleSource(apiKey: string, cx: string, fetchImpl: typeof fetch = fetch): PhotoSource {
  return {
    id: 'google',
    async search(query, limit) {
      const params = new URLSearchParams({
        key: apiKey,
        cx,
        q: `${query} food`,
        searchType: 'image',
        imgType: 'photo',
        imgSize: 'large',
        safe: 'active',
        num: String(Math.min(limit, 10)),
        fileType: 'jpg,png',
        rights: 'cc_publicdomain,cc_attribute,cc_sharealike,cc_noncommercial,cc_nonderived',
      });
      const res = await fetchImpl(`${API}?${params}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Google search failed (${res.status})`);
      const body = (await res.json()) as { items?: Item[] };
      const out: PhotoCandidate[] = [];
      for (const it of body.items ?? []) {
        if (!it.image || !it.link.startsWith('https://')) continue;
        if (it.image.width < 800 || it.image.height < 500) continue;
        if (it.mime && it.mime !== 'image/jpeg' && it.mime !== 'image/png') continue;
        out.push({
          provider: 'google',
          url: it.link,
          width: it.image.width,
          height: it.image.height,
          credit: it.displayLink.slice(0, 80),
          license: 'Reusable (Google)',
          sourceUrl: it.image.contextLink,
          title: it.title,
        });
      }
      return out;
    },
  };
}
