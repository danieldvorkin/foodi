# Marketing assets

Everything here is safe to attach when sharing foodi. Screens show the seeded house kitchen and
the mock personas, so nothing personal is in them.

| File | What | Size |
| --- | --- | --- |
| `og.png` | The share card behind every pasted link (also `client/public/og.png`). Rendered from `og-card.html`. | 1512×794 |
| `feed-desktop.jpg` | The feed on a laptop: composer, a shared recipe with its photo, people to follow, blog. | 1400×854 |
| `cook-phone.jpg` | Cook mode on a phone: one step, the ingredients it needs, a timer. | 768×1496 |
| `recipe-phone.jpg` | A recipe page on a phone with its library photo and attribution. | 768×1496 |
| `../banner.svg` | The README banner. | vector |
| `../../client/public/favicon.svg` | The mark. `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` are drawn from it by `scripts/icons.ts`. | vector / PNG |

## Regenerating

- **Share card**: open `og-card.html` in a browser at 1200×630 (it loads Bricolage Grotesque from
  `node_modules`), screenshot the page, save as `client/public/og.png` and copy here.
- **Screens**: run the app, sign in as the mock admin, and capture `/cook/<id>` at 390×760,
  `/app/recipes/<id>` at 390×760 and `/app` at 1180×720 (light scheme). Save as JPEG ~80 quality
  into `client/public/marketing/` and copy here.
- **Icons**: `npx tsx scripts/icons.ts`.

## Link previews

`server/src/share.ts` swaps the `<!-- share:start -->…<!-- share:end -->` block of `index.html`
per request in production, so a public recipe, person, book, blog post or shop listing unfurls
with its own title, description and photo (`/share/…/cover.jpg`, no sign-in needed). Everything
else gets the site card. Check a link with https://opengraph.xyz or the Facebook Sharing Debugger.
