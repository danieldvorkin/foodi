import { describe, expect, it } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { encodePng } from '../lib/png.js';
import { createPhotoFinder, photoQueries, rankByTitle } from './finder.js';
import { createGoogleSource } from './google.js';
import { createPexelsSource } from './pexels.js';
import { createWikimediaSource } from './wikimedia.js';

const log = createLogger('silent', false);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('photo queries', () => {
  it('cuts the title down to the dish, then its last words, then the main ingredient', () => {
    const qs = photoQueries({
      title: 'Bright Lemon Garlic Roast Chicken with Herbs (weeknight)',
      cuisine: 'French',
      tags: ['dinner', 'comfort'],
      ingredients: [{ item: 'chicken thighs' }, { item: 'lemon' }],
    });
    expect(qs).toEqual([
      'Lemon Garlic Roast Chicken',
      'Roast Chicken',
      'Chicken dish',
      'chicken thighs French dish',
    ]);
    // "&" inside a dish name is kept; "with …" is dropped; single words get "dish".
    expect(
      photoQueries({
        title: 'Crispy white bean & lemon-herb chickpea cakes with basil sauce',
        cuisine: null,
        tags: [],
        ingredients: [],
      }),
    ).toEqual(['white bean lemon-herb chickpea cakes', 'chickpea cakes', 'cakes dish']);
    expect(photoQueries({ title: 'Shakshuka', cuisine: null, tags: [], ingredients: [] })).toEqual([
      'Shakshuka dish',
    ]);
  });

  it('ranks hits whose title names the dish ahead of the library order', () => {
    const ranked = rankByTitle(
      [
        { title: 'Red Lion pub, Highgate' },
        { title: 'Lemon & Garlic Roasted Chicken' },
        { title: 'Chicken dinner' },
      ],
      'Lemon Garlic Roast Chicken',
    );
    expect(ranked.map((h) => h.title)).toEqual([
      'Lemon & Garlic Roasted Chicken',
      'Chicken dinner',
      'Red Lion pub, Highgate',
    ]);
  });
});

describe('wikimedia source', () => {
  it('keeps big, licensed JPEG/PNG photos that are categorised as food; drops diagrams, scans, unlicensed and off-host files; credits the author', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse({
        query: {
          pages: [
            {
              title: 'File:Shakshuka plated.jpg',
              imageinfo: [
                {
                  url: 'https://upload.wikimedia.org/a.jpg',
                  thumburl: 'https://thumb.wikimedia.org/thumb/a.jpg',
                  thumbwidth: 1280,
                  thumbheight: 853,
                  width: 4000,
                  height: 2667,
                  mime: 'image/jpeg',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Shakshuka_plated.jpg',
                  extmetadata: {
                    Artist: { value: '<a href="/wiki/User:Jane">Jane &amp; Doe</a>' },
                    LicenseShortName: { value: 'CC BY-SA 4.0' },
                    Categories: { value: 'Shakshuka|Egg dishes' },
                  },
                },
              ],
            },
            {
              title: 'File:Shakshuka diagram.png',
              imageinfo: [
                {
                  url: 'https://upload.wikimedia.org/d.png',
                  width: 2000,
                  height: 2000,
                  mime: 'image/png',
                  descriptionurl: 'x',
                  extmetadata: {
                    LicenseShortName: { value: 'CC0' },
                    Categories: { value: 'Food' },
                  },
                },
              ],
            },
            {
              title: 'File:Everything for the garden.jpg',
              imageinfo: [
                {
                  url: 'https://upload.wikimedia.org/g.jpg',
                  width: 2000,
                  height: 2600,
                  mime: 'image/jpeg',
                  descriptionurl: 'x',
                  extmetadata: {
                    LicenseShortName: { value: 'Public domain' },
                    Categories: { value: 'Seed trade catalogs|Basil|Food' },
                  },
                },
              ],
            },
            {
              title: 'File:Red Lion pub.jpg',
              imageinfo: [
                {
                  url: 'https://upload.wikimedia.org/p.jpg',
                  width: 2000,
                  height: 2000,
                  mime: 'image/jpeg',
                  descriptionurl: 'x',
                  extmetadata: {
                    LicenseShortName: { value: 'CC0' },
                    Categories: { value: 'Pubs in Highgate' },
                  },
                },
              ],
            },
            {
              title: 'File:Tiny.jpg',
              imageinfo: [
                {
                  url: 'https://upload.wikimedia.org/t.jpg',
                  width: 300,
                  height: 200,
                  mime: 'image/jpeg',
                  descriptionurl: 'x',
                  extmetadata: {
                    LicenseShortName: { value: 'CC0' },
                    Categories: { value: 'Food' },
                  },
                },
              ],
            },
            {
              title: 'File:Unlicensed.jpg',
              imageinfo: [
                {
                  url: 'https://upload.wikimedia.org/u.jpg',
                  width: 3000,
                  height: 2000,
                  mime: 'image/jpeg',
                  descriptionurl: 'x',
                  extmetadata: { Categories: { value: 'Food' } },
                },
              ],
            },
            {
              title: 'File:Elsewhere.jpg',
              imageinfo: [
                {
                  url: 'https://evil.example/e.jpg',
                  width: 3000,
                  height: 2000,
                  mime: 'image/jpeg',
                  descriptionurl: 'x',
                  extmetadata: {
                    LicenseShortName: { value: 'CC0' },
                    Categories: { value: 'Food' },
                  },
                },
              ],
            },
          ],
        },
      });
    };
    const hits = await createWikimediaSource(fetchImpl).search('shakshuka', 5);
    expect(hits).toEqual([
      {
        provider: 'wikimedia',
        url: 'https://thumb.wikimedia.org/thumb/a.jpg',
        width: 1280,
        height: 853,
        credit: 'Jane & Doe',
        license: 'CC BY-SA 4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Shakshuka_plated.jpg',
        title: 'Shakshuka plated',
      },
    ]);
    expect(calls[0]).toContain('gsrsearch=shakshuka+filetype%3Abitmap');
  });
});

describe('pexels source', () => {
  it('maps photos with a photographer credit and only trusts the Pexels image host', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      expect((init?.headers as Record<string, string>)['authorization']).toBe('key-123');
      return jsonResponse({
        photos: [
          {
            id: 1,
            width: 4000,
            height: 3000,
            url: 'https://www.pexels.com/photo/1/',
            photographer: 'Sam Cook',
            src: { large2x: 'https://images.pexels.com/photos/1/x.jpeg', large: '' },
          },
          {
            id: 2,
            width: 4000,
            height: 3000,
            url: 'x',
            photographer: 'Nope',
            src: { large2x: 'https://elsewhere.example/2.jpeg', large: '' },
          },
        ],
      });
    };
    const hits = await createPexelsSource('key-123', fetchImpl).search('shakshuka', 5);
    expect(hits).toEqual([
      {
        provider: 'pexels',
        url: 'https://images.pexels.com/photos/1/x.jpeg',
        width: 4000,
        height: 3000,
        credit: 'Sam Cook',
        license: 'Pexels',
        sourceUrl: 'https://www.pexels.com/photo/1/',
      },
    ]);
  });
});

describe('photo finder', () => {
  const png = encodePng(8, 8, () => [200, 120, 80]);
  const candidate = (n: number) => ({
    provider: 'wikimedia' as const,
    url: `https://upload.wikimedia.org/p${n}.png`,
    width: 1000,
    height: 800,
    credit: 'A',
    license: 'CC0',
    sourceUrl: `https://commons.wikimedia.org/wiki/File:P${n}.png`,
  });

  it('skips photos a recipe has already seen and moves to broader queries', async () => {
    const seenQueries: string[] = [];
    const source = {
      id: 'wikimedia' as const,
      search: async (q: string) => (
        seenQueries.push(q),
        q === 'Roast Chicken' ? [candidate(1), candidate(2)] : []
      ),
    };
    const finder = createPhotoFinder({ sources: [source], log });
    const subject = {
      title: 'Lemon Garlic Roast Chicken',
      cuisine: null,
      tags: [],
      ingredients: [],
    };
    expect((await finder.find(subject, new Set()))?.sourceUrl).toBe(candidate(1).sourceUrl);
    expect((await finder.find(subject, new Set([candidate(1).sourceUrl])))?.sourceUrl).toBe(
      candidate(2).sourceUrl,
    );
    expect(
      await finder.find(subject, new Set([candidate(1).sourceUrl, candidate(2).sourceUrl])),
    ).toBeNull();
    expect(seenQueries[0]).toBe('Lemon Garlic Roast Chicken');
  });

  it('downloads only from allowed hosts and only real images', async () => {
    const fetchImpl: typeof fetch = async (input) =>
      new Response(String(input).endsWith('text.png') ? 'not an image' : new Uint8Array(png), {
        status: 200,
      });
    const finder = createPhotoFinder({ sources: [], fetchImpl, log });
    const ok = await finder.download(candidate(1));
    expect(ok.mime).toBe('image/png');
    await expect(
      finder.download({ ...candidate(2), url: 'https://evil.example/p.png' }),
    ).rejects.toMatchObject({ code: 'download_failed' });
    await expect(
      finder.download({ ...candidate(3), url: 'http://upload.wikimedia.org/p.png' }),
    ).rejects.toMatchObject({ code: 'download_failed' });
    await expect(
      finder.download({ ...candidate(4), url: 'https://upload.wikimedia.org/text.png' }),
    ).rejects.toMatchObject({ code: 'bad_image' });
  });
});

describe('google source', () => {
  it('asks for large reusable food photos and keeps only https JPEG/PNG hits', async () => {
    let url = '';
    const fetchImpl: typeof fetch = async (input) => {
      url = String(input);
      return jsonResponse({
        items: [
          { title: 'Shakshuka in a pan', link: 'https://example.com/a.jpg', displayLink: 'example.com', mime: 'image/jpeg', image: { contextLink: 'https://example.com/post', width: 1600, height: 1200 } },
          { title: 'Small', link: 'https://example.com/s.jpg', displayLink: 'example.com', mime: 'image/jpeg', image: { contextLink: 'x', width: 300, height: 200 } },
          { title: 'Plain http', link: 'http://example.com/h.jpg', displayLink: 'example.com', mime: 'image/jpeg', image: { contextLink: 'x', width: 1600, height: 1200 } },
          { title: 'Gif', link: 'https://example.com/g.gif', displayLink: 'example.com', mime: 'image/gif', image: { contextLink: 'x', width: 1600, height: 1200 } },
        ],
      });
    };
    const hits = await createGoogleSource('k', 'cx', fetchImpl).search('shakshuka', 5);
    expect(hits).toEqual([{ provider: 'google', url: 'https://example.com/a.jpg', width: 1600, height: 1200, credit: 'example.com', license: 'Reusable (Google)', sourceUrl: 'https://example.com/post', title: 'Shakshuka in a pan' }]);
    expect(url).toContain('searchType=image');
    expect(url).toContain('q=shakshuka+food');
    expect(url).toContain('rights=');
  });
});
