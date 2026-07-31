// WebClonerELX conversion engine
// Scrapes any public URL, resolves the real CSS cascade, rebuilds the
// section → column → widget hierarchy and emits an Elementor-importable
// template JSON (legacy Section/Column or Flexbox Container).

import { parse } from 'node-html-parser';
import dns from 'node:dns';
import net from 'node:net';
import { loadStyles, computedStyle, isHidden, px, pct, boxOf, createSheet, resolveVar } from './_css.js';

// Some hosts publish AAAA records unreachable from serverless runtimes;
// force IPv4 so direct fetches don't hang on happy-eyeballs.
try {
  dns.setDefaultResultOrder('ipv4first');
  if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(false);
} catch {
  /* noop */
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SKIP_TAGS = new Set([
  'SCRIPT','STYLE','NOSCRIPT','TEMPLATE','LINK','META','SVG','PATH','CANVAS','HEAD','BASE','SOURCE','DEFS','CLIPPATH','G','RECT','CIRCLE',
]);

const DEFAULT_HEAD_SIZE = { H1: 48, H2: 36, H3: 28, H4: 22, H5: 18, H6: 16 };

const uid = () => Math.random().toString(16).slice(2, 9);
const clean = (s = '') => String(s).replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

function abs(href, base) {
  if (!href) return '';
  try {
    return new URL(String(href).trim(), base).href;
  } catch {
    return href;
  }
}

function attr(el, name) {
  try {
    return (el && el.getAttribute && el.getAttribute(name)) || '';
  } catch {
    return '';
  }
}

function cls(el) {
  return attr(el, 'class');
}

function idClass(el) {
  return (attr(el, 'id') + ' ' + cls(el)).toLowerCase();
}

function normColor(v) {
  if (!v) return '';
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'inherit' || s === 'initial' || s === 'currentcolor' || s.startsWith('var(')) return '';
  const named = {
    white: '#FFFFFF', black: '#000000', red: '#FF0000', blue: '#0000FF', green: '#008000',
    gray: '#808080', grey: '#808080', silver: '#C0C0C0', navy: '#000080', teal: '#008080',
  };
  if (named[s]) return named[s];
  const hex = s.match(/#([0-9a-f]{3,8})\b/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    return '#' + h.slice(0, 6).toUpperCase();
  }
  const rgb = s.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const p = rgb[1].split(/[,\s/]+/).filter(Boolean).map((n) => parseFloat(n));
    if (p.length >= 3) {
      if (p[3] !== undefined && p[3] < 0.08) return '';
      return (
        '#' +
        p.slice(0, 3)
          .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()
      );
    }
  }
  return '';
}

function bgImageFrom(value, base) {
  if (!value) return '';
  const m = String(value).match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  return m ? abs(m[1], base) : '';
}

function pickSrcset(ss) {
  if (!ss) return '';
  let best = '';
  let bestW = -1;
  ss.split(',').forEach((part) => {
    const bits = part.trim().split(/\s+/);
    if (!bits[0]) return;
    const w = bits[1] ? parseInt(bits[1]) || 0 : 0;
    if (w >= bestW) {
      bestW = w;
      best = bits[0];
    }
  });
  return best;
}

function imageSrc(el, base) {
  const cands = [
    attr(el, 'data-lazy-src'),
    attr(el, 'data-src'),
    attr(el, 'data-original'),
    attr(el, 'src'),
    pickSrcset(attr(el, 'data-srcset')),
    pickSrcset(attr(el, 'srcset')),
  ].filter(Boolean);
  const src = cands.find((c) => !/^data:/i.test(c) && c.length < 900) || '';
  return src ? abs(src, base) : '';
}

function isTracker(url) {
  return /facebook\.com\/tr|google-analytics|googletagmanager|doubleclick|\/pixel|1x1\.|spacer\.gif/i.test(url);
}

// Elements pulled out of normal flow: floating WhatsApp/chat buttons, promo
// badges, decorative background icons (giant phone/envelope silhouettes).
// They are overlays — not page content — and must never become widgets.
function isDecorOverlay(sheet, el) {
  const cs = computedStyle(sheet, el);
  const pos = String(cs.position || '').toLowerCase();
  if (pos === 'fixed') return true;
  if (pos !== 'absolute') return false;
  // absolutely-positioned content with real text is usually an overlay card —
  // keep it; icon/image-only decorations with no text get dropped.
  return clean(el.text).length < 8;
}

// Text of an element without visually-hidden spans such as screen-reader
// labels (menu items often hide an sr-only "Home" inside an icon link — it
// must not become a second menu entry).
function textVisibleOnly(sheet, el, depth = 0) {
  let out = '';
  for (const n of el.childNodes || []) {
    if (n.nodeType === 3) out += n.text + ' ';
    else if (n.nodeType === 1 && depth < 8) {
      if (SKIP_TAGS.has(n.tagName)) continue;
      if (isHidden(computedStyle(sheet, n), n)) continue;
      out += textVisibleOnly(sheet, n, depth + 1) + ' ';
    }
  }
  return clean(out);
}

// Read Elementor's data-settings JSON blob (sliders store their real
// configuration there: slides_to_show, autoplay, navigation...).
function dataSettingsOf(el) {
  const raw = attr(el, 'data-settings') || attr(el, 'data-widget_settings');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(raw.replace(/&quot;/g, '"'));
    } catch {
      return {};
    }
  }
}

// Card-likeness of a widget/container: solid background, big radius or shadow.
// Unknown premium widgets that look like cards keep their chrome instead of
// being stripped to bare text.
function cardStyleOf(sheet, el) {
  const cs = computedStyle(sheet, el);
  const bg = normColor(cs['background-color']) || normColor(cs.background);
  const radius = px(cs['border-radius']);
  const shadow = cs['box-shadow'] && !/none/i.test(cs['box-shadow']) ? cs['box-shadow'] : '';
  const borderW = px(cs['border-width']);
  const borderCol = borderW ? normColor(cs['border-color']) || '#E4E4E4' : '';
  if (!bg && !(radius && radius >= 6 && shadow) && !borderW) return null;
  return { bg: bg || '', radius, shadow: shadow || '', borderW: borderW || 0, borderCol, padding: boxOf(cs, 'padding') };
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

export async function fetchHtml(url) {
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const attempts = [
    { via: 'direct', build: (u) => u },
    { via: 'proxy:allorigins', build: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { via: 'proxy:codetabs', build: (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
    { via: 'proxy:corsproxy', build: (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
  ];

  let lastErr = 'unknown error';
  for (const a of attempts) {
    try {
      const res = await fetch(a.build(url), {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(a.via === 'direct' ? 14000 : 22000),
      });
      const html = await res.text();
      const bad =
        !html ||
        html.length < 900 ||
        !/<[a-z!]/i.test(html) ||
        /(Connection timed out|Web server is down|error code: 5\d\d|<title>[^<]*\b(5\d\d|Just a moment|Attention Required)\b)/i.test(
          html.slice(0, 4000)
        );
      if (!bad) return { html, finalUrl: a.via === 'direct' ? res.url || url : url, via: a.via, status: res.status };
      lastErr = `HTTP ${res.status} via ${a.via} (${html ? html.length : 0} bytes, unusable)`;
    } catch (err) {
      lastErr = err.message || String(err);
    }
  }
  throw new Error('Unable to reach target site: ' + lastErr);
}

/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */

function detectPlatform(rawHtml) {
  const tests = [
    [/data-elementor-type|elementor-kit-|\/elementor\//i, 'WordPress + Elementor'],
    [/brxe-|bricks\/frontend/i, 'WordPress + Bricks'],
    [/wp-content|wp-includes/i, 'WordPress'],
    [/cdn\.shopify\.com|Shopify\.theme/i, 'Shopify'],
    [/static\.parastorage\.com|wix\.com/i, 'Wix'],
    [/squarespace/i, 'Squarespace'],
    [/webflow/i, 'Webflow'],
    [/_next\/static/i, 'Next.js'],
    [/__nuxt/i, 'Nuxt'],
    [/framerusercontent/i, 'Framer'],
  ];
  for (const [re, name] of tests) if (re.test(rawHtml)) return name;
  return 'Custom / Unknown';
}

// WordPress/Gutenberg ship a fixed default palette that has nothing to do with
// the site's real branding — never let it win the primary-colour vote.
const WP_DEFAULT_PALETTE = new Set([
  '#FF6900', '#FCB900', '#7BDCB5', '#00D084', '#8ED1FC', '#0693E3', '#ABB8C3',
  '#EB144C', '#F78DA7', '#9900EF', '#CF2E2E', '#9B51E0', '#6EC1E4', '#54595F',
  '#7A7A7A', '#61CE70',
]);

function extractDesign(sheet, rawHtml) {
  const colorCount = new Map();
  const fonts = new Set();
  const bump = (hex, n = 1) => {
    if (!hex) return;
    let w = n;
    if (hex === '#FFFFFF' || hex === '#000000') w = n * 0.15;
    if (WP_DEFAULT_PALETTE.has(hex)) w = n * 0.05;
    colorCount.set(hex, (colorCount.get(hex) || 0) + w);
  };

  // Elementor / theme custom properties carry the real brand palette. Custom
  // kit slots (hashed names) outrank the untouched default slots.
  const kitColors = [];
  for (const [name, value] of sheet.vars) {
    const hex = normColor(resolveVar(sheet, value));
    if (hex) {
      const custom = /^--e-global-color-[0-9a-f]{6,8}$/i.test(name);
      const isKit = /^--e-global-color|^--wp--preset--color|^--color|^--brand|primary|accent|secondary/i.test(name);
      bump(hex, custom ? 60 : isKit ? 10 : 1);
      if (isKit) kitColors.push({ name, hex, custom });
    }
    if (/font-family/i.test(name)) {
      const fam = String(value).split(',')[0].replace(/["']/g, '').trim();
      if (fam && fam.length < 34 && !/^(var|inherit|sans-serif|serif)/i.test(fam)) fonts.add(fam);
    }
  }

  for (const bucket of sheet.index.values()) {
    for (const rule of bucket) {
      const d = rule.decls;
      if (d.color) bump(normColor(resolveVar(sheet, d.color.value)));
      if (d['background-color']) bump(normColor(resolveVar(sheet, d['background-color'].value)), 2.5);
      if (d['font-family']) {
        const fam = String(resolveVar(sheet, d['font-family'].value)).split(',')[0].replace(/["']/g, '').trim();
        if (
          fam &&
          fam.length < 34 &&
          !/^(inherit|initial|unset|var|sans-serif|serif|monospace|system-ui|-apple-system|blinkmacsystemfont|ui-|emoji)/i.test(fam)
        )
          fonts.add(fam);
      }
    }
  }

  (rawHtml.match(/fonts\.googleapis\.com\/css2?\?([^"'>]+)/g) || []).forEach((u) => {
    (u.match(/family=([^&:"']+)/g) || []).forEach((f) =>
      fonts.add(decodeURIComponent(f.replace('family=', '')).replace(/\+/g, ' ').split(':')[0])
    );
  });

  const colors = [...colorCount.entries()]
    .map(([hex, count]) => ({ hex, count: Math.round(count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const chroma = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return Math.max(r, g, b) - Math.min(r, g, b);
  };
  const brand = colors.filter((c) => chroma(c.hex) > 28 && !WP_DEFAULT_PALETTE.has(c.hex));
  // Custom Elementor kit slots are the most reliable brand signal of all.
  const customKit = kitColors.filter((k) => k.custom && chroma(k.hex) > 28 && !WP_DEFAULT_PALETTE.has(k.hex));
  if (customKit.length) {
    const order = customKit.map((k) => k.hex);
    brand.sort((a, b) => {
      const ia = order.indexOf(a.hex);
      const ib = order.indexOf(b.hex);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }

  return {
    colors,
    fonts: [...fonts].slice(0, 10),
    primary: (brand[0] || colors[0] || { hex: '#3644EE' }).hex,
    secondary: (brand[1] || colors[1] || { hex: '#111111' }).hex,
    kitColors: kitColors.slice(0, 14),
  };
}

/* ------------------------------------------------------------------ */
/* Alignment / layout resolution                                       */
/* ------------------------------------------------------------------ */

function alignFromClasses(el) {
  const c = cls(el);
  let m = c.match(/elementor-align-(left|center|right|justify)/);
  if (m) return m[1];
  m = c.match(/elementor-nav-menu__align-(start|center|end)/);
  if (m) return m[1] === 'start' ? 'left' : m[1] === 'end' ? 'right' : 'center';
  m = c.match(/elementor-icon-list--layout-(inline)/);
  if (/has-text-align-center|text-center|text-align-center|centered\b/.test(c)) return 'center';
  if (/has-text-align-right|text-right|text-align-right/.test(c)) return 'right';
  if (/has-text-align-left|text-left|text-align-left/.test(c)) return 'left';
  return '';
}

function resolveAlign(sheet, el, fallback = 'left') {
  let node = el;
  for (let i = 0; i < 4 && node && node.nodeType === 1; i++) {
    const fromCls = alignFromClasses(node);
    if (fromCls) return fromCls;
    const cs = computedStyle(sheet, node);
    const ta = (cs['text-align'] || '').toLowerCase();
    if (ta && ta !== 'start' && ta !== 'inherit') return ta === 'end' ? 'right' : ta;
    if (ta === 'start') return 'left';
    // flex containers map their main/cross axis to visual alignment
    if (/flex/i.test(cs.display || '')) {
      const dir = /column/.test((cs['flex-direction'] || '').toLowerCase());
      const val = (dir ? cs['align-items'] || '' : cs['justify-content'] || '').toLowerCase();
      if (/center/.test(val)) return 'center';
      if (/flex-end|end|right/.test(val)) return 'right';
      if (!dir && /flex-start|start|left/.test(val)) return 'left';
    }
    node = node.parentNode;
  }
  return fallback;
}

function backgroundOf(sheet, el, base) {
  const cs = computedStyle(sheet, el);
  const color = normColor(cs['background-color']) || normColor(cs.background);
  const image =
    bgImageFrom(cs['background-image'], base) ||
    bgImageFrom(cs.background, base) ||
    (/(jpe?g|png|webp|avif)/i.test(attr(el, 'data-bg') || '') ? abs(attr(el, 'data-bg'), base) : '');
  return { color, image };
}

/* ------------------------------------------------------------------ */
/* Widget factory                                                      */
/* ------------------------------------------------------------------ */

function makeWidget(type, label, settings, preview) {
  return {
    id: uid(),
    elType: 'widget',
    widgetType: type,
    settings,
    elements: [],
    isInner: false,
    __label: label,
    __preview: preview,
  };
}

function typo(prefix, o) {
  const out = {};
  const has = ['size', 'weight', 'family', 'lineHeight', 'letter', 'transform', 'style'].some((k) => o[k]);
  if (!has) return out;
  out[`${prefix}typography`] = 'custom';
  if (o.size) out[`${prefix}font_size`] = { unit: 'px', size: Math.round(o.size), sizes: [] };
  if (o.weight) out[`${prefix}font_weight`] = String(o.weight);
  if (o.family) out[`${prefix}font_family`] = o.family;
  if (o.lineHeight) out[`${prefix}line_height`] = { unit: 'em', size: Math.round(o.lineHeight * 100) / 100, sizes: [] };
  if (o.letter) out[`${prefix}letter_spacing`] = { unit: 'px', size: o.letter, sizes: [] };
  if (o.transform && o.transform !== 'none') out[`${prefix}text_transform`] = o.transform;
  if (o.style && o.style !== 'normal') out[`${prefix}font_style`] = o.style;
  return out;
}

function typoFrom(sheet, el, defSize) {
  const cs = computedStyle(sheet, el);
  const family = (cs['font-family'] || '').split(',')[0].replace(/["']/g, '').trim();
  const lhRaw = cs['line-height'];
  let lineHeight = null;
  if (lhRaw) {
    const bare = String(lhRaw).trim().match(/^([\d.]+)$/);
    if (bare) lineHeight = parseFloat(bare[1]);
    else {
      const p = px(lhRaw);
      const size = px(cs['font-size']) || defSize || 16;
      if (p) lineHeight = Math.round((p / size) * 100) / 100;
    }
  }
  return {
    size: px(cs['font-size']) || defSize || null,
    weight: cs['font-weight'] && /^\d+$/.test(cs['font-weight']) ? cs['font-weight'] : cs['font-weight'] === 'bold' ? 700 : null,
    family: family && !/^(inherit|var|initial)/i.test(family) ? family : null,
    lineHeight,
    letter: px(cs['letter-spacing']),
    transform: cs['text-transform'],
    style: cs['font-style'],
    color: normColor(cs.color),
  };
}

function escapeHtml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitiseInline(html, base) {
  return String(html)
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/href="(\/[^"]*)"/gi, (_m, p) => `href="${abs(p, base)}"`)
    .replace(/\s+/g, ' ')
    .trim();
}

function paddingSettings(sides, fallbackTop, fallbackBottom) {
  const t = sides.top ?? fallbackTop;
  const b = sides.bottom ?? fallbackBottom;
  const r = sides.right ?? 20;
  const l = sides.left ?? 20;
  return { unit: 'px', top: String(Math.round(t)), right: String(Math.round(r)), bottom: String(Math.round(b)), left: String(Math.round(l)), isLinked: false };
}

/* ------------------------------------------------------------------ */
/* Native Elementor extraction                                         */
/* ------------------------------------------------------------------ */

const ELEMENTOR_WIDGET_LABEL = {
  heading: 'Heading',
  'text-editor': 'Text Editor',
  image: 'Image',
  button: 'Button',
  'icon-list': 'Icon List',
  'nav-menu': 'Nav Menu',
  'icon-box': 'Icon Box',
  'image-carousel': 'Image Carousel',
  form: 'Form',
  video: 'Video',
  divider: 'Divider',
  spacer: 'Spacer',
  'social-icons': 'Social Icons',
  counter: 'Counter',
  tabs: 'Tabs',
  accordion: 'Accordion',
  toggle: 'Toggle',
  testimonial: 'Testimonial',
  'star-rating': 'Star Rating',
  'progress-bar': 'Progress Bar',
  'google_maps': 'Google Maps',
  html: 'HTML',
  shortcode: 'Shortcode',
  'theme-post-title': 'Post Title',
  'theme-post-featured-image': 'Featured Image',
  'loop-carousel': 'Loop Carousel',
  template: 'Template',
  'icon': 'Icon',
  'text-path': 'Text Path',
};

const hasToken = (el, token) => cls(el).split(/\s+/).includes(token);

const isWidgetEl = (el) => attr(el, 'data-element_type') === 'widget' || hasToken(el, 'elementor-widget');

function widgetTypeOf(el) {
  const raw = attr(el, 'data-widget_type');
  if (raw) return raw.split('.')[0];
  const m = cls(el)
    .split(/\s+/)
    .map((c) => c.match(/^elementor-widget-([a-z0-9_-]+)$/))
    .find((x) => x && x[1] !== 'wrap' && x[1] !== 'container');
  return m ? m[1] : '';
}

function containerOf(el) {
  return el.querySelector('.elementor-widget-container') || el;
}

function widgetWidthOf(sheet, el) {
  const c = cls(el);
  if (/elementor-widget__width-auto/.test(c)) return { mode: 'auto' };
  if (/elementor-widget__width-inherit/.test(c)) return { mode: 'full' };
  const cs = computedStyle(sheet, el);
  // Widgets displayed inline-block size to their content — keep them compact.
  if (/inline-block|inline-flex/.test(cs.display || '')) return { mode: 'auto' };
  const p = pct(cs.width) ?? pct(cs['max-width']);
  if (p && p < 99) return { mode: 'pct', value: Math.round(p) };
  return { mode: 'full' };
}

function convertNativeWidget(el, ctx) {
  const type = widgetTypeOf(el);
  const box = containerOf(el);
  const base = ctx.base;
  const sheet = ctx.sheet;
  const width = widgetWidthOf(sheet, el);
  const label = ELEMENTOR_WIDGET_LABEL[type] || type || 'Widget';

  const finish = (w) => {
    if (!w) return null;
    w.__width = width;
    w.__preview = { ...(w.__preview || {}), align: w.__align || 'left', width };
    return w;
  };

  switch (type) {
    case 'heading':
    case 'theme-post-title': {
      const h = box.querySelector('h1,h2,h3,h4,h5,h6') || box.querySelector('.elementor-heading-title') || box;
      const title = clean(h.text);
      if (!title) return null;
      const tag = /^H[1-6]$/.test(h.tagName) ? h.tagName : 'H2';
      const t = typoFrom(sheet, h, DEFAULT_HEAD_SIZE[tag]);
      const align = resolveAlign(sheet, el, resolveAlign(sheet, h, 'left'));
      const w = makeWidget(
        'heading',
        `${label} (${tag})`,
        {
          title,
          header_size: tag.toLowerCase(),
          align,
          title_color: t.color || '',
          ...typo('typography_', t),
        },
        { kind: 'heading', text: title, level: Number(tag[1]), color: t.color, size: t.size, weight: t.weight, family: t.family }
      );
      w.__align = align;
      return finish(w);
    }

    case 'text-editor': {
      const inner = box.innerHTML || '';
      const text = clean(box.text);
      if (!text) return null;
      const t = typoFrom(sheet, box, 16);
      const align = resolveAlign(sheet, el, resolveAlign(sheet, box, 'left'));
      const w = makeWidget(
        'text-editor',
        label,
        {
          editor: sanitiseInline(inner, base) || `<p>${escapeHtml(text)}</p>`,
          align,
          text_color: t.color || '',
          ...typo('typography_', t),
        },
        { kind: 'text', text, color: t.color, size: t.size }
      );
      w.__align = align;
      return finish(w);
    }

    case 'image':
    case 'theme-post-featured-image': {
      const img = box.querySelector('img');
      if (!img) return null;
      const url = imageSrc(img, base);
      if (!url || isTracker(url)) return null;
      const link = box.querySelector('a');
      const alt = clean(attr(img, 'alt'));
      const natW = parseInt(attr(img, 'width') || '0') || null;
      const cs = computedStyle(sheet, img);
      const cssW = px(cs.width) || px(cs['max-width']) || natW;
      const align = resolveAlign(sheet, el, 'center');
      const opRaw = computedStyle(sheet, box).opacity ?? cs.opacity;
      const imgOpacity = opRaw !== undefined && opRaw !== '' && !Number.isNaN(parseFloat(opRaw)) ? Math.round(parseFloat(opRaw) * 100) / 100 : null;
      ctx.assets.push({ type: 'image', url, alt });
      const w = makeWidget(
        'image',
        label,
        {
          image: { url, id: '', alt, source: 'library' },
          image_size: 'full',
          align,
          ...(cssW && cssW < 1200 ? { width: { unit: 'px', size: Math.round(cssW), sizes: [] } } : {}),
          ...(link ? { link_to: 'custom', link: { url: abs(attr(link, 'href'), base), is_external: 'true', nofollow: '' } } : {}),
          ...(imgOpacity !== null && imgOpacity < 0.99 ? { _elx_opacity: imgOpacity } : {}),
        },
        { kind: 'image', url, text: alt, natWidth: cssW || natW, opacity: imgOpacity }
      );
      w.__align = align;
      return finish(w);
    }

    case 'button': {
      const a = box.querySelector('a.elementor-button') || box.querySelector('a,button');
      if (!a) return null;
      const textEl = a.querySelector('.elementor-button-text') || a;
      const text = clean(textEl.text);
      if (!text) return null;
      const cs = computedStyle(sheet, a);
      const t = typoFrom(sheet, a, 15);
      const bg = normColor(cs['background-color']) || normColor(cs.background) || ctx.design.primary;
      const fg = t.color || '#FFFFFF';
      const radius = px(cs['border-radius']);
      const pad = boxOf(cs, 'padding');
      const align = resolveAlign(sheet, el, 'left');
      const w = makeWidget(
        'button',
        label,
        {
          text,
          link: { url: abs(attr(a, 'href'), base), is_external: 'true', nofollow: '' },
          align,
          size: 'sm',
          background_color: bg,
          button_text_color: fg,
          ...(radius !== null
            ? { border_radius: { unit: 'px', top: String(radius), right: String(radius), bottom: String(radius), left: String(radius), isLinked: true } }
            : {}),
          ...(pad.top !== null || pad.left !== null
            ? { text_padding: paddingSettings(pad, 12, 12) }
            : {}),
          ...typo('typography_', t),
        },
        { kind: 'button', text, url: abs(attr(a, 'href'), base), bg, fg, radius }
      );
      w.__align = align;
      return finish(w);
    }

    case 'icon-list': {
      const items = box.querySelectorAll('.elementor-icon-list-item');
      const list = (items.length ? items : box.querySelectorAll('li')).slice(0, 24);
      if (!list.length) return null;
      const inline = /elementor-icon-list--layout-inline|elementor-inline-items/.test(cls(el) + ' ' + (box.innerHTML || '').slice(0, 400));
      const entries = list
        .map((li) => {
          const txt = clean((li.querySelector('.elementor-icon-list-text') || li).text);
          const a = li.querySelector('a');
          return { text: txt, url: a ? abs(attr(a, 'href'), base) : '' };
        })
        .filter((e) => e.text);
      if (!entries.length) return null;
      // Icon colour: explicit svg fill wins, then the icon slot's css colour,
      // then the item's computed text colour, then the brand primary.
      const svgEl = box.querySelector('svg');
      const iconSlot = box.querySelector('.elementor-icon-list-icon');
      const firstItem = box.querySelector('.elementor-icon-list-item a, .elementor-icon-list-item');
      let iconColor = '';
      if (svgEl) iconColor = normColor(attr(svgEl.querySelector('path') || svgEl, 'fill'));
      if (!iconColor && iconSlot) iconColor = normColor(computedStyle(sheet, iconSlot).color);
      const itemColor = firstItem ? normColor(computedStyle(sheet, firstItem).color) : '';
      if (!iconColor) iconColor = itemColor;
      const align = resolveAlign(sheet, el, inline ? 'center' : 'left');
      const t = typoFrom(sheet, box, 15);
      const textColor = normColor(computedStyle(sheet, box.querySelector('.elementor-icon-list-text') || box).color) || itemColor || t.color;
      const finalIcon = iconColor || ctx.design.primary;
      const w = makeWidget(
        'icon-list',
        `${label}${inline ? ' (inline)' : ''}`,
        {
          view: inline ? 'inline' : 'traditional',
          icon_list: entries.map((e) => ({
            _id: uid(),
            text: e.text,
            selected_icon: { value: 'fas fa-check', library: 'fa-solid' },
            link: { url: e.url, is_external: 'true', nofollow: '' },
          })),
          space_between: { unit: 'px', size: inline ? 40 : 12, sizes: [] },
          icon_color: finalIcon,
          ...(textColor ? { text_color: textColor } : {}),
          align,
          ...typo('icon_typography_', t),
        },
        { kind: 'list', items: entries.map((e) => e.text), inline, iconColor: finalIcon, color: textColor || t.color }
      );
      w.__align = align;
      return finish(w);
    }

    case 'nav-menu': {
      const nav = box.querySelector('nav') || box;
      const topLis = (nav.querySelector('ul') ? nav.querySelector('ul').childNodes : []).filter((n) => n.nodeType === 1 && n.tagName === 'LI');
      const entries = (topLis.length ? topLis : nav.querySelectorAll('li')).slice(0, 14).map((li) => {
        const a = li.querySelector('a');
        const subs = li.querySelectorAll('.sub-menu a, ul a').map((x) => textVisibleOnly(sheet, x)).filter(Boolean);
        return {
          text: (a ? textVisibleOnly(sheet, a) : textVisibleOnly(sheet, li)).split('\n')[0],
          url: a ? abs(attr(a, 'href'), base) : '',
          children: subs.slice(0, 10),
        };
      }).filter((e) => e.text);
      if (!entries.length) return null;
      const align = resolveAlign(sheet, el, 'right');
      const topLink = (topLis.length && topLis[0].querySelector(':scope > a')) || nav.querySelector('a');
      const t = typoFrom(sheet, topLink || nav, 15);
      const w = makeWidget(
        'nav-menu',
        label,
        {
          menu: 'primary',
          layout: /vertical/.test(cls(box)) ? 'vertical' : 'horizontal',
          align_items: align === 'right' ? 'end' : align === 'center' ? 'center' : 'start',
          ...typo('menu_typography_', t),
          color_menu_item: t.color || '',
          // carried for the faithful HTML renderer; Elementor ignores unknown keys
          _elx_menu_items: entries.map((e) => ({ text: e.text, url: e.url, children: e.children || [] })),
        },
        { kind: 'menu', items: entries, align, color: t.color }
      );
      w.__align = align;
      return finish(w);
    }

    case 'icon-box': {
      const title = clean((box.querySelector('.elementor-icon-box-title') || {}).text || '');
      const desc = clean((box.querySelector('.elementor-icon-box-description') || {}).text || '');
      const svg = box.querySelector('svg');
      const img = box.querySelector('img');
      const align = resolveAlign(sheet, el, 'center');
      const iconUrl = img ? imageSrc(img, base) : '';
      if (iconUrl) ctx.assets.push({ type: 'image', url: iconUrl, alt: title });
      const w = makeWidget(
        'icon-box',
        label,
        {
          title_text: title,
          description_text: desc,
          position: /elementor-position-left/.test(cls(el)) ? 'left' : /elementor-position-right/.test(cls(el)) ? 'right' : 'top',
          text_align: align,
          selected_icon: { value: 'fas fa-star', library: 'fa-solid' },
          primary_color: ctx.design.primary,
          ...(iconUrl ? { _elx_icon_image: iconUrl } : {}),
        },
        { kind: 'iconbox', text: title, desc, iconUrl, hasSvg: !!svg }
      );
      w.__align = align;
      return finish(w);
    }

    case 'image-carousel': {
      const imgs = box.querySelectorAll('img').map((i) => imageSrc(i, base)).filter((u) => u && !isTracker(u));
      const unique = [...new Set(imgs)];
      if (!unique.length) return null;
      unique.forEach((u) => ctx.assets.push({ type: 'image', url: u, alt: 'Carousel slide' }));
      // Elementor sliders carry their real config in data-settings — respect
      // it instead of guessing, so hero banners stay one-slide full-width.
      const ds = { ...dataSettingsOf(el), ...dataSettingsOf(box) };
      // rendered height keeps full-bleed heroes from collapsing to thumbnails;
      // themes usually size the slider wrapper, not the widget container.
      const wrapEl =
        box.querySelector('.elementor-image-carousel-wrapper, .swiper-container, .swiper, .slick-list, .slides') || box;
      const hcs = computedStyle(sheet, wrapEl);
      const slideH =
        px(hcs.height) ||
        px(hcs['min-height']) ||
        px(computedStyle(sheet, box).height) ||
        px(computedStyle(sheet, box)['min-height']) ||
        px(computedStyle(sheet, el)['min-height']);
      // no explicit config → mimic Elementor's own default (3-up strip) unless
      // the slider is clearly a full-bleed hero (big computed wrapper height).
      let slidesToShow = String(ds.slides_to_show || ds.slidesToShow || '');
      if (!slidesToShow) slidesToShow = slideH && slideH >= 300 ? '1' : unique.length >= 3 ? '3' : '1';
      const navigation = ds.navigation || 'both';
      const autoplay = ds.autoplay === 'no' ? 'no' : 'yes';
      // captions: any heading/figcaption living beside the slide image
      const slideScopes = box.querySelectorAll('.swiper-slide, .slick-slide, figure, .elementor-carousel-image');
      const captions = unique.map((u) => {
        const scope = slideScopes.find((sc) => imageSrc(sc.querySelector('img') || {}, base) === u);
        if (!scope) return '';
        const h = scope.querySelector('figcaption, h1,h2,h3,h4,h5,h6, .elementor-image-carousel-caption, .caption');
        return h ? textVisibleOnly(sheet, h) : '';
      });
      const captionsAny = captions.some(Boolean);
      const w = makeWidget(
        'image-carousel',
        `${label} (${unique.length})`,
        {
          carousel: unique.map((u) => ({ id: '', url: u })),
          slides_to_show: slidesToShow,
          navigation,
          autoplay,
          image_size: 'full',
          ...(captionsAny ? { _elx_captions: captions } : {}),
          ...(slideH && slideH >= 140 ? { _elx_slide_height: Math.round(slideH) } : {}),
        },
        { kind: 'carousel', images: unique, captions, slideHeight: slideH || null }
      );
      w.__align = 'center';
      return finish(w);
    }

    case 'image-gallery': {
      // captions: only text that was actually visible on the page (a real
      // figcaption). Alt text is metadata — never paint it as an overlay.
      const items = box.querySelectorAll('img')
        .map((i) => {
          const fig = i.closest('figure');
          const cap = fig && fig.querySelector('figcaption') ? textVisibleOnly(sheet, fig.querySelector('figcaption')) : '';
          return { url: imageSrc(i, base), alt: clean(attr(i, 'alt')), caption: clean(cap) };
        })
        .filter((x) => x.url && !isTracker(x.url));
      const seen = new Set();
      const unique = items.filter((x) => !seen.has(x.url) && seen.add(x.url));
      if (!unique.length) return null;
      unique.slice(0, 18).forEach((x) => ctx.assets.push({ type: 'image', url: x.url, alt: x.alt || 'Gallery image' }));
      const gridHost = box.querySelector('[class*="gallery-grid-columns-"]') || box;
      const gridCols = /gallery-grid-columns-(\d)/.exec(cls(gridHost) + ' ' + cls(gridHost.parent));
      const w = makeWidget(
        'image-gallery',
        `${label} (${unique.length})`,
        {
          gallery_columns: gridCols ? gridCols[1] : '3',
          gallery_link: 'none',
          _elx_gallery: unique.slice(0, 18),
        },
        { kind: 'gallery', images: unique.map((x) => x.url), captions: unique.map((x) => x.caption) }
      );
      w.__align = 'center';
      return finish(w);
    }

    case 'loop-carousel': {
      const cards = box.querySelectorAll('[data-elementor-type="loop-item"]').slice(0, 8).map((c) => ({
        title: clean((c.querySelector('h1,h2,h3,h4,h5,h6') || {}).text || ''),
        image: imageSrc(c.querySelector('img') || {}, base),
      }));
      const imgs = cards.map((c) => c.image).filter(Boolean);
      imgs.forEach((u) => ctx.assets.push({ type: 'image', url: u, alt: 'Loop item' }));
      const w = makeWidget(
        'loop-carousel',
        `${label} (${cards.length})`,
        { template_id: '', slides_to_show: '3', autoplay: 'yes', _elx_loop_cards: cards },
        { kind: 'loop', cards }
      );
      w.__align = 'center';
      return finish(w);
    }

    case 'form': {
      const form = box.querySelector('form') || box;
      const fields = form.querySelectorAll('input,textarea,select').filter((f) => !/hidden|submit|button/i.test(attr(f, 'type')));
      const submit = form.querySelector('button,[type=submit]');
      const align = resolveAlign(sheet, el, 'left');
      const w = makeWidget(
        ctx.pro ? 'form' : 'shortcode',
        ctx.pro ? `${label} (${fields.length} fields)` : `Form placeholder (${fields.length} fields)`,
        ctx.pro
          ? {
              form_name: clean(attr(form, 'name')) || 'Cloned Form',
              form_fields: fields.slice(0, 12).map((f) => ({
                _id: uid(),
                field_type: /textarea/i.test(f.tagName) ? 'textarea' : attr(f, 'type') || 'text',
                field_label: clean(attr(f, 'placeholder') || attr(f, 'name') || 'Field'),
                placeholder: clean(attr(f, 'placeholder')),
                required: attr(f, 'required') ? 'true' : '',
                width: '100',
              })),
              button_text: clean(submit ? submit.text : '') || 'Submit',
              button_align: align,
            }
          : { shortcode: '[contact-form-7 id="1" title="Cloned Form"]' },
        {
          kind: 'form',
          count: fields.length,
          fields: fields.slice(0, 8).map((f) => clean(attr(f, 'placeholder') || attr(f, 'name') || 'field')),
          submit: clean(submit ? submit.text : '') || 'Submit',
        }
      );
      w.__align = align;
      return finish(w);
    }

    case 'divider': {
      const cs = computedStyle(sheet, box.querySelector('.elementor-divider-separator') || box);
      const w = makeWidget(
        'divider',
        label,
        {
          style: 'solid',
          weight: { unit: 'px', size: px(cs['border-width']) || 1, sizes: [] },
          color: normColor(cs['border-color']) || '#E0E0E0',
          gap: { unit: 'px', size: 20, sizes: [] },
        },
        { kind: 'divider' }
      );
      w.__align = 'center';
      return finish(w);
    }

    case 'spacer': {
      const cs = computedStyle(sheet, box.querySelector('.elementor-spacer-inner') || box);
      const h = px(cs.height) || 50;
      const w = makeWidget('spacer', label, { space: { unit: 'px', size: Math.round(h), sizes: [] } }, { kind: 'spacer', height: h });
      return finish(w);
    }

    case 'video': {
      const iframe = box.querySelector('iframe');
      const video = box.querySelector('video');
      const src = iframe ? abs(attr(iframe, 'src') || attr(iframe, 'data-src'), base) : video ? abs(attr(video, 'src'), base) : '';
      if (!src) return null;
      const yt = /youtube|youtu\.be/i.test(src);
      const w = makeWidget(
        'video',
        `${label}${yt ? ' (YouTube)' : ''}`,
        yt ? { video_type: 'youtube', youtube_url: src, aspect_ratio: '169' } : { video_type: 'hosted', hosted_url: { url: src } },
        { kind: 'video', url: src }
      );
      return finish(w);
    }

    case 'google_maps': {
      const iframe = box.querySelector('iframe');
      const src = iframe ? abs(attr(iframe, 'src'), base) : '';
      const w = makeWidget('google_maps', label, { address: src, zoom: { unit: 'px', size: 12 }, height: { unit: 'px', size: 400 } }, { kind: 'map', url: src });
      return finish(w);
    }

    case 'social-icons': {
      const links = box.querySelectorAll('a').map((a) => abs(attr(a, 'href'), base)).filter(Boolean);
      if (!links.length) return null;
      const w = makeWidget(
        'social-icons',
        `${label} (${links.length})`,
        {
          social_icon_list: links.slice(0, 10).map((u) => ({
            _id: uid(),
            social_icon: { value: 'fab fa-link', library: 'fa-brands' },
            link: { url: u, is_external: 'true' },
          })),
          shape: 'circle',
        },
        { kind: 'social', items: links }
      );
      w.__align = resolveAlign(sheet, el, 'center');
      return finish(w);
    }

    case 'template': {
      const inner = clean(box.text).slice(0, 140);
      const w = makeWidget('template', label, { template_id: '' }, { kind: 'template', text: inner });
      return finish(w);
    }

    default: {
      // Unknown widget: keep its content faithfully as generic blocks
      const html = box.innerHTML || '';
      const text = clean(box.text);
      const img = box.querySelector('img');
      if (img && !text) {
        const url = imageSrc(img, base);
        if (url && !isTracker(url)) {
          ctx.assets.push({ type: 'image', url, alt: clean(attr(img, 'alt')) });
          const w = makeWidget(
            'image',
            `Image (from ${type || 'block'})`,
            { image: { url, id: '', alt: clean(attr(img, 'alt')), source: 'library' }, image_size: 'full', align: 'center' },
            { kind: 'image', url, text: clean(attr(img, 'alt')) }
          );
          w.__align = 'center';
          return finish(w);
        }
      }
      if (!text && !html.trim()) return null;

      // Image-rich unknown block with no headings → a gallery grid, not a blob.
      const allImgs = box.querySelectorAll('img').map((i) => imageSrc(i, base)).filter((u) => u && !isTracker(u));
      const uniqImgs = [...new Set(allImgs)];
      if (uniqImgs.length >= 3 && !box.querySelector('h1,h2,h3,h4,h5,h6')) {
        uniqImgs.slice(0, 18).forEach((u) => ctx.assets.push({ type: 'image', url: u, alt: 'Gallery image' }));
        const w = makeWidget(
          'image-gallery',
          `Gallery (from ${type || 'block'})`,
          { gallery_columns: '3', gallery_link: 'none', _elx_gallery: uniqImgs.slice(0, 18).map((u) => ({ url: u, caption: '' })) },
          { kind: 'gallery', images: uniqImgs }
        );
        w.__align = 'center';
        return finish(w);
      }

      // Unknown / third-party widget (premium cards, custom blocks…) — expand
      // its real children into native widgets instead of an HTML dump, so
      // texts keep their computed colours and images keep their sizes.
      const subCtx = { base, sheet, design: ctx.design, assets: ctx.assets, pro: ctx.pro, sectionType: ctx.sectionType, seen: new Set() };
      const extracted = genericWidgets(box, subCtx, 0, []);
      if (extracted.length) {
        const card = cardStyleOf(sheet, el) || cardStyleOf(sheet, box);
        if (card && (card.bg || card.borderW)) {
          // card chrome preserved as an inner row with the card's own
          // background/radius/shadow — stacked widgets keep one visual card.
          const blocks = extracted.map((w) => ({ kind: 'widget', widget: w }));
          return {
            kind: 'row',
            columns: [
              {
                blocks,
                width: 100,
                align: extractColumnAlign(extracted),
                valign: 'flex-start',
                background: { color: card.bg, image: '' },
                radius: card.radius || 0,
                shadow: card.shadow || '',
                borderW: card.borderW || 0,
                borderCol: card.borderCol || '',
                padding: card.padding,
              },
            ],
            background: { color: '', image: '' },
            gap: 16,
            alignItems: 'flex-start',
          };
        }
        return extracted.map((w) => ({ kind: 'widget', widget: w }));
      }

      const align = resolveAlign(sheet, el, 'left');
      const w = makeWidget(
        'html',
        `${label} → HTML`,
        { html: sanitiseInline(html, base).slice(0, 6000) },
        { kind: 'raw', text: text.slice(0, 240), widget: type }
      );
      w.__align = align;
      return finish(w);
    }
  }
}


function extractColumnAlign(widgets) {
  const a = widgets.map((w) => w.__align).find((x) => x === 'center' || x === 'right');
  return a || 'left';
}

function asBlocks(converted) {
  if (!converted) return [];
  if (Array.isArray(converted)) return converted;
  if (converted.kind === 'row' || converted.kind === 'widget') return [converted];
  return [{ kind: 'widget', widget: converted }];
}
// Walks a column and returns an ordered list of blocks.
// A block is either { kind:'widget', widget } or { kind:'row', columns:[...] }
// so nested Elementor inner-sections keep their real multi-column layout.
function collectNativeBlocks(colEl, ctx, depth = 0) {
  const out = [];
  const sheet = ctx.sheet;

  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType !== 1 || SKIP_TAGS.has(child.tagName)) continue;
      const cs = computedStyle(sheet, child);
      if (isHidden(cs, child)) continue;
      if (isDecorOverlay(sheet, child)) continue;

      if (isWidgetEl(child)) {
        const type = widgetTypeOf(child);
        // Template widgets embed another Elementor document — expand it inline.
        if (type === 'template' && depth < 3) {
          const inner = child.querySelector('[data-elementor-type]');
          if (inner) {
            const secs = topSections(inner, sheet);
            if (secs.length) {
              secs.forEach((s) => {
                const row = nativeRow(s, ctx, depth + 1);
                if (row) out.push(row);
              });
              continue;
            }
          }
        }
        const converted = convertNativeWidget(child, ctx);
        asBlocks(converted).forEach((b) => out.push(b));
        continue;
      }

      const et = attr(child, 'data-element_type');
      const isInnerSection =
        et === 'section' || et === 'container' || hasToken(child, 'elementor-inner-section') || hasToken(child, 'e-child');

      if (isInnerSection && depth < 4) {
        const row = nativeRow(child, ctx, depth + 1);
        if (row) out.push(row);
        continue;
      }

      walk(child);
    }
  };

  walk(colEl);
  return out;
}

// Build a row descriptor (columns with widths/alignment) from a section element.
function nativeRow(sectionEl, ctx, depth) {
  const sheet = ctx.sheet;
  const colEls = sectionColumns(sectionEl, sheet);
  const columns = [];

  colEls.forEach((colEl) => {
    const blocks = collectNativeBlocks(colEl, ctx, depth);
    if (!blocks.length) return;
    columns.push({
      blocks,
      width: colWidthOf(sheet, colEl) ?? null,
      align: resolveAlign(sheet, colEl.querySelector('.elementor-widget-wrap') || colEl, 'left'),
      background: backgroundOf(sheet, colEl, ctx.base),
      valign: verticalAlignOf(sheet, colEl),
    });
  });

  if (!columns.length) return null;
  normaliseWidths(columns);

  const cs = computedStyle(sheet, sectionEl);
  const container = sectionEl.querySelector('.elementor-container') || sectionEl.querySelector('.e-con-inner');
  const gapCls = (cls(container || sectionEl).match(/elementor-column-gap-(\w+)/) || [])[1];
  const gapMap = { no: 0, narrow: 10, extended: 30, wide: 40, wider: 60, default: 20 };

  return {
    kind: 'row',
    columns,
    background: backgroundOf(sheet, sectionEl, ctx.base),
    padding: boxOf(cs, 'padding'),
    gap: gapMap[gapCls] ?? 20,
    alignItems: sectionAlignItems(sheet, sectionEl, container),
  };
}

function normaliseWidths(columns) {
  const known = columns.filter((c) => c.width);
  const sum = known.reduce((a, c) => a + c.width, 0);
  if (known.length !== columns.length || Math.abs(sum - 100) > 8) {
    const even = Math.round((100 / columns.length) * 100) / 100;
    columns.forEach((c) => (c.width = even));
  }
}

function verticalAlignOf(sheet, colEl) {
  const wrap = colEl.querySelector('.elementor-widget-wrap') || colEl;
  const cs = computedStyle(sheet, wrap);
  const ai = (cs['align-items'] || cs['align-content'] || '').toLowerCase();
  if (/center/.test(ai)) return 'center';
  if (/flex-end|end/.test(ai)) return 'flex-end';
  return 'flex-start';
}

function sectionAlignItems(sheet, sectionEl, container) {
  const c = cls(sectionEl);
  if (/elementor-section-content-middle/.test(c)) return 'center';
  if (/elementor-section-content-bottom/.test(c)) return 'flex-end';
  const cs = computedStyle(sheet, container || sectionEl);
  const ai = (cs['align-items'] || '').toLowerCase();
  if (/center/.test(ai)) return 'center';
  if (/flex-end|end/.test(ai)) return 'flex-end';
  return 'flex-start';
}

function colWidthOf(sheet, colEl) {
  const m = cls(colEl).match(/elementor-col-(\d+)/);
  if (m) return Number(m[1]);
  const cs = computedStyle(sheet, colEl);
  const p = pct(cs.width);
  if (p) return Math.round(p);
  return null;
}

function nativeRegions(root, sheet) {
  const all = root.querySelectorAll('[data-elementor-type]');
  const wanted = all.filter((r) => {
    const t = attr(r, 'data-elementor-type');
    if (t === 'popup' || t === 'loop-item') return false;
    // skip regions nested inside another kept region
    let p = r.parentNode;
    while (p && p.nodeType === 1) {
      const pt = attr(p, 'data-elementor-type');
      if (pt && pt !== 'popup' && pt !== 'loop-item') return false;
      p = p.parentNode;
    }
    const cs = computedStyle(sheet, r);
    if (isHidden(cs, r)) return false;
    return true;
  });

  const order = { header: 0, 'wp-page': 1, page: 1, section: 1, single: 1, archive: 1, footer: 2 };
  return wanted
    .map((r, i) => ({ el: r, type: attr(r, 'data-elementor-type'), i }))
    .sort((a, b) => (order[a.type] ?? 1) - (order[b.type] ?? 1) || a.i - b.i);
}

function topSections(regionEl, sheet) {
  const out = [];
  const walk = (node, depth) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType !== 1 || SKIP_TAGS.has(child.tagName)) continue;
      const et = attr(child, 'data-element_type');
      const isSection =
        et === 'section' || et === 'container' || hasToken(child, 'elementor-top-section') || hasToken(child, 'e-parent');
      if (isSection) {
        const cs = computedStyle(sheet, child);
        if (!isHidden(cs, child)) out.push(child);
        continue;
      }
      if (depth < 5) walk(child, depth + 1);
    }
  };
  walk(regionEl, 0);
  return out;
}

function sectionColumns(sectionEl, sheet) {
  const container =
    sectionEl.querySelector('.elementor-container') ||
    sectionEl.querySelector('.e-con-inner') ||
    sectionEl;
  const cols = [];
  const walk = (node, depth) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType !== 1 || SKIP_TAGS.has(child.tagName)) continue;
      const et = attr(child, 'data-element_type');
      if (et === 'column' || hasToken(child, 'elementor-column')) {
        const cs = computedStyle(sheet, child);
        if (!isHidden(cs, child)) cols.push(child);
        continue;
      }
      if (et === 'container') {
        const cs = computedStyle(sheet, child);
        if (!isHidden(cs, child)) cols.push(child);
        continue;
      }
      if (depth < 3) walk(child, depth + 1);
    }
  };
  walk(container, 0);
  return cols.length ? cols : [container];
}

function classifyNative(sectionEl, regionType, index, widgets) {
  if (regionType === 'header') return 'header';
  if (regionType === 'footer') return 'footer';
  const c = idClass(sectionEl);
  const kinds = widgets.map((w) => w.widgetType);
  const heads = kinds.filter((k) => k === 'heading').length;
  const imgs = kinds.filter((k) => k === 'image').length;

  if (/hero|banner|slider|carousel-main/.test(c) || kinds.includes('image-carousel')) return 'hero';
  if (kinds.includes('form')) return 'contact';
  if (kinds.includes('nav-menu')) return 'header';
  if (/testimonial|review/.test(c)) return 'testimonials';
  if (/pricing|plan/.test(c)) return 'pricing';
  if (/faq|accordion/.test(c) || kinds.includes('accordion') || kinds.includes('toggle')) return 'faq';
  if (kinds.filter((k) => k === 'icon-box').length >= 2) return 'features';
  if (/client|logo|partner|brand|gallery/.test(c) && imgs >= 2) return 'gallery';
  if (/cta|call-to-action|subscribe/.test(c) || (kinds.includes('button') && heads >= 1 && widgets.length <= 4)) return 'cta';
  if (/counter|stat|achievement/.test(c) || kinds.includes('counter')) return 'stats';
  if (kinds.includes('loop-carousel') || (imgs >= 3 && heads >= 2)) return 'features';
  if (imgs >= 3) return 'gallery';
  if (heads >= 1) return 'content';
  return 'block';
}

/* ------------------------------------------------------------------ */
/* Generic (non-Elementor) extraction                                  */
/* ------------------------------------------------------------------ */

function elementKids(el) {
  return (el.childNodes || []).filter((n) => n.nodeType === 1 && !SKIP_TAGS.has(n.tagName));
}

function visibleKids(el, sheet) {
  return elementKids(el).filter((n) => !isHidden(computedStyle(sheet, n), n));
}

function meaningful(el) {
  const t = clean(el.text);
  const imgs = el.querySelectorAll ? el.querySelectorAll('img').length : 0;
  return t.length > 2 || imgs > 0;
}

function unwrap(el, sheet, maxDepth = 4) {
  let cur = el;
  for (let i = 0; i < maxDepth; i++) {
    const kids = visibleKids(cur, sheet);
    const ownText = clean((cur.childNodes || []).filter((n) => n.nodeType === 3).map((n) => n.text).join(' '));
    if (kids.length === 1 && !ownText && !/^(IMG|A|BUTTON|UL|OL|H[1-6]|P|TABLE|FORM|NAV)$/.test(kids[0].tagName)) cur = kids[0];
    else break;
  }
  return cur;
}

function genericWidgets(node, ctx, depth = 0, out = []) {
  if (depth > 14 || out.length >= 45) return out;
  const sheet = ctx.sheet;

  for (const child of node.childNodes || []) {
    if (out.length >= 45) break;

    if (child.nodeType === 3) {
      const t = clean(child.text);
      if (t.length > 24 && !ctx.seen.has(t.toLowerCase())) {
        ctx.seen.add(t.toLowerCase());
        const w = makeWidget('text-editor', 'Text Editor', { editor: `<p>${escapeHtml(t)}</p>`, align: 'left' }, { kind: 'text', text: t, align: 'left' });
        w.__align = 'left';
        out.push(w);
      }
      continue;
    }
    if (child.nodeType !== 1 || SKIP_TAGS.has(child.tagName)) continue;
    const cs = computedStyle(sheet, child);
    if (isHidden(cs, child)) continue;
    if (isDecorOverlay(sheet, child)) continue;

    const tag = child.tagName;
    const align = resolveAlign(sheet, child, 'left');
    const push = (w) => {
      if (!w) return;
      w.__align = align;
      w.__preview = { ...(w.__preview || {}), align };
      out.push(w);
    };

    if (/^H[1-6]$/.test(tag)) {
      const title = clean(child.text);
      if (!title || ctx.seen.has('h:' + title.toLowerCase())) continue;
      ctx.seen.add('h:' + title.toLowerCase());
      ctx.seen.add(title.toLowerCase());
      const t = typoFrom(sheet, child, DEFAULT_HEAD_SIZE[tag]);
      push(
        makeWidget(
          'heading',
          `Heading (${tag})`,
          { title, header_size: tag.toLowerCase(), align, title_color: t.color || '', ...typo('typography_', t) },
          { kind: 'heading', text: title, level: Number(tag[1]), color: t.color, size: t.size, weight: t.weight }
        )
      );
      continue;
    }

    if (tag === 'IMG') {
      const url = imageSrc(child, ctx.base);
      const w = parseInt(attr(child, 'width') || '0');
      if (!url || isTracker(url) || (w && w <= 3) || ctx.seen.has('img:' + url)) continue;
      ctx.seen.add('img:' + url);
      const alt = clean(attr(child, 'alt'));
      ctx.assets.push({ type: 'image', url, alt });
      const cssW = px(cs.width) || px(cs['max-width']) || w || null;
      push(
        makeWidget(
          'image',
          'Image',
          {
            image: { url, id: '', alt, source: 'library' },
            image_size: 'full',
            align: align === 'left' ? 'center' : align,
            ...(cssW && cssW < 1200 ? { width: { unit: 'px', size: Math.round(cssW), sizes: [] } } : {}),
          },
          { kind: 'image', url, text: alt, natWidth: cssW }
        )
      );
      continue;
    }

    if (tag === 'PICTURE' || tag === 'FIGURE') {
      const img = child.querySelector('img');
      if (img) {
        const url = imageSrc(img, ctx.base);
        if (!url || isTracker(url) || ctx.seen.has('img:' + url)) continue;
        ctx.seen.add('img:' + url);
        const alt = clean(attr(img, 'alt'));
        ctx.assets.push({ type: 'image', url, alt });
        const ics = computedStyle(sheet, img);
        const capEl = child.querySelector('figcaption');
        // a figcaption is visible text sitting on the image — preserve it as
        // an overlay caption together with the image's own crop/radius.
        const cap = capEl ? textVisibleOnly(sheet, capEl) : '';
        const cssW = px(ics.width) || px(ics['max-width']) || parseInt(attr(img, 'width') || '0', 10) || null;
        const cssH = px(ics.height);
        const rad = px(ics['border-radius']);
        push(
          makeWidget(
            'image',
            'Image',
            {
              image: { url, id: '', alt, source: 'library' },
              image_size: 'full',
              align: align === 'left' ? 'center' : align,
              ...(cssW && cssW < 1200 ? { width: { unit: 'px', size: Math.round(cssW), sizes: [] } } : {}),
              ...(cssH && cssH >= 40 ? { _elx_img_height: Math.round(cssH) } : {}),
              ...(rad ? { _elx_img_radius: Math.round(rad) } : {}),
              ...(cap ? { _elx_caption: cap } : {}),
            },
            { kind: 'image', url, text: cap || alt, natWidth: cssW, imgHeight: cssH || null }
          )
        );
        continue;
      }
    }

    if (tag === 'IFRAME') {
      const src = abs(attr(child, 'src') || attr(child, 'data-src'), ctx.base);
      if (!src) continue;
      if (/youtube|youtu\.be/i.test(src))
        push(makeWidget('video', 'Video (YouTube)', { video_type: 'youtube', youtube_url: src, aspect_ratio: '169' }, { kind: 'video', url: src }));
      else if (/vimeo/i.test(src)) push(makeWidget('video', 'Video (Vimeo)', { video_type: 'vimeo', vimeo_url: src }, { kind: 'video', url: src }));
      else if (/google\.com\/maps|maps\.google/i.test(src))
        push(makeWidget('google_maps', 'Google Map', { address: src, zoom: { unit: 'px', size: 12 }, height: { unit: 'px', size: 400 } }, { kind: 'map', url: src }));
      else push(makeWidget('html', 'Embed (HTML)', { html: `<iframe src="${src}" width="100%" height="420" frameborder="0"></iframe>` }, { kind: 'embed', url: src }));
      continue;
    }

    if (tag === 'VIDEO') {
      const inner = child.querySelector('source');
      const src = abs(attr(child, 'src') || attr(inner, 'src'), ctx.base);
      push(makeWidget('video', 'Video (Self hosted)', { video_type: 'hosted', hosted_url: { url: src }, autoplay: 'yes', loop: 'yes', mute: 'yes' }, { kind: 'video', url: src }));
      continue;
    }

    if (tag === 'NAV') {
      const links = child.querySelectorAll('a').slice(0, 14);
      const entries = links.map((a) => ({ text: clean(a.text), url: abs(attr(a, 'href'), ctx.base), children: [] })).filter((e) => e.text);
      if (entries.length >= 2) {
        ctx.seen.add('nav');
        entries.forEach((e) => ctx.seen.add(e.text.toLowerCase()));
        push(
          makeWidget(
            'nav-menu',
            'Nav Menu',
            {
              menu: 'primary',
              layout: 'horizontal',
              align_items: align === 'right' ? 'end' : align === 'center' ? 'center' : 'start',
              _elx_menu_items: entries.map((e) => ({ text: e.text, url: e.url, children: [] })),
            },
            { kind: 'menu', items: entries, align }
          )
        );
        continue;
      }
    }

    if (tag === 'UL' || tag === 'OL') {
      const direct = elementKids(child).filter((n) => n.tagName === 'LI');
      const items = (direct.length ? direct : child.querySelectorAll('li')).slice(0, 24);
      const texts = items.map((li) => clean(li.text)).filter(Boolean).map((t) => (t.length > 90 ? t.slice(0, 90) + '…' : t));
      if (!texts.length) continue;
      const listKey = 'list:' + texts.join('|').slice(0, 300).toLowerCase();
      if (ctx.seen.has(listKey)) continue;
      ctx.seen.add(listKey);
      const links = child.querySelectorAll('a');
      const isNav =
        links.length >= 3 && texts.every((t) => t.length < 34) && (ctx.sectionType === 'header' || ctx.sectionType === 'footer' || /menu|nav/.test(idClass(child)));
      texts.forEach((t) => ctx.seen.add(t.toLowerCase()));
      const inline = /inline|flex/i.test(cs.display || '') || /inline/.test(cls(child));
      if (isNav) {
        const navEntries = texts.map((t, i) => ({ text: t, url: links[i] ? abs(attr(links[i], 'href'), ctx.base) : '', children: [] }));
        push(
          makeWidget(
            'nav-menu',
            'Nav Menu',
            {
              menu: 'primary',
              layout: 'horizontal',
              align_items: align === 'right' ? 'end' : align === 'center' ? 'center' : 'start',
              _elx_menu_items: navEntries,
            },
            { kind: 'menu', items: navEntries, align }
          )
        );
      } else {
        push(
          makeWidget(
            'icon-list',
            inline ? 'Icon List (inline)' : 'Icon List',
            {
              view: inline ? 'inline' : 'traditional',
              icon_list: texts.map((t, i) => ({
                _id: uid(),
                text: t,
                selected_icon: { value: 'fas fa-check', library: 'fa-solid' },
                link: { url: links[i] ? abs(attr(links[i], 'href'), ctx.base) : '', is_external: '', nofollow: '' },
              })),
              space_between: { unit: 'px', size: inline ? 40 : 12, sizes: [] },
              icon_color: ctx.design.primary,
              ...(normColor(cs.color) ? { text_color: normColor(cs.color) } : {}),
              align,
            },
            { kind: 'list', items: texts, inline, iconColor: ctx.design.primary, color: normColor(cs.color) || undefined }
          )
        );
      }
      continue;
    }

    if (tag === 'P' || tag === 'BLOCKQUOTE') {
      const t = clean(child.text);
      if (!t || ctx.seen.has(t.toLowerCase())) continue;
      ctx.seen.add(t.toLowerCase());
      const ty = typoFrom(sheet, child, 16);
      const innerHtml = child.innerHTML && child.innerHTML.length < 4000 ? child.innerHTML : escapeHtml(t);
      push(
        tag === 'BLOCKQUOTE'
          ? makeWidget('blockquote', 'Blockquote', { blockquote_content: t, blockquote_skin: 'border' }, { kind: 'text', text: t })
          : makeWidget(
              'text-editor',
              'Text Editor',
              { editor: `<p>${sanitiseInline(innerHtml, ctx.base)}</p>`, align, text_color: ty.color || '', ...typo('typography_', ty) },
              { kind: 'text', text: t, color: ty.color, size: ty.size }
            )
      );
      continue;
    }

    if (tag === 'BUTTON' || (tag === 'A' && !child.querySelector('img') && !child.querySelector('h1,h2,h3,h4,h5,h6'))) {
      const t = clean(child.text);
      const href = abs(attr(child, 'href'), ctx.base);
      const looksButton = /btn|button|cta|elementor-button|wp-block-button/.test(idClass(child)) || px(cs['border-radius']) !== null;
      if (!t) continue;
      if (t.length > 60 || (!looksButton && t.length > 34)) {
        if (!ctx.seen.has(t.toLowerCase())) {
          ctx.seen.add(t.toLowerCase());
          push(makeWidget('text-editor', 'Text Editor', { editor: `<p>${escapeHtml(t)}</p>`, align }, { kind: 'text', text: t }));
        }
        continue;
      }
      if (ctx.seen.has('btn:' + t.toLowerCase())) continue;
      ctx.seen.add('btn:' + t.toLowerCase());
      ctx.seen.add(t.toLowerCase());
      const ty = typoFrom(sheet, child, 15);
      const bg = normColor(cs['background-color']) || normColor(cs.background) || ctx.design.primary;
      const radius = px(cs['border-radius']);
      push(
        makeWidget(
          'button',
          'Button',
          {
            text: t,
            link: { url: href, is_external: 'true', nofollow: '' },
            align,
            size: 'sm',
            background_color: bg,
            button_text_color: ty.color || '#FFFFFF',
            ...(radius !== null
              ? { border_radius: { unit: 'px', top: String(radius), right: String(radius), bottom: String(radius), left: String(radius), isLinked: true } }
              : {}),
            ...typo('typography_', ty),
          },
          { kind: 'button', text: t, url: href, bg, fg: ty.color || '#FFFFFF', radius }
        )
      );
      continue;
    }

    if (tag === 'HR') {
      push(
        makeWidget(
          'divider',
          'Divider',
          { style: 'solid', weight: { unit: 'px', size: 1, sizes: [] }, color: '#E0E0E0', gap: { unit: 'px', size: 20, sizes: [] } },
          { kind: 'divider' }
        )
      );
      continue;
    }

    if (tag === 'TABLE') {
      push(makeWidget('html', 'Table (HTML)', { html: (child.outerHTML || '').slice(0, 8000) }, { kind: 'table', text: clean(child.text).slice(0, 120) }));
      continue;
    }

    if (tag === 'FORM') {
      const fields = child.querySelectorAll('input,textarea,select').filter((f) => !/hidden|submit|button/i.test(attr(f, 'type')));
      const submit = child.querySelector('button,[type=submit]');
      push(
        ctx.pro
          ? makeWidget(
              'form',
              `Form (${fields.length} fields)`,
              {
                form_name: 'Cloned Form',
                form_fields: fields.slice(0, 12).map((f) => ({
                  _id: uid(),
                  field_type: /textarea/i.test(f.tagName) ? 'textarea' : attr(f, 'type') || 'text',
                  field_label: clean(attr(f, 'placeholder') || attr(f, 'name') || 'Field'),
                  placeholder: clean(attr(f, 'placeholder')),
                  required: attr(f, 'required') ? 'true' : '',
                  width: '100',
                })),
                button_text: clean(submit ? submit.text : '') || 'Submit',
              },
              { kind: 'form', count: fields.length, fields: fields.slice(0, 8).map((f) => clean(attr(f, 'placeholder') || attr(f, 'name') || 'field')), submit: clean(submit ? submit.text : '') || 'Submit' }
            )
          : makeWidget('shortcode', `Form placeholder (${fields.length} fields)`, { shortcode: '[contact-form-7 id="1" title="Cloned Form"]' }, { kind: 'form', count: fields.length, fields: [], submit: 'Submit' })
      );
      continue;
    }

    genericWidgets(child, ctx, depth + 1, out);
  }
  return out;
}

function genericColumns(sectionEl, sheet) {
  const inner = unwrap(sectionEl, sheet, 5);
  const kids = visibleKids(inner, sheet).filter(meaningful);
  const cs = computedStyle(sheet, inner);
  const flexRow = /flex/i.test(cs.display || '') && !/column/i.test(cs['flex-direction'] || '');
  const grid = /grid/i.test(cs.display || '');
  const rowish = /row|grid|flex|columns|col-wrap|cards|d-flex|elementor-container|wp-block-columns/.test(idClass(inner));

  if (kids.length >= 2 && kids.length <= 6) {
    if (flexRow || grid || rowish || kids.every((k) => !/^(H[1-6]|P|A|IMG|SPAN|BR|BUTTON)$/.test(k.tagName))) {
      return kids.map((k) => {
        const kcs = computedStyle(sheet, k);
        return { el: k, width: pct(kcs.width) ? Math.round(pct(kcs.width)) : null };
      });
    }
  }
  return [{ el: inner, width: 100 }];
}

function pickRoot(body, sheet) {
  const cands = ['main', '#main', '#content', '#primary', '.site-main', '#brx-content'];
  let best = body;
  let bestLen = clean(body.text).length * 0.55;
  for (const sel of cands) {
    let el = null;
    try {
      el = body.querySelector(sel);
    } catch {
      el = null;
    }
    if (!el) continue;
    const len = clean(el.text).length;
    if (len > bestLen) {
      best = el;
      bestLen = len;
    }
  }
  return best;
}

function weight(el) {
  const text = clean(el.text).length;
  const imgs = el.querySelectorAll ? el.querySelectorAll('img').length : 0;
  const heads = el.querySelectorAll ? el.querySelectorAll('h1,h2,h3,h4,h5,h6').length : 0;
  return text + imgs * 90 + heads * 60;
}

function genericSections(body, sheet, limit) {
  const chosen = [];
  const header = body.querySelector('header');
  const footer = body.querySelector('footer');
  const root = pickRoot(body, sheet);

  let pool = visibleKids(root, sheet).filter(meaningful);
  let guard = 0;
  while (pool.length <= 2 && guard < 4) {
    const next = [];
    pool.forEach((p) => {
      const kids = visibleKids(p, sheet).filter(meaningful);
      if (kids.length > 1) next.push(...kids);
      else next.push(p);
    });
    if (next.length === pool.length) break;
    pool = next;
    guard++;
  }

  // split oversized blocks
  for (let round = 0; round < 3; round++) {
    if (pool.length >= limit) break;
    const next = [];
    let changed = false;
    for (const el of pool) {
      const heavy = weight(el) > 1400 || (el.querySelectorAll && el.querySelectorAll('h2,h3').length >= 3);
      if (!heavy) {
        next.push(el);
        continue;
      }
      const target = unwrap(el, sheet, 3);
      const kids = visibleKids(target, sheet).filter(meaningful);
      // A uniform row of 2-6 similar children is a columns layout (cards,
      // features, team grid) — never split it into orphan sections.
      const tcs = computedStyle(sheet, target);
      const rowLayout =
        kids.length >= 2 &&
        kids.length <= 6 &&
        (/flex|grid/i.test(tcs.display || '') ||
          kids.every((k) => k.tagName === kids[0].tagName && weight(k) > 60 && weight(k) < 2600));
      if (!rowLayout && kids.length >= 2 && kids.length <= 12 && kids.some((k) => weight(k) > 200)) {
        next.push(...kids);
        changed = true;
      } else next.push(el);
    }
    if (!changed) break;
    pool = next;
  }
  pool = pool.filter((el) => weight(el) > 20);

  if (header && !pool.includes(header) && meaningful(header)) chosen.push(header);
  pool.forEach((p) => {
    if (p !== header && p !== footer) chosen.push(p);
  });
  if (footer && !chosen.includes(footer) && meaningful(footer)) chosen.push(footer);
  return chosen.slice(0, limit);
}

function ancestorRegion(el) {
  let cur = el;
  for (let i = 0; i < 9 && cur; i++) {
    const tag = cur.tagName;
    const c = idClass(cur);
    if (tag === 'HEADER' || /site-header|masthead|main-header|elementor-location-header/.test(c)) return 'header';
    if (tag === 'FOOTER' || /site-footer|colophon|elementor-location-footer/.test(c)) return 'footer';
    cur = cur.parentNode;
  }
  return '';
}

function classifyGeneric(el, index, widgets) {
  const region = ancestorRegion(el);
  if (region) return region;
  const c = idClass(el);
  const kinds = widgets.map((w) => w.widgetType);
  const heads = kinds.filter((k) => k === 'heading').length;
  const imgs = kinds.filter((k) => k === 'image').length;
  const text = clean(el.text);

  if (/hero|banner|slider|swiper|jumbotron/.test(c) || (index <= 1 && heads > 0 && text.length > 40)) return 'hero';
  if (/testimonial|review|feedback/.test(c)) return 'testimonials';
  if (/pricing|plan|package/.test(c)) return 'pricing';
  if (/faq|accordion|toggle/.test(c)) return 'faq';
  if (kinds.includes('form') || kinds.includes('shortcode') || /contact|enquiry/.test(c)) return 'contact';
  if (/gallery|carousel|portfolio|logo|client|partner|brand/.test(c) && imgs >= 2) return 'gallery';
  if (/cta|call-to-action|subscribe|newsletter/.test(c)) return 'cta';
  if (/stat|counter|number|achievement/.test(c)) return 'stats';
  if (/feature|service|card|grid|product|benefit|why/.test(c) && heads >= 2) return 'features';
  if (imgs >= 3 && heads >= 2) return 'features';
  if (imgs >= 3) return 'gallery';
  if (heads >= 1 && text.length > 120) return 'content';
  if (text.length > 30) return 'text';
  return 'block';
}

const SECTION_NAMES = {
  header: 'Site Header',
  hero: 'Hero Banner',
  features: 'Feature Grid',
  gallery: 'Media Gallery',
  testimonials: 'Testimonials',
  pricing: 'Pricing Table',
  faq: 'FAQ / Accordion',
  contact: 'Contact Block',
  cta: 'Call To Action',
  stats: 'Stats Counter',
  content: 'Content Block',
  text: 'Text Block',
  footer: 'Site Footer',
  block: 'Generic Block',
};

const sectionLabel = (type, index) => `${String(index + 1).padStart(2, '0')} · ${SECTION_NAMES[type] || 'Section'}`;

/* ------------------------------------------------------------------ */
/* Intrinsic SVG dims                                                  */
/* ------------------------------------------------------------------ */

// <img src="*.svg"> without explicit width/height has no reliable intrinsic
// size: browsers fall back to 300x150 or stretch it to the column width —
// which is exactly why icons, logos and menu toggles used to blow up in the
// preview. Read the SVG header and set an explicit width on the widget.
function svgDimsFrom(text) {
  const m = String(text).match(/<svg\b[^>]*>/i);
  if (!m) return null;
  const tag = m[0];
  const numAttr = (name) => {
    const a = tag.match(new RegExp(name + '\\s*=\\s*["\']?([\\d.]+)(px)?["\']?', 'i'));
    return a ? parseFloat(a[1]) : null;
  };
  let w = numAttr('width');
  let h = numAttr('height');
  const isFrac = (v) => typeof v === 'number' && v > 0 && v < 2;
  if (w && isFrac(w)) w = null; // width="1" / "100%" style relative values are useless
  if (h && isFrac(h)) h = null;
  if (!w || !h) {
    const vb = tag.match(/viewBox\s*=\s*["']\s*([\d.,\-\s]+)["']/i);
    if (vb) {
      const p = vb[1].trim().split(/[\s,]+/).map(Number);
      if (p.length === 4 && p[2] > 0 && p[3] > 0) {
        if (!w && !h) {
          w = p[2];
          h = p[3];
        } else if (w && !h) h = (w * p[3]) / p[2];
        else if (h && !w) w = (h * p[2]) / p[3];
      }
    }
  }
  if (!w || !h || w <= 0 || h <= 0 || w > 2000 || h > 2000) return null;
  return { width: Math.round(w), height: Math.round(h) };
}

async function enrichSvgImageDims(builtSections) {
  const byUrl = new Map();
  const visit = (blocks) => {
    for (const b of blocks) {
      if (b.kind === 'widget') {
        const w = b.widget;
        if (!w || !w.settings) continue;
        const url = w.widgetType === 'image' ? w.settings.image && w.settings.image.url : w.settings._elx_icon_image;
        if (url && /\.svg([?#].*)?$/i.test(url) && !w.settings.width) {
          const key = url.split(/[?#]/)[0];
          if (!byUrl.has(key)) byUrl.set(key, []);
          byUrl.get(key).push(w);
        }
      } else if (b.kind === 'row') {
        b.columns.forEach((c) => visit(c.blocks));
      }
    }
  };
  builtSections.forEach((s) => s.columns.forEach((c) => visit(c.blocks)));
  const urls = [...byUrl.keys()].slice(0, 12);
  await Promise.all(
    urls.map(async (url) => {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(4000) });
        if (!r.ok) return;
        const text = (await r.text()).slice(0, 8000);
        const dims = svgDimsFrom(text);
        if (!dims) return;
        byUrl.get(url).forEach((w) => {
          w.settings.width = { unit: 'px', size: dims.width, sizes: [] };
          w.__preview = { ...(w.__preview || {}), natWidth: dims.width, natHeight: dims.height };
        });
      } catch {
        /* keep the widget as-is */
      }
    })
  );
}

/* ------------------------------------------------------------------ */
/* Elementor emitters                                                  */
/* ------------------------------------------------------------------ */

function stripMeta(w) {
  const { __label, __preview, __align, __width, ...rest } = w;
  const settings = { ...rest.settings };
  if (__width && __width.mode === 'auto') settings._element_width = 'auto';
  else if (__width && __width.mode === 'pct') {
    settings._element_custom_width = { unit: '%', size: __width.value, sizes: [] };
    settings._element_width = 'initial';
  }
  return { ...rest, settings };
}

function bgSettings(background) {
  const out = {};
  if (!background) return out;
  if (background.color) {
    out.background_background = 'classic';
    out.background_color = background.color;
  }
  if (background.image) {
    out.background_background = 'classic';
    out.background_image = { url: background.image, id: '', source: 'library' };
    out.background_position = 'center center';
    out.background_size = 'cover';
    out.background_repeat = 'no-repeat';
  }
  return out;
}


// Card chrome (radius, shadow, border, inner padding) recovered from premium
// card widgets — emitted as custom control keys the renderer paints, ignored
// by Elementor itself.
function cardSettings(c) {
  const out = {};
  if (!c) return out;
  if (c.radius) out._elx_radius = Math.round(c.radius);
  if (c.shadow) out._elx_shadow = c.shadow;
  if (c.borderW) out._elx_border = { width: c.borderW, color: c.borderCol || '#E4E4E4' };
  if (c.padding && (c.padding.top || c.padding.bottom || c.padding.left || c.padding.right)) {
    out.padding = paddingSettings(c.padding, 0, 0);
  }
  return out;
}

// Emit a column's blocks; nested rows become inner sections/containers.
function emitBlocks(blocks, mode) {
  const out = [];
  for (const b of blocks) {
    if (b.kind === 'widget') {
      out.push(stripMeta(b.widget));
      continue;
    }
    const cols = b.columns;
    if (mode === 'container') {
      out.push({
        id: uid(),
        elType: 'container',
        settings: {
          content_width: 'full',
          flex_direction: cols.length > 1 ? 'row' : 'column',
          flex_gap: { unit: 'px', size: b.gap ?? 20, column: String(b.gap ?? 20), row: String(b.gap ?? 20), isLinked: true },
          flex_wrap: 'wrap',
          flex_align_items: b.alignItems || 'flex-start',
          ...bgSettings(b.background),
        },
        elements: cols.map((c) => ({
          id: uid(),
          elType: 'container',
          settings: {
            content_width: 'full',
            width: { unit: '%', size: c.width, sizes: [] },
            flex_direction: 'column',
            flex_align_items: c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start',
            ...cardSettings(c),
            ...bgSettings(c.background),
          },
          elements: emitBlocks(c.blocks, mode),
          isInner: true,
        })),
        isInner: true,
      });
      continue;
    }
    out.push({
      id: uid(),
      elType: 'section',
      settings: {
        structure: `${Math.min(cols.length, 6)}0`,
        gap: 'default',
        content_position: b.alignItems === 'center' ? 'middle' : b.alignItems === 'flex-end' ? 'bottom' : 'top',
        ...bgSettings(b.background),
      },
      elements: cols.map((c) => ({
        id: uid(),
        elType: 'column',
        settings: {
          _column_size: Math.round(c.width),
          _inline_size: c.width,
          space_between_widgets: 16,
          ...(c.align && c.align !== 'left' ? { align: c.align } : {}),
          ...(c.valign && c.valign !== 'flex-start' ? { content_position: c.valign === 'center' ? 'center' : 'flex-end' } : {}),
          ...cardSettings(c),
          ...bgSettings(c.background),
        },
        elements: emitBlocks(c.blocks, mode),
        isInner: true,
      })),
      isInner: true,
    });
  }
  return out;
}

function buildSectionElement(sec, mode) {
  const cols = sec.columns;
  const bg = {};
  if (sec.background.color) {
    bg.background_background = 'classic';
    bg.background_color = sec.background.color;
  }
  if (sec.background.image) {
    bg.background_background = 'classic';
    bg.background_image = { url: sec.background.image, id: '', source: 'library' };
    bg.background_position = sec.background.position || 'center center';
    bg.background_size = sec.background.size || 'cover';
    bg.background_repeat = 'no-repeat';
  }

  const pad = sec.padding;
  const contentWidth = sec.contentWidth || 1140;

  if (mode === 'container') {
    return {
      id: uid(),
      elType: 'container',
      settings: {
        content_width: 'boxed',
        width: { unit: 'px', size: contentWidth, sizes: [] },
        flex_direction: cols.length > 1 ? 'row' : 'column',
        flex_gap: { unit: 'px', size: sec.gap ?? 20, column: String(sec.gap ?? 20), row: String(sec.gap ?? 20), isLinked: true },
        flex_wrap: 'wrap',
        flex_align_items: sec.alignItems || 'center',
        padding: pad,
        _title: sec.name,
        ...bg,
      },
      elements: cols.map((c) => ({
        id: uid(),
        elType: 'container',
        settings: {
          content_width: 'full',
          width: { unit: '%', size: c.width, sizes: [] },
          flex_direction: 'column',
          flex_gap: { unit: 'px', size: 16, column: '16', row: '16', isLinked: true },
          flex_align_items: c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start',
          ...(c.background && c.background.color ? { background_background: 'classic', background_color: c.background.color } : {}),
        },
        elements: emitBlocks(c.blocks, mode),
        isInner: true,
      })),
      isInner: false,
    };
  }

  return {
    id: uid(),
    elType: 'section',
    settings: {
      structure: `${Math.min(cols.length, 6)}0`,
      content_width: { unit: 'px', size: contentWidth, sizes: [] },
      gap: 'default',
      padding: pad,
      _title: sec.name,
      ...(sec.alignItems ? { content_position: sec.alignItems === 'center' ? 'middle' : sec.alignItems === 'flex-end' ? 'bottom' : 'top' } : {}),
      ...bg,
    },
    elements: cols.map((c) => ({
      id: uid(),
      elType: 'column',
      settings: {
        _column_size: Math.round(c.width),
        _inline_size: cols.length > 1 ? c.width : null,
        space_between_widgets: 16,
        ...(c.align && c.align !== 'left' ? { align: c.align } : {}),
        ...(c.valign && c.valign !== 'flex-start' ? { content_position: c.valign === 'center' ? 'center' : 'flex-end' } : {}),
        ...cardSettings(c),
        ...(c.background && c.background.color ? { background_background: 'classic', background_color: c.background.color } : {}),
      },
      elements: emitBlocks(c.blocks, mode),
      isInner: false,
    })),
    isInner: false,
  };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export async function cloneUrl(inputUrl, options = {}) {
  const started = Date.now();
  const mode = options.mode === 'container' ? 'container' : 'section';
  const pro = !!options.pro;
  const maxSections = Math.min(Math.max(parseInt(options.maxSections) || 30, 3), 60);

  let url = String(inputUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const parsed = new URL(url);

  const { html, finalUrl, via } = await fetchHtml(url);
  const root = parse(html, {
    lowerCaseTagName: false,
    comment: false,
    blockTextElements: { script: false, noscript: false, style: true, pre: true },
  });

  const base = finalUrl || url;
  const platform = detectPlatform(html);

  let sheet;
  try {
    sheet = await loadStyles(root, base, html, { maxSheets: options.maxSheets || 12 });
  } catch {
    sheet = createSheet();
  }

  const design = extractDesign(sheet, html);

  const titleEl = root.querySelector('title');
  const metaOf = (sel, at = 'content') => {
    const n = root.querySelector(sel);
    return n ? clean(attr(n, at)) : '';
  };
  const iconHref = metaOf('link[rel="icon"]', 'href') || metaOf('link[rel="shortcut icon"]', 'href') || metaOf('link[rel="apple-touch-icon"]', 'href');

  const meta = {
    url,
    finalUrl: base,
    host: parsed.host,
    title: titleEl ? clean(titleEl.text) : parsed.host,
    description: metaOf('meta[name="description"]') || metaOf('meta[property="og:description"]'),
    ogImage: abs(metaOf('meta[property="og:image"]'), base),
    favicon: iconHref ? abs(iconHref, base) : `https://www.google.com/s2/favicons?domain=${parsed.host}&sz=64`,
    lang: attr(root.querySelector('html') || root, 'lang') || 'en',
    platform,
    fetchedVia: via,
    cssSheets: sheet.stats ? sheet.stats.sheets : 0,
    cssRules: sheet.stats ? sheet.stats.rules : 0,
  };

  const body = root.querySelector('body') || root;
  root.querySelectorAll('script,noscript,template').forEach((n) => n.remove());
  body.querySelectorAll('.skip-link,.screen-reader-text').forEach((n) => n.remove());

  const assets = [];
  const built = [];
  const regions = nativeRegions(body, sheet);
  const native = regions.length > 0;

  if (native) {
    for (const region of regions) {
      const secs = topSections(region.el, sheet);
      for (const secEl of secs) {
        if (built.length >= maxSections) break;
        const ctx = { base, sheet, design, assets, pro, sectionType: region.type };
        const row = nativeRow(secEl, ctx, 0);
        if (!row) continue;

        const flatWidgets = [];
        const collect = (cols) =>
          cols.forEach((c) =>
            c.blocks.forEach((b) => (b.kind === 'widget' ? flatWidgets.push(b.widget) : collect(b.columns)))
          );
        collect(row.columns);
        if (!flatWidgets.length) continue;

        const cs = computedStyle(sheet, secEl);
        const isEdge = region.type === 'header' || region.type === 'footer';
        const container = secEl.querySelector('.elementor-container') || secEl.querySelector('.e-con-inner');
        const containerCs = container ? computedStyle(sheet, container) : {};
        const contentWidth = px(containerCs['max-width']) || px(cs['max-width']) || 1140;
        const stretched = /elementor-section-stretched|elementor-section-full_width|e-con-full/.test(cls(secEl));

        built.push({
          type: classifyNative(secEl, region.type, built.length, flatWidgets),
          columns: row.columns,
          background: row.background,
          padding: paddingSettings(row.padding, isEdge ? 10 : 60, isEdge ? 10 : 60),
          contentWidth: stretched ? 1600 : Math.round(Math.min(Math.max(contentWidth, 600), 1600)),
          gap: row.gap,
          alignItems: row.alignItems,
          native: true,
        });
      }
    }
  }

  if (!built.length) {
    const rawSections = genericSections(body, sheet, maxSections);
    rawSections.forEach((el, i) => {
      const cols = genericColumns(el, sheet);
      const columns = [];
      cols.forEach((c) => {
        const ctx = { base, sheet, design, assets, pro, sectionType: ancestorRegion(el) || 'block', seen: new Set() };
        const widgets = genericWidgets(c.el, ctx, 0, []);
        if (!widgets.length) return;
        columns.push({
          blocks: widgets.map((w) => ({ kind: 'widget', widget: w })),
          width: c.width,
          align: resolveAlign(sheet, c.el, 'left'),
          valign: verticalAlignOf(sheet, c.el),
          background: backgroundOf(sheet, c.el, base),
        });
      });
      if (!columns.length) return;
      normaliseWidths(columns);
      const cs = computedStyle(sheet, el);
      const padSides = boxOf(cs, 'padding');
      const region = ancestorRegion(el);
      const isEdge = region === 'header' || region === 'footer';
      built.push({
        type: classifyGeneric(
          el,
          i,
          columns.flatMap((c) => c.blocks.filter((b) => b.kind === 'widget').map((b) => b.widget))
        ),
        columns,
        background: backgroundOf(sheet, el, base),
        padding: paddingSettings(padSides, isEdge ? 20 : 60, isEdge ? 20 : 60),
        contentWidth: Math.round(Math.min(Math.max(px(cs['max-width']) || 1140, 600), 1600)),
        gap: px(cs.gap) ?? 20,
        alignItems: (cs['align-items'] || '').includes('center') ? 'center' : 'flex-start',
        native: false,
      });
    });

    // merge trivial single-widget blocks into the preceding section
    const merged = [];
    built.forEach((sec) => {
      const total = sec.columns.reduce((a, c) => a + c.blocks.length, 0);
      const prev = merged[merged.length - 1];
      if (prev && total <= 1 && sec.columns.length === 1 && !sec.background.image && prev.columns.length === 1 && prev.columns[0].blocks.length + total <= 40) {
        prev.columns[0].blocks.push(...sec.columns[0].blocks);
        return;
      }
      merged.push(sec);
    });
    built.length = 0;
    built.push(...merged);
  }

  // Recover intrinsic sizes for SVG images (icons, logos, menu toggles)
  // before the section/widget trees are serialised.
  try {
    await enrichSvgImageDims(built);
  } catch {
    /* non-critical */
  }

  const sections = [];
  const content = [];
  const byType = {};

  // Serialise a column tree for the UI preview (mirrors the emitted layout).
  const reportColumns = (cols, counter) =>
    cols.map((c) => ({
      width: c.width,
      align: c.align,
      valign: c.valign || 'flex-start',
      background: c.background,
      blocks: c.blocks.map((b) => {
        if (b.kind === 'widget') {
          counter.n++;
          byType[b.widget.widgetType] = (byType[b.widget.widgetType] || 0) + 1;
          return { kind: 'widget', type: b.widget.widgetType, label: b.widget.__label, preview: b.widget.__preview };
        }
        return {
          kind: 'row',
          gap: b.gap,
          alignItems: b.alignItems,
          background: b.background,
          columns: reportColumns(b.columns, counter),
        };
      }),
    }));

  built.slice(0, maxSections).forEach((raw, i) => {
    const sec = { ...raw, index: i, name: sectionLabel(raw.type, i) };
    content.push(buildSectionElement(sec, mode));

    const counter = { n: 0 };
    const columns = reportColumns(sec.columns, counter);

    // flat list kept for backwards-compatible views
    const flat = [];
    const walk = (cols, ci = 0) =>
      cols.forEach((c, idx) =>
        c.blocks.forEach((b) => {
          if (b.kind === 'widget') flat.push({ column: idx, type: b.type, label: b.label, preview: b.preview });
          else walk(b.columns, idx);
        })
      );
    walk(columns);

    sections.push({
      index: i,
      type: sec.type,
      name: sec.name,
      columnCount: sec.columns.length,
      columns,
      background: sec.background,
      padding: sec.padding,
      contentWidth: sec.contentWidth,
      gap: sec.gap,
      alignItems: sec.alignItems,
      widgetCount: counter.n,
      widgets: flat,
    });
  });

  const uniqAssets = [];
  const assetSeen = new Set();
  assets.forEach((a) => {
    if (!a.url || assetSeen.has(a.url)) return;
    assetSeen.add(a.url);
    uniqAssets.push(a);
  });

  const widgetsTotal = Object.values(byType).reduce((a, b) => a + b, 0);

  const elementor = {
    version: '0.4',
    title: (meta.title || 'Cloned Page').slice(0, 120),
    type: 'page',
    content,
    page_settings: { template: 'elementor_canvas', hide_title: 'yes', background_background: 'classic', background_color: '#FFFFFF' },
    metadata: {},
    generated_by: 'WebClonerELX 1.1',
    source: {
      url: base,
      host: meta.host,
      platform,
      cloned_at: new Date().toISOString(),
      structure_mode: mode === 'container' ? 'Flexbox Container (Elementor 3.16+)' : 'Section / Column (classic)',
      extraction: native ? 'native-elementor' : 'generic-dom',
      css_rules_resolved: meta.cssRules,
    },
    global_kit: {
      system_colors: [
        { _id: 'primary', title: 'Primary', color: design.primary },
        { _id: 'secondary', title: 'Secondary', color: design.secondary },
        { _id: 'text', title: 'Text', color: '#333333' },
        { _id: 'accent', title: 'Accent', color: (design.colors[2] || { hex: design.primary }).hex },
      ],
      system_typography: design.fonts.slice(0, 4).map((f, i) => ({
        _id: ['primary', 'secondary', 'text', 'accent'][i] || 'extra',
        title: ['Primary', 'Secondary', 'Text', 'Accent'][i] || 'Extra',
        typography_typography: 'custom',
        typography_font_family: f,
        typography_font_weight: i === 0 ? '700' : '400',
      })),
    },
  };

  return {
    ok: true,
    meta,
    design,
    options: { mode, pro, maxSections },
    stats: {
      sections: sections.length,
      widgets: widgetsTotal,
      images: uniqAssets.filter((a) => a.type === 'image').length,
      backgrounds: sections.filter((s) => s.background.image).length,
      byType,
      htmlKb: Math.round((html.length / 1024) * 10) / 10,
      jsonKb: Math.round((JSON.stringify(elementor).length / 1024) * 10) / 10,
      cssKb: sheet.stats ? Math.round((sheet.stats.bytes / 1024) * 10) / 10 : 0,
      cssRules: meta.cssRules,
      extraction: native ? 'native-elementor' : 'generic-dom',
      durationMs: Date.now() - started,
    },
    sections,
    assets: uniqAssets.slice(0, 240),
    elementor,
  };
}
