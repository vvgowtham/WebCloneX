# WebClonerELX — any website → Elementor JSON

Clone **any public website** into a section-by-section **Elementor template JSON**
that preserves the original layout, design and alignment — then verify it
**side by side against the live site**.

![flow](public/favicon.svg)

## The universal pipeline

Every URL goes through the same staged pipeline — no site-specific logic, no
hardcoded selectors, everything discovered dynamically:

1. **Validate & open** — the URL is normalised, then captured by a real
   headless **Chromium** (`api/_browser.js`, `@sparticuz/chromium` +
   `puppeteer-core` on Vercel): network-idle wait, JavaScript + AJAX
   hydration, auto-scroll to trigger lazy loading and infinite sections.
   If a browser is unavailable the engine degrades gracefully to a direct
   fetch with proxy fallbacks — never to a blank page.
2. **Collect the full DOM** — every node is inspected (header, nav, section,
   main, footer, article, aside, div, form, table, list, figure, iframe…).
   JS-hidden elements are tagged during the browser pass so `display:none`
   shells never leak into the output.
3. **Resolve the real CSS cascade** (`api/_css.js`) — display, position,
   box model, flex/grid tracks, gap, typography, color, background, border,
   shadow, opacity, overflow, transform, transition, animation, filter,
   z-index, object-fit, aspect-ratio… computed per element with
   specificity / `!important` / `var()` / inheritance, at a 1440 px base
   viewport. `@media` rules are bucketed into **tablet** and **mobile**
   overrides, `@keyframes` are captured.
4. **Detect layouts** — flex rows/columns (`flex-row`, `flex-column`),
   CSS grids (`repeat(N, …)` → real column widths), absolute-positioned and
   float layouts, block flow. Repeated-structure detection recognises card
   grids and rebuilds them as real Elementor column rows with the card
   chrome (radius, shadow, border, padding) preserved.
5. **Map Elementor widgets** — headings, text, buttons, images
   (srcset/sizes/lazy kept), video, icon-boxes, icon lists, tabs,
   accordions, toggles, carousels, counters, progress bars, dividers,
   spacers, Google Maps, nav menus (dropdown children included), social
   icons, galleries, rich forms (labels, placeholders, required flags,
   select options, hidden fields), and inline SVG as HTML widgets. When no
   Elementor widget exists, a custom HTML widget preserves the design.
6. **Generate, optimise, validate** — nested hierarchy is preserved at any
   depth (never flattened), assets are deduplicated, the emitted JSON is
   structurally validated, and a **fidelity report** (text coverage,
   animations kept, images kept, recovered nodes, 0–100 score) is computed.
7. **Never blank** — per-section and per-widget error recovery: a failing
   node is logged with stage + DOM path + reason, skipped, and conversion
   continues. If a page yields no classic sections at all (JS shells, bot
   challenges), a rescue pass still recovers visible content.

The full timestamped log (`Opening → Loading scripts → Scrolling →
Collecting DOM → Extracting CSS → Detecting layouts → Mapping widgets →
Generating JSON → Optimizing → Validating → Completed`) and the error list
ship on the API response (`result.log`, `result.errors`, `result.fidelity`)
and are shown in the Studio.

## Motion & responsive

- Entrance animations (CSS `animation`, animate.css classes, `data-aos`
  attributes) map to Elementor's `_animation` library with fuzzy name
  resolution (fade-up → `fadeInUp`…); unknown `@keyframes` are carried
  along as `_elx_custom_anim_css` so nothing is dropped. Delays,
  durations and transitions survive.
- Desktop / tablet / mobile settings are emitted separately:
  `hide_mobile`, per-section `padding_mobile`, per-widget
  `typography_font_size_mobile`, mobile full-width flags — all derived
  from the source `@media` rules, not guessed.
- The standalone renderer (`src/lib/elementorHtml.ts`) replays the same
  animations (IntersectionObserver-triggered, `prefers-reduced-motion`
  aware) and paints media-query CSS per breakpoint.

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
  Screen-reader-only labels inside menu links are never duplicated into
  the visible item text.
- Sliders respect their real `data-settings` (`slides_to_show`, arrows,
  autoplay) and keep their rendered wrapper height, so a full-bleed hero
  stays one slide instead of collapsing into a thumbnail strip; logo
  strips default to Elementor's 3-up layout.
- Galleries map to the real `image-gallery` widget: image list, grid
  column count from `gallery-grid-columns-N`, and captions only when a
  visible `<figcaption>` existed (alt text is never painted as overlay).
- `<figure><img><figcaption>` cards (product grids, team cards) convert
  to image widgets with the crop height, border-radius and the caption
  painted as an overlay exactly like the source.
- Unknown third-party widgets (premium addons, ElementsKit…) are expanded
  into native heading/text/image widgets instead of raw-HTML blobs; when
  the widget box looks like a card (solid background, radius, shadow,
  border) that chrome is preserved on the emitted inner row.
- Floating overlays — fixed chat/WhatsApp buttons, absolutely-positioned
  decorative icons — are detected via computed `position` and dropped
  from the converted output entirely.

## Smoke suite

`node scripts/test-local.mjs` clones **six synthetic sites × two structure
modes** over a local HTTP server — an Elementor-built site, a plain
hand-written site, a Bootstrap page, a corporate landing page, a blog and a
React-style SPA shell — and asserts for every run: no blank page, valid
Elementor schema, images imported, pipeline log emitted, error-recovery
state exposed, fidelity score reported, full-document render, preserved
cards/counters/animations/menus. 378 assertions, 0 external network.

## Project layout

```
api/
  clone.js     POST /api/clone     – runs the conversion, stores the job
  proxy.js     GET  /api/proxy     – live-site preview proxy (XFO-strip + URL rewrite)
  jobs.js      GET  /api/jobs      – historic jobs (Supabase)
  catalog.js   GET  /api/catalog   – widget map + sample targets
  _browser.js                      – headless Chromium capture (stage 2–4)
  _engine.js                       – the conversion engine (cloneUrl)
  _css.js                          – the CSS cascade mini-engine
src/
  pages/Studio.tsx                 – console, pipeline log, fidelity & results
  components/CompareDeck.tsx       – side-by-side viewer (proxy iframe + srcdoc iframe)
  lib/elementorHtml.ts             – Elementor JSON → standalone HTML renderer
  components/StructureTree.tsx     – section/column/widget inspector
  components/RenderPreview.tsx     – quick schematic block preview
scripts/
  test-local.mjs                   – end-to-end smoke suite (engine → JSON → render)
  fixtures/                        – 6 synthetic sites covering major stacks
```

## Develop

```bash
npm install
npm run dev          # Vite frontend (api functions need `vercel dev` for /api)
npm run build        # type-check + bundle
npm run lint
node scripts/test-local.mjs   # full pipeline test against local fixtures
```

Deploy on Vercel: `vercel.json` wires the Supabase env, and `api/clone.js`
runs with `memory: 1024` / `maxDuration: 60` for the headless-Chromium
stage. Set `ELX_BROWSER=0` to force the fetch-only pipeline.

## Known limits

- The browser stage runs on Vercel/serverless out of the box; locally it
  needs system Chromium libraries, otherwise the engine transparently uses
  the fetch pipeline (logged as `fetch engine`).
- Carousels/sliders render as static strips in the clone preview.
- The fidelity score is a structural heuristic (text coverage, widgets,
  assets, animations, recovered errors); pixel-diff auto-iteration is not
  implemented.
- Clone only pages you own or are licensed to reproduce.
