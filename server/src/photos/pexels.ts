import type { PhotoSource } from './types.js';

const API = 'https://api.pexels.com/v1/search';
export const PEXELS_FILE_HOST = 'images.pexels.com';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  alt?: string;
  src: { large2x: string; large: string };
}

/**
 * Pexels: much better food photography than Commons, but needs a (free) API key. Photos are
 * free to use; Pexels asks for a credit where practical, which the caption gives.
 */
export function createPexelsSource(apiKey: string, fetchImpl: typeof fetch = fetch): PhotoSource {
  return {
    id: 'pexels',
    async search(query, limit) {
      const params = new URLSearchParams({
        query,
        per_page: String(Math.min(limit, 30)),
        orientation: 'landscape',
      });
      const res = await fetchImpl(`${API}?${params}`, {
        headers: { authorization: apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Pexels search failed (${res.status})`);
      const body = (await res.json()) as { photos?: PexelsPhoto[] };
      return (body.photos ?? [])
        .filter((p) => new URL(p.src.large2x).hostname === PEXELS_FILE_HOST)
        .slice(0, limit)
        .map((p) => ({
          provider: 'pexels' as const,
          url: p.src.large2x,
          width: p.width,
          height: p.height,
          credit: p.photographer.slice(0, 80),
          license: 'Pexels',
          sourceUrl: p.url,
          ...(p.alt ? { title: p.alt } : {}),
        }));
    },
  };
}
