# foodi — design notes

Working notes for the visual system. Kept short on purpose; the code is the source of truth.

## Subject

Guided cooking. The person has already decided they want help in the kitchen; the app's
one job is to get them from "what should I cook?" to "cooking, step by step, right now",
using the AI account they already pay for.

The most characteristic thing in this world is **a single step, read from across the
counter, with a timer running**. That is the hero on the landing page and the whole
screen in cook mode.

## Tokens

Color

Brief from the client: neutral, very easy to look at. So: no saturated surfaces, low-glare
grounds, one muted accent, and a dark scheme that is just as quiet.

| name    | light     | dark      | job                                              |
|---------|-----------|-----------|--------------------------------------------------|
| ground  | `#FAFAF8` | `#1C1B19` | page background                                  |
| plate   | `#FFFFFF` | `#242320` | raised surfaces (cards, inputs, sheets)          |
| flour   | `#F2F1ED` | `#2C2B27` | quiet secondary surface (stripes, chips)         |
| line    | `#E3E1DA` | `#3A3833` | 1px rules                                        |
| ink     | `#2A2926` | `#ECEAE4` | text                                             |
| stone   | `#6F6C66` | `#A29F97` | secondary text                                   |
| sage    | `#5A6B4B` | `#8FA57C` | the one accent: primary actions, running timers  |
| clay    | `#B4432A` | `#D9775F` | allergen warnings, destructive actions (only red)|

Type — one family: **Bricolage Grotesque** (variable: opsz, wdth, wght), self-hosted.
Display: high opsz, wght 600 (never heavier — keeps it calm), tight leading.
Body: opsz 12–14, wght 400, 1.5–1.6 leading.
Timer digits: wdth 80, tabular numerals. No monospace anywhere.

Scale (base 16, ~1.25): 13 / 16 / 20 / 25 / 31 / 39 / 49 / 61 / 76.

Layout — left aligned everywhere. Prose columns ≤ 68ch. App shell is a thin top bar.
Admin is a 232px left rail + full-width tables. Cook mode is full-bleed ground with
the largest type in the app; it follows the same light/dark scheme as everything else.

## Principles

1. The step is the hero. Big, glanceable, one thing at a time. Low contrast everywhere else.
2. Sage is for things you can do or that are happening. If it appears more than twice
   on a screen, cut one. Nothing else is colored.
3. Numbers only where there is a sequence (recipe steps, onboarding progress). Nowhere else.
4. Borders are information: 1px ink rules separate ingredients, steps, table rows. No shadows.
5. Motion answers the person: step change, timer start, chip toggle. The only ambient
   motion is the hero demo ticking. `prefers-reduced-motion` turns it off.
6. Sentence case. Buttons say what happens ("Save answers", "Start cooking").
7. Errors say what went wrong and what to do next. Empty screens invite an action.

## Rejected on review (looked like the default)

- Cream page + terracotta accent → replaced with a near-white ground and one sage accent.
- A full-bleed yellow hero (first draft) → dropped after the client asked for neutral;
  the hero is now the live step card alone on a quiet ground.
- Uppercase eyebrow labels above headings → removed; headings stand alone.
- Card grid with identical radius/shadow for recipes → a ruled list with a plain time column.
- Monospace for timer/meta → Bricolage condensed with tabular figures.
- Admin "stat cards" → one ruled row of numbers, and a hand-drawn SVG sparkline.
