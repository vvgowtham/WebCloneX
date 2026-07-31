#!/usr/bin/env node
// End-to-end local test for the WebClonerELX pipeline:
//   fixture site  →  cloneUrl()  →  Elementor JSON  →  rendered HTML
//
// Covers extraction paths AND site archetypes (smoke testing):
//   1. native-elementor  (scripts/fixtures/site)
//   2. generic-dom       (scripts/fixtures/generic)
//   3. bootstrap         archetype (navbar + card deck + grid projects)
//   4. corporate         archetype (counters, progress, form, AOS, grid)
//   5. blog              archetype (article, table, details FAQ, srcset)
//   6. spa               archetype (deep #root, utility CSS, pricing)
//
// Every fixture runs the universal smoke checklist:
//   ✓ no blank page   ✓ DOM parsed        ✓ JSON valid
//   ✓ images imported ✓ pipeline logged   ✓ errors recovered, never thrown
//
// Usage: node scripts/test-local.mjs

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [
  path.join(ROOT, 'scripts/fixtures/site'),
  path.join(ROOT, 'scripts/fixtures/generic'),
  path.join(ROOT, 'scripts/fixtures/smoke'),
];
const OUT = process.env.ELX_OUT || '/tmp';
const BUNDLE = path.join(OUT, 'elx-renderer-bundle.mjs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? '  →  ' + extra : ''}`);
  }
}

const { cloneUrl } = await import(pathToFileURL(path.join(ROOT, 'api/_engine.js')).href);

async function serveFile(req, res) {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    for (const dir of DIRS) {
      const file = path.join(dir, p);
      if (!file.startsWith(dir)) continue;
      try {
        const body = await readFile(file);
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
        return res.end(body);
      } catch {
        /* try next root */
      }
    }
    throw new Error('404');
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}

function collectWidgets(content, type, acc = []) {
  (content || []).forEach((e) => {
    if (e.widgetType === type) acc.push(e);
    collectWidgets(e.elements, type, acc);
  });
  return acc;
}

function collectAll(content, acc = []) {
  (content || []).forEach((e) => {
    acc.push(e);
    collectAll(e.elements, acc);
  });
  return acc;
}

/* ---- universal smoke checklist (runs for EVERY fixture/mode) ---------- */

const VALID_ELTYPES = new Set(['section', 'column', 'widget', 'container']);

function smokeCheck(result, html, fx) {
  const all = collectAll(result.elementor.content);
  const widgets = all.filter((e) => e.elType === 'widget');
  check('SMOKE no blank page (sections + widgets > 0)', result.sections.length > 0 && widgets.length > 0);
  check(
    'SMOKE DOM parsed into content',
    result.stats.htmlKb > 0 && result.elementor.content.length > 0
  );
  check(
    'SMOKE Elementor JSON structurally valid',
    all.every((e) => VALID_ELTYPES.has(e.elType)) &&
      widgets.every((w) => typeof w.widgetType === 'string' && w.widgetType.length >= 2) &&
      all.every((e) => typeof e.id === 'string' && e.id.length >= 5) &&
      all.every((e) => e.settings === undefined || (typeof e.settings === 'object' && e.settings !== null))
  );
  check('SMOKE images imported', (result.stats.images || 0) >= (fx.minImgs ?? 0), `${result.stats.images} < ${fx.minImgs ?? 0}`);
  check('SMOKE pipeline log emitted', Array.isArray(result.log) && result.log.length >= 3 && /Opening/.test(result.log.join(' ')));
  check('SMOKE error recovery state exposed', Array.isArray(result.errors));
  check('SMOKE fidelity reported', !!result.fidelity && result.fidelity.score >= 40 && result.fidelity.textCoverage >= 30, JSON.stringify(result.fidelity && result.fidelity.score));
  check('SMOKE render is a full document', /^<!DOCTYPE html>/.test(html) && html.includes('</html>'));
  const giantBlob = widgets.find((w) => typeof w.settings?.html === 'string' && w.settings.html.length > 20000);
  check('SMOKE no raw body dump as html blob', !giantBlob);
}

/* ---- native elementor fixture assertions ---------------------------- */

function assertElementorFixture(result, html) {
  console.log(`  sections=${result.stats.sections} widgets=${result.stats.widgets} extraction=${result.stats.extraction}`);
  result.sections.forEach((s) =>
    console.log(`    ${s.name}  cols=${s.columnCount} w=${s.widgetCount} bg=${s.background.color || '-'} padT=${s.padding.top}`)
  );

  check('extraction path is native-elementor', result.stats.extraction === 'native-elementor', result.stats.extraction);
  check('first section is the header', result.sections[0].type === 'header', result.sections[0].type);
  check('a footer section exists', result.sections.some((s) => s.type === 'footer'));
  check('hero section detected from image-carousel', result.sections.some((s) => s.type === 'hero'));

  const nav = collectWidgets(result.elementor.content, 'nav-menu')[0];
  const items = nav && nav.settings._elx_menu_items;
  check('nav-menu present with 7 items', Array.isArray(items) && items.length === 7, String(items && items.length));
  check('menu dropdown children preserved', items && items.some((m) => (m.children || []).length >= 3));
  check('nav-menu right aligned', nav && nav.settings.align_items === 'end', nav && nav.settings.align_items);

  const images = collectWidgets(result.elementor.content, 'image');
  const svgImgs = images.filter((e) => /\.svg/.test(e.settings.image.url));
  const logo = svgImgs.find((e) => /head-logo/.test(e.settings.image.url));
  check('logo svg got intrinsic width 182', !!logo && logo.settings.width && logo.settings.width.size === 182, JSON.stringify(logo && logo.settings.width));
  const toggle = svgImgs.find((e) => /Menu-Icon/.test(e.settings.image.url));
  check('menu toggle svg width 30 (not giant)', !!toggle && toggle.settings.width && toggle.settings.width.size === 30, JSON.stringify(toggle && toggle.settings.width));

  check('brand green detected as primary', result.design.primary === '#5CB431', result.design.primary);
  check('Poppins font detected', result.design.fonts.some((f) => /poppins/i.test(f)), result.design.fonts.join(','));

  const feat = result.sections.find((s) => s.type === 'features');
  check(
    'features section keeps inner 3-column row',
    !!feat && feat.columns[0].blocks.some((b) => b.kind === 'row' && b.columns.length === 3)
  );
  check('social icons extracted', result.stats.byType['social-icons'] >= 1);
  check('topbar icon-links did not leak as giant images', !result.sections[0].widgets.some((w) => w.type === 'image'));

  check('nav sr-only label deduplicated', items && items[0].text === 'Home', items && items[0].text);

  const carousels = collectWidgets(result.elementor.content, 'image-carousel');
  const heroCar = carousels.find((c) => (c.settings.carousel || []).some((x) => /4\.0\.jpg/.test(x.url || '')));
  check('hero carousel keeps one-slide data-settings', !!heroCar && heroCar.settings.slides_to_show === '1', heroCar && heroCar.settings.slides_to_show);
  check('hero carousel keeps 560px slide height', !!heroCar && heroCar.settings._elx_slide_height === 560, JSON.stringify(heroCar && heroCar.settings._elx_slide_height));
  const clientCar = carousels.find((c) => (c.settings.carousel || []).some((x) => /\/1\.jpg/.test(x.url || '')));
  check('logo strip carousel defaults to 3-up', !!clientCar && clientCar.settings.slides_to_show === '3', clientCar && clientCar.settings.slides_to_show);

  const gallery = collectWidgets(result.elementor.content, 'image-gallery')[0];
  check('gallery widget keeps >= 8 images', !!gallery && (gallery.settings._elx_gallery || []).length >= 8, String(gallery && (gallery.settings._elx_gallery || []).length));
  check('gallery keeps 4 columns from grid class', !!gallery && String(gallery.settings.gallery_columns) === '4', gallery && String(gallery.settings.gallery_columns));

  const headAll = collectWidgets(result.elementor.content, 'heading');
  check('premium card headings expanded (Superior Quality)', headAll.some((h) => h.settings.title === 'Superior Quality'));
  check('premium card headings expanded (Weather & Fire)', headAll.some((h) => /Weather/.test(String(h.settings.title))));
  check(
    'unknown premium widgets are not dumped as html blobs',
    !JSON.stringify(result.elementor.content).includes('elementskit-image-box')
  );

  const imgsAll = collectWidgets(result.elementor.content, 'image');
  check('product caption preserved (UPVC Door)', imgsAll.some((i) => i.settings._elx_caption === 'UPVC Door'));
  check('product caption preserved (Kitchen Cabinet)', imgsAll.some((i) => i.settings._elx_caption === 'Kitchen Cabinet'));
  check('product image keeps 230px crop height', imgsAll.some((i) => i.settings._elx_img_height === 230));
  check('decorative absolute phone svg dropped', !imgsAll.some((i) => /decor-phone/.test((i.settings.image || {}).url || '')));
  check('floating whatsapp overlay dropped', !JSON.stringify(result.elementor.content).includes('wa.me'));
  check('gallery captions not invented from alt text', (gallery.settings._elx_gallery || []).every((g) => !g.caption));

  const cardCol = collectAll(result.elementor.content).find((e) => (e.elType === 'column' || e.elType === 'container') && e.settings && e.settings._elx_radius === 16);
  check('feature card column keeps radius 16', !!cardCol);
  check('feature card column keeps white background', !!cardCol && cardCol.settings.background_color === '#FFFFFF', cardCol && cardCol.settings.background_color);

  check('gallery rendered as elx-gallery grid', html.includes('elx-gallery'));
  check('card chrome rendered (radius 16)', html.includes('border-radius:16px'));
  check('nav typography rendered (15px)', /\.elementor-nav-menu a\{[^}]*font-size:15px/.test(html));
  check('hero slide height rendered (560px)', html.includes('height:560px'));
  check('product overlay caption rendered', html.includes('elx-figcap') && html.includes('<figcaption>UPVC Door</figcaption>'));
  check('product crop height rendered (230px)', html.includes('height:230px'));
  check('gallery rendered without invented captions', !html.includes('<figcaption>Work 1</figcaption>'));
  check('decor / whatsapp never rendered', !html.includes('decor-phone') && !html.includes('wa.me'));

  check('render contains elx-sec anchors', html.includes('id="elx-sec-0"') && html.includes(`id="elx-sec-${result.sections.length - 1}"`));
  check('topbar green background rendered', html.includes('background-color:#5CB431'));
  check('topbar text rendered white', html.includes('.elementor-icon-list-text{color:#FFFFFF}'));
  check('nav menu items rendered as real links', html.includes('>Sustainability</a>'));
  check('nav dropdown rendered', html.includes('UPVC Doors') && html.includes('sub-menu'));
  check('inline heading font-size captured (38px)', html.includes('font-size:38px'));
  check('logo width applied in render', html.includes('width:182px'));
  check('content width rule emitted', /max-width:11[24]0px/.test(html));
  check('google fonts link emitted for Poppins', html.includes('fonts.googleapis.com'));
  check('scroll sync snippet embedded', html.includes('elx-scrollto') && html.includes('elx-jump'));
  check('carousel slides rendered statically', html.includes('elx-carousel-track'));
  check('brand social colors applied', html.includes('#1877F2'));
}

/* ---- generic dom fixture assertions ---------------------------------- */

function assertGenericFixture(result, html) {
  console.log(`  sections=${result.stats.sections} widgets=${result.stats.widgets} extraction=${result.stats.extraction}`);
  result.sections.forEach((s) =>
    console.log(`    ${s.name}  cols=${s.columnCount} w=${s.widgetCount} bg=${s.background.color || '-'} padT=${s.padding.top}`)
  );

  check('extraction path is generic-dom', result.stats.extraction === 'generic-dom', result.stats.extraction);
  check('header detected first', result.sections[0].type === 'header', result.sections[0].type);
  check('footer detected last', result.sections[result.sections.length - 1].type === 'footer');
  check('hero detected', result.sections.some((s) => s.type === 'hero'));
  check('feature grid detected (3 cols)', result.sections.some((s) => s.columnCount === 3));

  const nav = collectWidgets(result.elementor.content, 'nav-menu')[0];
  check('nav-menu from header ul', !!nav && Array.isArray(nav.settings._elx_menu_items) && nav.settings._elx_menu_items.length === 5);

  const buttons = collectWidgets(result.elementor.content, 'button');
  check('cta button captured', buttons.some((b) => /free quote/i.test(String(b.settings.text))), JSON.stringify(buttons.map((b) => b.settings.text)));
  check('cta button keeps brand background', buttons.some((b) => b.settings.background_color === '#C2410C'));

  const heads = collectWidgets(result.elementor.content, 'heading');
  const h1 = heads.find((h) => /Blinds made/.test(String(h.settings.title)));
  check('hero h1 captured', !!h1);
  check('hero h1 keeps 52px / 800', !!h1 && h1.settings.typography_font_size && h1.settings.typography_font_size.size === 52 && h1.settings.typography_font_weight === '800');
  check('hero h1 renders white', !!h1 && h1.settings.title_color === '#FFFFFF', h1 && h1.settings.title_color);

  const images = collectWidgets(result.elementor.content, 'image');
  const logo = images.find((e) => /logo\.svg/.test(e.settings.image.url));
  check('generic logo svg intrinsic width 140', !!logo && logo.settings.width && logo.settings.width.size === 140, JSON.stringify(logo && logo.settings.width));

  const lists = collectWidgets(result.elementor.content, 'icon-list');
  check('ticks list → icon-list', lists.some((l) => (l.settings.icon_list || []).some((i) => /warranty/i.test(i.text))));

  check('Inter font detected', result.design.fonts.some((f) => /inter/i.test(f)), result.design.fonts.join(','));
  check('render keeps hero h1 size', html.includes('font-size:52px'));
  check('render renders nav items', html.includes('>Gallery</a>') || html.includes('>Products</a>'));
  check('render keeps brand orange button', html.includes('background-color:#C2410C'));
}

/* ---- smoke archetype assertions -------------------------------------- */

function assertBootstrap(result, html) {
  console.log(`  sections=${result.stats.sections} widgets=${result.stats.widgets} extraction=${result.stats.extraction}`);
  const nav = collectWidgets(result.elementor.content, 'nav-menu')[0];
  check('BOOT navbar → nav-menu', !!nav && (nav.settings._elx_menu_items || []).length === 5, JSON.stringify(nav && (nav.settings._elx_menu_items || []).length));
  const heads = collectWidgets(result.elementor.content, 'heading');
  check('BOOT hero h1 captured', heads.some((h) => /We Build With Precision/.test(String(h.settings.title))));
  const buttons = collectWidgets(result.elementor.content, 'button');
  check('BOOT primary button captured', buttons.some((b) => /Free Quote/.test(String(b.settings.text))));
  // card deck = three service cards preserved as columns of a row
  const svcTexts = ['General Contracting', 'Design & Build', 'Renovations'];
  check(
    'BOOT card deck preserved (all 3 cards)',
    svcTexts.every((t) => JSON.stringify(result.elementor.content).includes(t.split(' ')[0]))
  );
  const json = JSON.stringify(result.elementor.content);
  check('BOOT project overlay captions preserved', json.includes('Skyline Offices') && json.includes('Harbor Mall'));
  check('BOOT mobile nav hidden setting emitted', JSON.stringify(result.elementor.content).includes('hide_mobile'));
  check('BOOT jumbotron background image kept', result.sections.some((sec) => sec.background.image), JSON.stringify(result.sections.map((x) => x.background.image).filter(Boolean)));
  check('BOOT render shows hero', html.includes('We Build With Precision'));
}

function assertCorporate(result, html) {
  console.log(`  sections=${result.stats.sections} widgets=${result.stats.widgets} extraction=${result.stats.extraction}`);
  const json = JSON.stringify(result.elementor.content);
  const counters = collectWidgets(result.elementor.content, 'counter');
  check('CORP counters detected (>=3)', counters.length >= 3, String(counters.length));
  check('CORP counter values right', counters.some((c) => Number(c.settings.ending_number) === 1200));
  const progress = collectWidgets(result.elementor.content, 'progress');
  check('CORP progress bars detected (>=3)', progress.length >= 3, String(progress.length));
  check('CORP progress percent kept', progress.some((pr) => pr.settings.percent && pr.settings.percent.size === 92));
  const forms = collectWidgets(result.elementor.content, 'form');
  const form = forms.find((f) => (f.settings.form_fields || []).length >= 4);
  check('CORP form converted with fields', !!form, String(forms.length));
  check('CORP form labels preserved', !!form && form.settings.form_fields.some((f) => /Full name/.test(f.field_label)));
  check('CORP required fields marked', !!form && form.settings.form_fields.filter((f) => f.required === 'true').length >= 2);
  check('CORP select options preserved', !!form && form.settings.form_fields.some((f) => f.field_type === 'select' && /51–200/.test(f.field_options)));
  check('CORP hidden field noted', !!form && Number(form.settings._elx_hidden_fields) >= 1, JSON.stringify(form && form.settings._elx_hidden_fields));
  const animated = collectAll(result.elementor.content).filter((e) => e.settings && (e.settings._animation || e.settings._elx_custom_anim));
  check('CORP animations preserved on widgets/sections', animated.length >= 2, String(animated.length));
  check('CORP custom keyframes carried', json.includes('_elx_custom_anim_css') || animated.some((a) => a.settings._animation === 'riseFade' || a.settings._animation === 'fadeInUp' || a.settings._animation === 'zoomIn'));
  const transitions = collectAll(result.elementor.content).filter((e) => e.settings && e.settings._elx_transition);
  check('CORP transitions preserved', transitions.length >= 1, String(transitions.length));
  const social = collectWidgets(result.elementor.content, 'social-icons');
  check('CORP social icons converted', social.length >= 1 && (social[0].settings.social_icon_list || []).length >= 4, String(social.length));
  check('CORP hero animation rendered (AOS→fadeInUp or custom)', html.includes('@keyframes fadeInUp') || html.includes('@keyframes riseFade'));
  check('CORP reveal script embedded', html.includes('IntersectionObserver'));
  const rows = [];
  (function rr(bl) {
    (bl || []).forEach((b) => {
      if (b.kind === 'row') {
        rows.push(b);
        rr(b.columns.flatMap((c) => c.blocks || []));
      }
    });
  })(result.sections.flatMap((sec) => (sec.columns || []).flatMap((c) => c.blocks || [])));
  check('CORP grid services stay 3 columns', result.sections.some((sec) => sec.columnCount === 3) || rows.some((r) => r.columns.length === 3));
}

function assertBlog(result, html) {
  console.log(`  sections=${result.stats.sections} widgets=${result.stats.widgets} extraction=${result.stats.extraction}`);
  const json = JSON.stringify(result.elementor.content);
  const toggles = collectWidgets(result.elementor.content, 'toggle');
  check('BLOG FAQ details → toggle widgets (>=3)', toggles.length >= 3, String(toggles.length));
  check('BLOG toggle keeps question text', toggles.some((t) => /best season/.test(String((t.settings.tabs || [])[0]?.tab_title || ''))));
  const tables = collectWidgets(result.elementor.content, 'html').filter((w) => /<table/i.test(String(w.settings.html)));
  check('BLOG itinerary table preserved', tables.length >= 1);
  check('BLOG divider from hr', (result.stats.byType.divider || 0) >= 1);
  check('BLOG blockquote preserved', collectWidgets(result.elementor.content, 'blockquote').length >= 1);
  const imgs = collectWidgets(result.elementor.content, 'image');
  const spiti = imgs.find((i) => (i.settings.image || {}).url && /Benner-2|4\.0/.test(i.settings.image.url));
  check('BLOG picture srcset preserved', !!spiti && typeof spiti.settings._elx_srcset === 'string' && /1200w/.test(spiti.settings._elx_srcset));
  check('BLOG lazy loading preserved', !!spiti && spiti.settings._elx_lazy === 'yes');
  const forms = collectWidgets(result.elementor.content, 'form');
  check('BLOG newsletter form converted', forms.some((f) => (f.settings.form_fields || []).some((x) => x.field_type === 'email' && x.required === 'true')));
  check('BLOG aside links kept', json.includes('Meghalaya'));
  check('BLOG render shows FAQ questions', html.includes('best season to visit'));
  check('BLOG aside layout kept (2 cols)', result.sections.some((sec) => sec.columnCount === 2), JSON.stringify(result.sections.map((x) => x.columnCount)));
}

function assertSpa(result, html) {
  console.log(`  sections=${result.stats.sections} widgets=${result.stats.widgets} extraction=${result.stats.extraction}`);
  const json = JSON.stringify(result.elementor.content);
  check('SPA deep #root content segmented', result.sections.length >= 4, String(result.sections.length));
  check('SPA hero heading survives', json.includes('Ship product feedback loops'));
  const buttons = collectWidgets(result.elementor.content, 'button');
  check('SPA CTA buttons captured (>=2)', buttons.length >= 2, String(buttons.length));
  check('SPA pricing values kept', json.includes('$49') && json.includes('$0'));
  check('SPA testimonial quote kept', json.includes('replaced four tools'));
  check('SPA feature cards preserved', json.includes('Close the loop') && json.includes('Prioritise'));
  check('SPA AOS animations converted', collectAll(result.elementor.content).some((e) => e.settings && (e.settings._animation === 'zoomIn' || e.settings._animation === 'fadeInUp')));
  check('SPA render shows pricing', html.includes('$49'));
}

/* ---- main ------------------------------------------------------------- */

const server = http.createServer(serveFile);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const { execSync } = await import('node:child_process');
execSync(
  `${path.join(ROOT, 'node_modules/.bin/esbuild')} ${path.join(ROOT, 'src/lib/elementorHtml.ts')} --bundle --format=esm --outfile=${BUNDLE}`,
  { stdio: 'pipe' }
);
const { renderElementorDocument } = await import(pathToFileURL(BUNDLE).href);

const fixtures = [
  { url: `http://127.0.0.1:${PORT}/`, name: 'polytech-like', fn: assertElementorFixture, minImgs: 8 },
  { url: `http://127.0.0.1:${PORT}/generic.html`, name: 'generic', fn: assertGenericFixture, minImgs: 2 },
  { url: `http://127.0.0.1:${PORT}/bootstrap.html`, name: 'bootstrap', fn: assertBootstrap, minImgs: 3 },
  { url: `http://127.0.0.1:${PORT}/corporate.html`, name: 'corporate', fn: assertCorporate, minImgs: 0 },
  { url: `http://127.0.0.1:${PORT}/blog.html`, name: 'blog', fn: assertBlog, minImgs: 2 },
  { url: `http://127.0.0.1:${PORT}/spa.html`, name: 'spa', fn: assertSpa, minImgs: 0 },
];

for (const fx of fixtures) {
  for (const mode of ['section', 'container']) {
    console.log(`\n== ${fx.name} (mode=${mode}) ==`);
    const result = await cloneUrl(fx.url, { mode, maxSections: 30, browser: false });
    check('clone ok', result.ok);
    const topTypes = result.elementor.content.map((e) => e.elType);
    check(
      `top-level elements are ${mode === 'container' ? 'containers' : 'sections'}`,
      topTypes.every((t) => t === (mode === 'container' ? 'container' : 'section')),
      topTypes.join(',')
    );
    const html = renderElementorDocument(result.elementor, { primary: result.design.primary, fonts: result.design.fonts });
    check('rendered page remains scrollable (no overflow lock on body)', !/\.elementor\{[^}]*overflow:\s*hidden/.test(html));
    if (mode === 'section') check('section markup used', html.includes('elementor-container elementor-column-gap'));
    else check('container markup used', html.includes('e-con e-parent'));
    smokeCheck(result, html, fx);
    fx.fn(result, html);
    createWriteStream(path.join(OUT, `elx-render-${fx.name}-${mode}.html`)).end(html);
    createWriteStream(path.join(OUT, `elx-result-${fx.name}-${mode}.json`)).end(JSON.stringify(result.log && { log: result.log, errors: result.errors, fidelity: result.fidelity }, null, 2));
    console.log(`  fidelity score ${result.fidelity.score}/100 · text coverage ${result.fidelity.textCoverage}% · errors ${result.errors.length}`);
    console.log(`  wrote ${OUT}/elx-render-${fx.name}-${mode}.html (${Math.round(html.length / 1024)} KB)`);
  }
}

server.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
