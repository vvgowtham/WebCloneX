# WebClonerELX — any website → Elementor JSON

Clone any public website into a section-by-section **Elementor template JSON**
that preserves the original layout, design and alignment — then verify it
**side by side against the live site**.

![flow](public/favicon.svg)

## What it does

1. **Scrapes** any reachable page (direct fetch with proxy fallbacks).
2. **Resolves the real CSS cascade** (`api/_css.js`): up to 12 stylesheets are
   parsed, indexed and applied with specificity / `!important` / `var()` /
   inline-style handling, evaluated at a 1440 px desktop viewport.
3. **Rebuilds the hierarchy** (`api/_engine.js`): native Elementor pages are
   read structurally (regions → sections → columns → widgets). Any other
   platform (Shopify, Wix, Webflow, custom HTML…) goes through the generic
   DOM mapper that detects rows, columns, headings, buttons, menus, galleries,
   forms, maps, videos…
4. **Emits Elementor template JSON** (`version 0.4`) in either
   Section/Column or Flexbox Container mode, with a global kit (colors,
   typography) extracted from the source branding.
5. **Compares it live** — the Studio shows the source site and a faithful
   HTML render of the exported JSON **side by side**, viewport-matched, with
   synchronised scrolling and per-section jumping.

## Side-by-side live compare

The **Live compare** tab is the truth-check for conversion fidelity:

| Left pane | Right pane |
| --- | --- |
| The live source site, iframed through `GET /api/proxy?url=…` (X-Frame-Options / CSP `frame-ancestors` are stripped, resources absolutised; `?nojs=1` optionally strips scripts) | The exported Elementor JSON rendered by `src/lib/elementorHtml.ts` — the same DOM skeleton (`elementor-section → elementor-container → elementor-column → elementor-widget-wrap`) and per-id generated CSS Elementor produces itself |

Both iframes run at the **same logical viewport** (Desktop 1440 / Laptop
1280) inside scale-to-fit stages. Scroll in either pane and the other
follows (fraction-synced, echo-suppressed). *Jump to section* scrolls the
clone to `#elx-sec-N` and the source to the matching page fraction.

## Fidelity features of the engine

- Column widths (16/25/33/50/100…), gaps, vertical content position and
  per-column background/alignment are preserved.
- Nested inner sections stay nested (never flattened).
- Auto-width / inline-block widgets keep shrink-to-fit sizing.
- Typography is resolved per element: size, weight, family, line-height,
  letter-spacing, transform, color.
- **SVG images (icons, logos, menu toggles) get their intrinsic width/height
  parsed from the SVG file itself**, so they can never blow up to full
  column width (a browser fallback of 300×150).
- Icon lists take the real icon & text colors from the cascade
  (svg fill → icon slot → item color → brand primary).
- Nav menus carry their items + dropdown children (`_elx_menu_items`) and
  the loop-carousel carries cards (`_elx_loop_cards`) so the renderer can
  reproduce them exactly; Elementor ignores these control keys on import.

## Project layout

```
api/
  clone.js     POST /api/clone     – runs the conversion, stores the job
  proxy.js     GET  /api/proxy     – live-site preview proxy (XFO-strip + URL rewrite)
  jobs.js      GET  /api/jobs      – historic jobs (Supabase)
  catalog.js   GET  /api/catalog   – widget map + sample targets
  _engine.js                       – the conversion engine (cloneUrl)
  _css.js                          – the CSS cascade mini-engine
src/
  pages/Studio.tsx                 – console + results (Live compare default tab)
  components/CompareDeck.tsx       – side-by-side viewer (proxy iframe + srcdoc iframe)
  lib/elementorHtml.ts             – Elementor JSON → standalone HTML renderer
  components/StructureTree.tsx     – section/column/widget inspector
  components/RenderPreview.tsx     – quick schematic block preview
scripts/
  test-local.mjs                   – end-to-end fixture test (engine → JSON → render)
  fixtures/site/                   – Elementor-flavoured fixture page (Polytech-like)
```

## Develop

```bash
npm install
npm run dev          # Vite frontend (api functions need `vercel dev` for /api)
npm run build        # type-check + bundle
npm run lint
node scripts/test-local.mjs   # full pipeline test against the local fixture
```

Deploy on Vercel: `vercel.json` already wires the Supabase env and the
`api/*.js` serverless functions run with `maxDuration: 60`.

## Known limits

- Content that only exists after client-side JS runs is not captured
  (the engine reads server HTML).
- `:hover`/`:focus` states and entrance animations are intentionally not
  transferred; mobile overrides are not exported (desktop viewport basis).
- Carousels/sliders render as static strips in the clone preview.
- Clone only pages you own or are licensed to reproduce.
