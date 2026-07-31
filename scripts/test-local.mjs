#!/usr/bin/env node
// End-to-end local test for the WebClonerELX pipeline:
//   fixture site  →  cloneUrl()  →  Elementor JSON  →  rendered HTML
//
// Covers BOTH extraction paths:
//   1. native-elementor  (scripts/fixtures/site)
//   2. generic-dom       (scripts/fixtures/generic)
//
// Usage: node scripts/test-local.mjs

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [path.join(ROOT, 'scripts/fixtures/site'), path.join(ROOT, 'scripts/fixtures/generic')];
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

  /* ---- turn-2: hero slider / premium cards / gallery / decor overlays ---- */

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

  check('rendered html is a full document', /^<!DOCTYPE html>/.test(html) && html.includes('</html>'));
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
  { url: `http://127.0.0.1:${PORT}/`, name: 'polytech-like', fn: assertElementorFixture },
  { url: `http://127.0.0.1:${PORT}/generic.html`, name: 'generic', fn: assertGenericFixture },
];

for (const fx of fixtures) {
  for (const mode of ['section', 'container']) {
    console.log(`\n== ${fx.name} (mode=${mode}) ==`);
    const result = await cloneUrl(fx.url, { mode, maxSections: 24 });
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
    fx.fn(result, html);
    createWriteStream(path.join(OUT, `elx-render-${fx.name}-${mode}.html`)).end(html);
    createWriteStream(path.join(OUT, `elx-result-${fx.name}-${mode}.json`)).end(JSON.stringify(result, null, 2));
    console.log(`  wrote ${OUT}/elx-render-${fx.name}-${mode}.html (${Math.round(html.length / 1024)} KB)`);
  }
}

server.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
