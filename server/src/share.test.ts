import { describe, expect, it } from 'vitest';
import { defaultTags, renderShareHtml, robotsTxt, SHARE_END, SHARE_START, shareBlock } from './share.js';

const INDEX = `<!doctype html><html><head><meta charset="utf-8" />\n    ${SHARE_START}\n    <title>old</title>\n    ${SHARE_END}\n    <link rel="icon" href="/favicon.svg" /></head><body></body></html>`;

describe('share tags', () => {
  it('swaps the block between the markers and escapes attribute text', () => {
    const html = renderShareHtml(INDEX, { ...defaultTags('https://foodi.example'), title: 'Tom & "Jerry" <3', description: 'x', url: 'https://foodi.example/app/recipes/r1' });
    expect(html).not.toContain('<title>old</title>');
    expect(html).toContain('<title>Tom &amp; &quot;Jerry&quot; &lt;3</title>');
    expect(html).toContain('<meta property="og:url" content="https://foodi.example/app/recipes/r1" />');
    expect(html).toContain('<meta property="og:image" content="https://foodi.example/og.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    // The rest of the head is untouched.
    expect(html).toContain('<link rel="icon" href="/favicon.svg" />');
  });

  it('leaves a file without markers alone', () => {
    expect(renderShareHtml('<html><head><title>x</title></head></html>', defaultTags('https://a'))).toBe('<html><head><title>x</title></head></html>');
  });

  it('writes one line per tag and keeps the markers for the next swap', () => {
    const block = shareBlock(defaultTags('https://a'));
    expect(block.startsWith(SHARE_START)).toBe(true);
    expect(block.endsWith(SHARE_END)).toBe(true);
    expect(block.match(/<meta /g)).toHaveLength(13);
  });

  it('robots keeps crawlers out of the API and private areas and points at the sitemap', () => {
    const txt = robotsTxt('https://a');
    expect(txt).toContain('Disallow: /api/');
    expect(txt).toContain('Disallow: /admin');
    expect(txt).toContain('Sitemap: https://a/sitemap.xml');
  });
});
