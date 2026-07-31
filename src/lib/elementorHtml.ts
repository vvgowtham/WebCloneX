/**
 * Elementor JSON → standalone HTML document renderer.
 *
 * Reproduces Elementor 3.x frontend output: the same DOM skeleton (section →
 * container → column → widget-wrap → widget-container) and generated per-id
 * CSS rules exactly like Elementor's own post CSS. The result is a faithful
 * "what-you-get-after-import" preview used for the side-by-side comparison.
 */

export type ElxSettings = Record<string, unknown>;

export interface ElxElement {
  id: string;
  elType: 'section' | 'column' | 'widget' | 'container';
  widgetType?: string;
  settings: ElxSettings;
  elements: ElxElement[];
  isInner?: boolean;
}

export interface RenderDesign {
  primary?: string;
  secondary?: string;
  fonts?: string[];
}

/* ---------------------------------------------------------------- helpers */

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

type Dim = { unit?: string; top?: string; right?: string; bottom?: string; left?: string; isLinked?: boolean; size?: string | number };

function dimCss(d: Dim | undefined): string | '' {
  if (!d || typeof d !== 'object') return '';
  const u = d.unit || 'px';
  const val = (x: unknown) => {
    const n = parseFloat(String(x ?? ''));
    return Number.isFinite(n) ? String(n) : '0';
  };
  return `${val(d.top)}${u} ${val(d.right)}${u} ${val(d.bottom)}${u} ${val(d.left)}${u}`;
}

function typoCss(s: ElxSettings, prefix: string): string {
  if (s[`${prefix}typography`] !== 'custom') return '';
  const out: string[] = [];
  const fam = s[`${prefix}font_family`];
  if (fam) out.push(`font-family:'${String(fam).replace(/'/g, '')}',sans-serif`);
  const fs = s[`${prefix}font_size`] as Dim | undefined;
  if (fs && fs.size !== undefined && fs.size !== '') out.push(`font-size:${fs.size}${fs.unit || 'px'}`);
  const lh = s[`${prefix}line_height`] as Dim | undefined;
  if (lh && lh.size !== undefined && lh.size !== '') out.push(`line-height:${lh.size}${lh.unit || 'em'}`);
  const ls = s[`${prefix}letter_spacing`] as Dim | undefined;
  if (ls && ls.size !== undefined && ls.size !== '') out.push(`letter-spacing:${ls.size}${ls.unit || 'px'}`);
  const fw = s[`${prefix}font_weight`];
  if (fw) out.push(`font-weight:${fw}`);
  const tt = s[`${prefix}text_transform`];
  if (tt === 'uppercase' || tt === 'lowercase' || tt === 'capitalize') out.push(`text-transform:${tt}`);
  const fst = s[`${prefix}font_style`];
  if (fst === 'italic' || fst === 'oblique') out.push(`font-style:${fst}`);
  return out.join(';');
}

function bgCss(s: ElxSettings): string {
  const out: string[] = [];
  if (s.background_background === 'classic') {
    if (s.background_color) out.push(`background-color:${s.background_color}`);
    const img = s.background_image as { url?: string } | undefined;
    if (img && img.url) {
      out.push(`background-image:url('${img.url}')`);
      out.push(`background-position:${s.background_position || 'center center'}`);
      out.push(`background-size:${s.background_size || 'cover'}`);
      out.push(`background-repeat:${s.background_repeat || 'no-repeat'}`);
    }
  }
  return out.filter(Boolean).join(';');
}

const alignToJustify = (a: string) => (a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start');

/* ------------------------------------------------------------------ icons */

const ICON_PATHS: Record<string, string> = {
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  phone:
    'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  envelope: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z',
  'map-marker':
    'M12 2C8.13 2 5 5.13 5 8.5c0 5.25 7 13 7 13s7-7.75 7-13C19 5.13 15.87 2 12 2zm0 9.5c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z',
  bars: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
  'arrow-right': 'M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z',
  'chevron-down': 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  home: 'M12 3 2 12h3v9h6v-6h2v6h6v-9h3z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.59 4.24 2.53-.75 1.23L11 13V6h2v6.59z',
  heart: 'M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  user: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  cart: 'M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45C4.52 15.37 5.48 17 7 17h12v-2H7l1.1-2h7.45c.75 0 1.41-.41 1.75-1.03L21 5.5h-2.25l-1.1 2h-8l-.9-1.5L7.5 2H1zm16 16c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  facebook: 'M13 22v-8h3l.5-4H13V7.5c0-1.1.4-1.9 2-1.9H17V2.2C16.4 2.15 15.3 2 14.1 2 11.5 2 10 3.6 10 6.3V10H6.5v4H10v8h3z',
  whatsapp: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7 6h-3a15.9 15.9 0 0 0-1.5-3.7A8.05 8.05 0 0 1 19 8zM12 4a14 14 0 0 1 2 4h-4a14 14 0 0 1 2-4zM5 8h3a15.9 15.9 0 0 1 1.5-3.7A8.05 8.05 0 0 0 5 8zm-2 4a8.2 8.2 0 0 1 .7-3h3.2a16.5 16.5 0 0 0 0 6H3.7a8.2 8.2 0 0 1-.7-3zm2 7h3a15.9 15.9 0 0 0 1.5 3.7A8.05 8.05 0 0 1 5 19zm7 1a14 14 0 0 1-2-4h4a14 14 0 0 1-2 4zm2.5 2.3A15.9 15.9 0 0 0 16 19h3a8.05 8.05 0 0 1-4.5 3.3zM17.1 15H6.9a16.5 16.5 0 0 1 0-6h10.2a16.5 16.5 0 0 1 0 6z',
};

function iconNameOf(value: string): string {
  const v = value.toLowerCase();
  if (/check/.test(v)) return 'check';
  if (/star/.test(v)) return 'star';
  if (/phone|call/.test(v)) return 'phone';
  if (/envelope|mail/.test(v)) return 'envelope';
  if (/map|location|pin/.test(v)) return 'map-marker';
  if (/bars|menu|hamburger/.test(v)) return 'bars';
  if (/arrow|chevron-right|angle-right/.test(v)) return 'arrow-right';
  if (/chevron-down|angle-down|caret/.test(v)) return 'chevron-down';
  if (/home|house/.test(v)) return 'home';
  if (/clock|time|history/.test(v)) return 'clock';
  if (/heart|like/.test(v)) return 'heart';
  if (/user|account|person/.test(v)) return 'user';
  if (/cart|bag|basket|shop/.test(v)) return 'cart';
  if (/facebook|fb/.test(v)) return 'facebook';
  if (/whatsapp/.test(v)) return 'whatsapp';
  if (/globe|link|share|external/.test(v)) return 'globe';
  return 'check';
}

function iconSvg(name: string, size = 14): string {
  if (name === 'instagram') {
    return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.2" fill="currentColor" stroke="none"/></svg>`;
  }
  if (name === 'twitter' || name === 'x') {
    return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 4l16 16M20 4L4 20"/></svg>`;
  }
  if (name === 'youtube') {
    return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9.2v5.6L15 12z" fill="#fff"/></svg>`;
  }
  if (name === 'linkedin') {
    return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="2" width="20" height="20" rx="4"/><text x="12" y="16.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#fff">in</text></svg>`;
  }
  const d = ICON_PATHS[name] || ICON_PATHS.check;
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${d}"/></svg>`;
}

const BRAND_ICONS: Array<[RegExp, string, string]> = [
  [/facebook|fb\.com/, 'facebook', '#1877F2'],
  [/instagram/, 'instagram', '#E1306C'],
  [/twitter|x\.com/, 'twitter', '#000000'],
  [/youtube|youtu\.be/, 'youtube', '#FF0000'],
  [/linkedin/, 'linkedin', '#0A66C2'],
  [/whatsapp/, 'whatsapp', '#25D366'],
  [/pinterest/, 'globe', '#E60023'],
  [/tiktok/, 'globe', '#000000'],
  [/discord/, 'globe', '#5865F2'],
];

/* -------------------------------------------------------------- base css */

function baseCss(primary: string): string {
  return `
:root{--elx-primary:${primary};}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#333;font-size:16px;line-height:1.6;background:#fff;-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;border:0;vertical-align:middle}
a{text-decoration:none;color:inherit;background:transparent}
p{margin:0 0 1em}p:last-child{margin-bottom:0}
ul,ol{margin:0;padding:0;list-style:none}
figure{margin:0}
.elementor{width:100%}
.elementor *,.elementor *:before,.elementor *:after{box-sizing:border-box}
.elementor-section{position:relative}
.elementor-container{display:flex;margin-right:auto;margin-left:auto;position:relative;width:100%;max-width:1140px}
.elementor-section-wrap:last-child{margin-bottom:-1px}
.elementor-column{min-height:1px;position:relative;display:flex;min-width:0}
.elementor-column-wrap{width:100%;position:relative;display:flex}
.elementor-widget-wrap{position:relative;width:100%;display:flex;flex-wrap:wrap;align-content:flex-start}
.elementor-widget{position:relative;min-width:0}
.elementor-widget-wrap>.elementor-element{width:100%}
.elementor-widget-wrap>.elementor-element.elementor-widget__width-auto{width:auto;max-width:100%}
.elementor-widget:not(:last-child){margin-block-end:20px}
.elementor-element-populated{flex-grow:1}
.elementor-heading-title{padding:0;margin:0;line-height:1.15;display:block}
.elementor-widget-text-editor .elementor-widget-container>:first-child{margin-top:0}
.elementor-widget-text-editor .elementor-widget-container>:last-child{margin-bottom:0}
.elementor-button-wrapper{display:block}
.elementor-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;line-height:1.3;text-align:center;font-weight:600;font-size:15px;padding:12px 24px;border:0;border-radius:3px;background:${primary};color:#fff;cursor:pointer;min-height:1em}
.elementor-icon-list-items{list-style:none}
.elementor-icon-list-item{display:flex;align-items:flex-start;gap:8px;width:100%}
.elementor-icon-list-item a{display:flex;align-items:flex-start;gap:8px}
.elementor-icon-list-icon{display:inline-flex;flex:none;align-self:center}
.elementor-icon-list-text{flex:1;align-self:center}
.elementor-inline-items{display:flex;flex-wrap:wrap}
.elementor-widget-nav-menu .elementor-nav-menu--main{display:flex;width:100%}
.elementor-nav-menu{display:flex;flex-wrap:wrap;margin:0;padding:0;list-style:none}
.elementor-nav-menu>li{position:relative;display:flex;align-items:center}
.elementor-nav-menu a{display:flex;align-items:center;gap:5px;line-height:1.4}
.elementor-nav-menu .sub-menu{display:none;position:absolute;top:100%;left:0;z-index:99;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.12);border-radius:4px;min-width:170px;padding:8px 0}
.elementor-nav-menu li:hover>.sub-menu{display:block}
.elementor-nav-menu .sub-menu li a{display:block;padding:8px 18px;font-size:.92em;white-space:nowrap;color:#222}
.elementor-icon-box-wrapper{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.elementor-icon-box-icon{display:inline-flex}
.elementor-icon-box-title{margin:0 0 2px;line-height:1.3}
.elementor-icon-box-description{margin:0;opacity:.85}
.elementor-divider{padding-top:15px;padding-bottom:15px}
.elementor-divider-separator{display:block}
.elementor-social-icons-wrapper{display:flex;flex-wrap:wrap;gap:8px}
.elementor-social-icon{display:inline-flex;align-items:center;justify-content:center;width:2em;height:2em;border-radius:50%;color:#fff;background:#7a7a7a;text-decoration:none;font-size:15px}
.elx-carousel{position:relative}
.elx-carousel-track{display:flex;overflow:hidden;width:100%}
.elx-carousel-track img{flex:1 1 0;min-width:0;object-fit:cover}
.elx-arrow{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;border:0;background:rgba(0,0,0,.45);color:#fff;font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2}
.elx-prev{left:10px}.elx-next{right:10px}
.elx-form-input{width:100%;border:1px solid #d5d8dd;background:#fff;border-radius:4px;padding:12px 16px;font-size:15px;color:#333;font-family:inherit;min-height:1.4em}
.elx-form-input:focus{outline:none;border-color:${primary}}
.elx-video{position:relative;width:100%;aspect-ratio:16/9;background:#000}
.elx-video iframe,.elx-video video{position:absolute;inset:0;width:100%;height:100%;border:0}
.elx-placeholder{border:1px dashed #c3c6cf;border-radius:6px;padding:18px;text-align:center;font:12px/1.5 ui-monospace,monospace;color:#7d7f8c;word-break:break-all;background:rgba(122,122,140,.05)}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:8px}
.e-con{--flex-direction:column;--flex-gap:0px;display:flex;flex-direction:var(--flex-direction);gap:var(--flex-gap);position:relative;width:100%;min-width:0}
.e-con-boxed>.e-con-inner{max-width:1140px;margin:0 auto;width:100%}
.e-con-inner{display:flex;flex-direction:var(--flex-direction);gap:var(--flex-gap);width:100%}
`;
}

/* ------------------------------------------------------------ widget css */

function widgetClass(w: ElxElement): string {
  const widthCls =
    w.settings._element_width === 'auto'
      ? ' elementor-widget__width-auto'
      : w.settings._element_width === 'initial'
        ? ' elementor-widget__width-initial'
        : '';
  return `elementor-element elementor-element-${w.id} elementor-widget elementor-widget-${w.widgetType}${widthCls}`;
}

/* Renders a widget: html + dynamic css appended into ctx.css */
function renderWidget(w: ElxElement, ctx: { css: string[]; design: RenderDesign }): string {
  const s = w.settings;
  const cls = widgetClass(w);
  const sel = `.elementor-element-${w.id}`;
  const type = w.widgetType || '';
  const primary = ctx.design.primary || '#3644EE';

  // per-widget common widths
  if (s._element_width === 'initial' && s._element_custom_width) {
    const cw = s._element_custom_width as Dim & { size?: number | string };
    ctx.css.push(`${sel}{width:${cw.size}%}`);
  }

  switch (type) {
    case 'heading': {
      const tag = /^h[1-6]$/.test(String(s.header_size)) ? String(s.header_size) : 'h2';
      const rules: string[] = [];
      if (s.title_color) rules.push(`color:${s.title_color}`);
      const typo = typoCss(s, 'typography_');
      if (typo) rules.push(typo);
      if (rules.length) ctx.css.push(`${sel} .elementor-heading-title{${rules.join(';')}}`);
      if (s.align) ctx.css.push(`${sel}{text-align:${s.align}}`);
      return `<div class="${cls}"><div class="elementor-widget-container"><${tag} class="elementor-heading-title">${esc(s.title)}</${tag}></div></div>`;
    }

    case 'text-editor': {
      const rules: string[] = [];
      if (s.text_color) rules.push(`color:${s.text_color}`);
      const typo = typoCss(s, 'typography_');
      if (typo) rules.push(typo);
      if (s.align) rules.push(`text-align:${s.align}`);
      if (rules.length) ctx.css.push(`${sel} .elementor-widget-container{${rules.join(';')}}`);
      return `<div class="${cls} elementor-widget-text-editor"><div class="elementor-widget-container">${String(s.editor || '')}</div></div>`;
    }

    case 'blockquote': {
      ctx.css.push(`${sel} blockquote{margin:0;padding:6px 0 6px 22px;border-left:4px solid ${primary};font-style:italic;font-size:1.15em}`);
      if (s.text_color) ctx.css.push(`${sel}{color:${s.text_color}}`);
      return `<div class="${cls}"><div class="elementor-widget-container"><blockquote>${esc(s.blockquote_content)}</blockquote></div></div>`;
    }

    case 'image': {
      const img = (s.image || {}) as { url?: string; alt?: string };
      if (!img.url) return '';
      const width = s.width as (Dim & { size?: number | string }) | undefined;
      if (width && width.size !== undefined && width.size !== '') {
        ctx.css.push(`${sel} img{width:${width.size}${width.unit || 'px'};max-width:100%}`);
      }
      const align = String(s.align || 'center');
      if (align === 'center') ctx.css.push(`${sel} .elementor-widget-container{text-align:center}`);
      else if (align === 'right') ctx.css.push(`${sel} .elementor-widget-container{text-align:right}`);
      const link = s.link as { url?: string } | undefined;
      const inner = `<img src="${esc(img.url)}" alt="${esc(img.alt || '')}" loading="eager">`;
      const linked =
        s.link_to === 'custom' && link?.url ? `<a href="${esc(link.url)}" target="_blank" rel="noreferrer">${inner}</a>` : inner;
      return `<div class="${cls}"><div class="elementor-widget-container">${linked}</div></div>`;
    }

    case 'button': {
      const bg = s.background_color || primary;
      const fg = s.button_text_color || '#fff';
      const rules = [`background-color:${bg}`, `color:${fg}`];
      const br = s.border_radius as Dim | undefined;
      if (br) rules.push(`border-radius:${dimCss(br)}`);
      const pad = s.text_padding as Dim | undefined;
      if (pad) rules.push(`padding:${dimCss(pad)}`);
      const typo = typoCss(s, 'typography_');
      if (typo) rules.push(typo);
      ctx.css.push(`${sel} .elementor-button{${rules.join(';')}}`);
      if (s.align) ctx.css.push(`${sel} .elementor-button-wrapper{text-align:${s.align}}`);
      const link = (s.link || {}) as { url?: string };
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elementor-button-wrapper"><a class="elementor-button" href="${esc(link.url || '#')}" target="_blank" rel="noreferrer"><span class="elementor-button-text">${esc(s.text)}</span></a></div></div></div>`;
    }

    case 'icon-list': {
      const items = (s.icon_list || []) as Array<{ text?: string; link?: { url?: string }; selected_icon?: { value?: string } }>;
      const inline = s.view === 'inline';
      const space = (s.space_between as Dim | undefined)?.size ?? (inline ? 40 : 12);
      const itemColor = (s.text_color as string) || '';
      const rules: string[] = [];
      const typo = typoCss(s, 'icon_typography_') || typoCss(s, 'text_typography_');
      if (typo) rules.push(typo);
      if (rules.length) ctx.css.push(`${sel} .elementor-icon-list-text{${rules.join(';')}}`);
      if (itemColor) ctx.css.push(`${sel} .elementor-icon-list-text{color:${itemColor}}`);
      if (s.icon_color) ctx.css.push(`${sel} .elementor-icon-list-icon{color:${s.icon_color}}`);
      if (inline) {
        const align = String(s.align || 'center');
        ctx.css.push(
          `${sel} .elementor-inline-items{display:flex;flex-wrap:wrap;justify-content:${alignToJustify(align)};gap:${String(space)}px}`
        );
        ctx.css.push(`${sel} .elementor-inline-items .elementor-icon-list-item{width:auto}`);
      } else {
        ctx.css.push(`${sel} .elementor-icon-list-item:not(:last-child){margin-bottom:${String(space)}px}`);
        const align = String(s.align || 'left');
        if (align === 'center' || align === 'right')
          ctx.css.push(`${sel} .elementor-icon-list-item{justify-content:${align === 'center' ? 'center' : 'flex-end'}}`);
      }
      const lis = items
        .map((it) => {
          const iconName = iconNameOf(it.selected_icon?.value || 'fas fa-check');
          const body = `<span class="elementor-icon-list-icon">${iconSvg(iconName, 15)}</span><span class="elementor-icon-list-text">${esc(it.text)}</span>`;
          const inner = it.link?.url ? `<a href="${esc(it.link.url)}" target="_blank" rel="noreferrer">${body}</a>` : body;
          return `<li class="elementor-icon-list-item">${inner}</li>`;
        })
        .join('');
      return `<div class="${cls}"><div class="elementor-widget-container"><ul class="elementor-icon-list-items${inline ? ' elementor-inline-items' : ''}">${lis}</ul></div></div>`;
    }

    case 'nav-menu': {
      const items = (s._elx_menu_items || []) as Array<{ text?: string; url?: string; children?: string[] }>;
      const ai = String(s.align_items || 'start');
      ctx.css.push(`${sel} .elementor-nav-menu--main{justify-content:${ai === 'center' ? 'center' : ai === 'end' ? 'flex-end' : 'flex-start'}}`);
      const typo = typoCss(s, 'menu_typography_');
      if (typo) ctx.css.push(`${sel} .elementor-nav-menu a{${typo}}`);
      if (s.color_menu_item) ctx.css.push(`${sel} .elementor-nav-menu a{color:${s.color_menu_item}}`);
      const lis = items
        .map((it) => {
          const kids = (it.children || []).filter(Boolean);
          const hasSub = kids.length > 0;
          const sub = hasSub
            ? `<ul class="sub-menu">${kids.map((k) => `<li><a href="#" onclick="return false">${esc(k)}</a></li>`).join('')}</ul>`
            : '';
          return `<li${hasSub ? ' class="menu-item-has-children"' : ''}><a class="elementor-item" href="${esc(it.url || '#')}" target="_blank" rel="noreferrer">${esc(it.text)}${hasSub ? iconSvg('chevron-down', 11) : ''}</a>${sub}</li>`;
        })
        .join('');
      return `<div class="${cls}"><div class="elementor-widget-container"><nav class="elementor-nav-menu--main"><ul class="elementor-nav-menu">${lis}</ul></nav></div></div>`;
    }

    case 'icon-box': {
      const position = String(s.position || 'top');
      const align = String(s.text_align || 'center');
      const iconImg = s._elx_icon_image as string | undefined;
      const iconName = iconNameOf((s.selected_icon as { value?: string })?.value || 'fas fa-star');
      const color = s.primary_color || primary;
      ctx.css.push(
        `${sel} .elementor-icon-box-icon{font-size:44px;color:${color}}`,
        `${sel} .elementor-icon-box-icon svg{width:1em;height:1em}`,
        `${sel} .elementor-icon-box-icon img{max-width:56px;max-height:56px;object-fit:contain}`
      );
      ctx.css.push(
        `${sel} .elementor-icon-box-wrapper{${position === 'left' ? 'flex-direction:row;text-align:left' : position === 'right' ? 'flex-direction:row-reverse;text-align:right' : 'flex-direction:column;'}text-align:${align};align-items:${align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'}}`
      );
      const icon = iconImg ? `<img src="${esc(iconImg)}" alt="">` : iconSvg(iconName, 44);
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elementor-icon-box-wrapper"><div class="elementor-icon-box-icon">${icon}</div><div class="elementor-icon-box-content"><h3 class="elementor-icon-box-title">${esc(s.title_text)}</h3><p class="elementor-icon-box-description">${esc(s.description_text)}</p></div></div></div></div>`;
    }

    case 'image-carousel': {
      const imgs = ((s.carousel || []) as Array<{ url?: string }>).map((c) => c.url).filter(Boolean) as string[];
      const show = Math.max(1, parseInt(String(s.slides_to_show || '1'), 10) || 1);
      ctx.css.push(`${sel} .elx-carousel-track img{width:${Math.round(10000 / show) / 100}%}`);
      const slides = imgs
        .slice(0, Math.max(show + 1, 3))
        .map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`)
        .join('');
      const arrows =
        String(s.navigation) === 'both' || String(s.navigation) === 'arrows'
          ? `<button class="elx-arrow elx-prev" aria-hidden="true">&#8249;</button><button class="elx-arrow elx-next" aria-hidden="true">&#8250;</button>`
          : '';
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elx-carousel"><div class="elx-carousel-track">${slides}</div>${arrows}</div></div></div>`;
    }

    case 'loop-carousel': {
      const cards = (s._elx_loop_cards || []) as Array<{ title?: string; image?: string }>;
      const show = Math.max(1, parseInt(String(s.slides_to_show || '3'), 10) || 3);
      ctx.css.push(`${sel} .elx-loop{display:flex;gap:16px;overflow:hidden}${sel} .elx-loop-card{flex:1 1 ${Math.round(100 / show)}%;min-width:0}${sel} .elx-loop-card img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px}`);
      const body = cards
        .slice(0, show + 1)
        .map(
          (c) =>
            `<div class="elx-loop-card">${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.title)}" loading="lazy">` : ''}<h4 style="margin:10px 0 0;font-size:16px">${esc(c.title)}</h4></div>`
        )
        .join('');
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elx-loop">${body}</div></div></div>`;
    }

    case 'form': {
      const fields = (s.form_fields || []) as Array<{ field_type?: string; field_label?: string; placeholder?: string; width?: string }>;
      const rows = fields
        .slice(0, 12)
        .map((f) => {
          const ph = esc(f.placeholder || f.field_label || '');
          const w = Math.max(0, Math.min(100, num(f.width) ?? 100));
          const input =
            f.field_type === 'textarea'
              ? `<textarea class="elx-form-input" rows="4" placeholder="${ph}"></textarea>`
              : `<input class="elx-form-input" type="${esc(f.field_type || 'text')}" placeholder="${ph}">`;
          return `<div style="flex:0 0 ${w}%">${input}</div>`;
        })
        .join('');
      ctx.css.push(`${sel} form{display:flex;flex-wrap:wrap;gap:14px 14px}${sel} .elx-form-btn{display:flex;width:100%;justify-content:${alignToJustify(String(s.button_align || 'start'))}}`);
      return `<div class="${cls}"><div class="elementor-widget-container"><form onsubmit="return false">${rows}<div class="elx-form-btn"><button class="elementor-button" type="submit">${esc(s.button_text || 'Submit')}</button></div></form></div></div>`;
    }

    case 'shortcode': {
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elx-placeholder">${esc(s.shortcode || '[shortcode]')}</div></div></div>`;
    }

    case 'html': {
      return `<div class="${cls}"><div class="elementor-widget-container">${String(s.html || '')}</div></div>`;
    }

    case 'template': {
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elx-placeholder">Elementor template (not embedded)</div></div></div>`;
    }

    case 'divider': {
      const weight = (s.weight as Dim | undefined)?.size ?? 1;
      const color = (s.color as string) || '#E0E0E0';
      const gap = (s.gap as Dim | undefined)?.size ?? 20;
      ctx.css.push(
        `${sel} .elementor-divider{padding-top:${gap}px;padding-bottom:${gap}px}${sel} .elementor-divider-separator{border-block-start:${weight}px solid ${color};width:100%}`
      );
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elementor-divider"><span class="elementor-divider-separator"></span></div></div></div>`;
    }

    case 'spacer': {
      const h = (s.space as Dim | undefined)?.size ?? 50;
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elementor-spacer"><div class="elementor-spacer-inner" style="height:${h}px"></div></div></div></div>`;
    }

    case 'video': {
      let inner = '';
      if (s.video_type === 'youtube' && s.youtube_url) {
        const yt = String(s.youtube_url);
        const id =
          (yt.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/) || [])[1] || '';
        if (id) inner = `<iframe src="https://www.youtube.com/embed/${id}" allowfullscreen loading="lazy"></iframe>`;
      } else if (s.video_type === 'vimeo' && s.vimeo_url) {
        const id = (String(s.vimeo_url).match(/vimeo\.com\/(\d+)/) || [])[1] || '';
        if (id) inner = `<iframe src="https://player.vimeo.com/video/${id}" allowfullscreen loading="lazy"></iframe>`;
      } else {
        const u = (s.hosted_url as { url?: string })?.url;
        if (u) inner = `<video src="${esc(u)}" autoplay muted loop playsinline></video>`;
      }
      if (!inner) inner = iconSvg('arrow-right', 40);
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elx-video">${inner}</div></div></div>`;
    }

    case 'google_maps': {
      const addr = String(s.address || '');
      const src = /google\.[^/]+\/maps/.test(addr)
        ? addr
        : `https://maps.google.com/maps?q=${encodeURIComponent(addr)}&z=13&output=embed`;
      const h = (s.height as Dim | undefined)?.size ?? 400;
      return `<div class="${cls}"><div class="elementor-widget-container"><iframe src="${esc(src)}" style="width:100%;height:${h}px;border:0" loading="lazy"></iframe></div></div>`;
    }

    case 'social-icons': {
      const items = (s.social_icon_list || []) as Array<{ link?: { url?: string }; social_icon?: { value?: string } }>;
      const cells = items
        .map((it) => {
          const url = it.link?.url || '#';
          const brand = BRAND_ICONS.find(([re]) => re.test(url));
          const name = brand ? brand[1] : 'globe';
          const bg = brand ? brand[2] : '#7a7a7a';
          return `<a class="elementor-social-icon" style="background:${bg}" href="${esc(url)}" target="_blank" rel="noreferrer">${iconSvg(name, 15)}</a>`;
        })
        .join('');
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elementor-social-icons-wrapper">${cells}</div></div></div>`;
    }

    case 'counter': {
      const n = num(s.ending_number) ?? 0;
      return `<div class="${cls}" style="text-align:center"><div class="elementor-widget-container"><div style="font-size:2.6em;font-weight:700;color:${esc(s.number_color || primary)}">${n}</div><div>${esc(s.title)}</div></div></div>`;
    }

    default: {
      // Unknown widget: render any html payload, else a light placeholder.
      if (s.html) return `<div class="${cls}"><div class="elementor-widget-container">${String(s.html)}</div></div>`;
      return `<div class="${cls}"><div class="elementor-widget-container"><div class="elx-placeholder">${esc(type)}</div></div></div>`;
    }
  }
}

/* ------------------------------------------------------- section / column */

function columnCss(col: ElxElement, colsTotal: number): string {
  const sel = `.elementor-element-${col.id}`;
  const s = col.settings;
  const rules: string[] = [];
  const inline = num(s._inline_size) ?? num(s._column_size);
  if (inline) rules.push(`${sel}{width:${inline}%}`);
  else if (colsTotal === 1) rules.push(`${sel}{width:100%}`);
  const bg = bgCss(s);
  if (bg) rules.push(`${sel}{${bg}}`);
  const cp = s.content_position;
  if (cp === 'center' || cp === 'middle') rules.push(`${sel}>.elementor-widget-wrap{align-content:center}`);
  else if (cp === 'bottom' || cp === 'flex-end') rules.push(`${sel}>.elementor-widget-wrap{align-content:flex-end}`);
  const align = s.align;
  if (align === 'center' || align === 'right')
    rules.push(`${sel}>.elementor-widget-wrap{text-align:${align};justify-content:${alignToJustify(String(align))}}`);
  const sbw = num(s.space_between_widgets);
  if (sbw !== null) rules.push(`${sel} .elementor-widget:not(:last-child){margin-block-end:${sbw}px}`);
  const pad = dimCss(s.padding as Dim);
  if (pad && pad !== '0px 0px 0px 0px') rules.push(`${sel}>.elementor-widget-wrap{padding:${pad}}`);
  return rules.filter(Boolean).join('\n');
}

function renderColumn(col: ElxElement, total: number, ctx: { css: string[]; design: RenderDesign }): string {
  ctx.css.push(columnCss(col, total));
  const inner = col.elements.map((e) => renderElement(e, ctx)).join('');
  const size = Math.round(num(col.settings._inline_size) ?? num(col.settings._column_size) ?? Math.round(100 / total));
  const widthCls = ` elementor-col-${Math.max(1, Math.min(100, size))}`;
  return `<div class="elementor-column${widthCls} elementor-element elementor-element-${col.id}${col.isInner ? ' elementor-inner-column' : ' elementor-top-column'}"><div class="elementor-widget-wrap elementor-element-populated">${inner}</div></div>`;
}

function sectionCss(sec: ElxElement): string {
  const s = sec.settings;
  const sel = `.elementor-element-${sec.id}`;
  const rules: string[] = [];
  const bg = bgCss(s);
  if (bg) rules.push(`${sel}{${bg}}`);
  const pad = dimCss(s.padding as Dim);
  if (pad && pad !== '0px 0px 0px 0px') rules.push(`${sel}{padding:${pad}}`);
  const cw = sec.elType === 'section' ? (s.content_width as Dim & { size?: number | string }) : undefined;
  if (cw && cw.size) rules.push(`${sel}>.elementor-container{max-width:${cw.size}${cw.unit || 'px'}}`);
  const cp = s.content_position;
  if (cp === 'middle') rules.push(`${sel}>.elementor-container{align-items:center}`);
  else if (cp === 'bottom') rules.push(`${sel}>.elementor-container{align-items:flex-end}`);
  return rules.filter(Boolean).join('\n');
}

function renderSection(sec: ElxElement, index: number, ctx: { css: string[]; design: RenderDesign }): string {
  ctx.css.push(sectionCss(sec));
  const cols = sec.elements.map((c) => renderColumn(c, sec.elements.length, ctx)).join('');
  const gap = String(sec.settings.gap || 'default');
  const inner = sec.isInner === true;
  const id = inner ? '' : ` id="elx-sec-${index}"`;
  return `<section${id} class="elementor-section ${inner ? 'elementor-inner-section' : 'elementor-top-section'} elementor-element elementor-element-${sec.id} elementor-section-boxed elementor-section-height-default"><div class="elementor-container elementor-column-gap-${gap}">${cols}</div></section>`;
}

function containerCss(el: ElxElement): string {
  const s = el.settings;
  const sel = `.elementor-element-${el.id}`;
  const rules: string[] = [];
  const dir = s.flex_direction ? `--flex-direction:${s.flex_direction}` : '';
  const gapDim = s.flex_gap as (Dim & { size?: number | string; column?: string }) | undefined;
  const gap = gapDim ? (gapDim.size ?? gapDim.column ?? 0) : null;
  const vars: string[] = [];
  if (dir) vars.push(dir);
  if (gap !== null) vars.push(`--flex-gap:${gap}px`);
  if (vars.length) rules.push(`${sel}{${vars.join(';')}}`);
  const w = s.width as (Dim & { size?: number | string }) | undefined;
  const boxed = s.content_width === 'boxed';
  // Percentage widths belong to child containers (flex children); boxed pixel
  // widths of parent containers only constrain the inner row, never the
  // full-width section (backgrounds must stay edge-to-edge).
  if (w && w.size && String(w.unit || '%') === '%') rules.push(`${sel}{width:${w.size}%;flex:0 0 auto}`);
  if (boxed && w && w.size) rules.push(`${sel}>.e-con-inner{max-width:${w.size}px;margin:0 auto}`);
  if (s.flex_align_items) rules.push(`${sel}{align-items:${s.flex_align_items}}`);
  const bg = bgCss(s);
  if (bg) rules.push(`${sel}{${bg}}`);
  const pad = dimCss(s.padding as Dim);
  if (pad && pad !== '0px 0px 0px 0px') rules.push(`${sel}{padding:${pad}}`);
  return rules.filter(Boolean).join('\n');
}

function renderContainer(el: ElxElement, ctx: { css: string[]; design: RenderDesign }, index = 0): string {
  ctx.css.push(containerCss(el));
  const children = el.elements.map((c) => renderElement(c, ctx)).join('');
  const top = el.isInner === false;
  const dir = String(el.settings.flex_direction || 'column');
  const cls = `e-con ${top ? 'e-parent e-con-boxed' : 'e-child e-con-full'} elementor-element elementor-element-${el.id}`;
  const id = top ? ` id="elx-sec-${index}"` : '';
  const inner = top ? `<div class="e-con-inner">${children}</div>` : children;
  return `<div${id} class="${cls}" data-flex-direction="${dir}">${inner}</div>`;
}

function renderElement(el: ElxElement, ctx: { css: string[]; design: RenderDesign }, index = 0): string {
  if (el.elType === 'section') return renderSection(el, index, ctx);
  if (el.elType === 'container') return renderContainer(el, ctx, index);
  if (el.elType === 'column') return renderColumn(el, 1, ctx);
  return renderWidget(el, ctx);
}

/* ------------------------------------------------------------- document */

function collectFontFamilies(el: ElxElement, acc: Set<string>) {
  for (const [k, v] of Object.entries(el.settings || {})) {
    if (/font_family$/.test(k) && typeof v === 'string' && v && el.settings[`${k.slice(0, -11)}typography`] === 'custom') {
      if (!/^(inherit|initial|unset|serif|sans-serif)$/i.test(v)) acc.add(v);
    }
  }
  el.elements?.forEach((c) => collectFontFamilies(c, acc));
}

const SYNC_SNIPPET = `(function(){
  function ratio(){var e=document.documentElement,b=document.body;var h=Math.max(e.scrollHeight,b.scrollHeight,1);var t=window.scrollY||e.scrollTop||0;var m=Math.max(h-window.innerHeight,1);return{top:t,ratio:t/m,height:h};}
  function send(){try{parent.postMessage(Object.assign({type:'elx-scroll',side:'clone'},ratio()),'*')}catch(e){}}
  var t=null;window.addEventListener('scroll',function(){if(!t)t=setTimeout(function(){t=null;send()},60)},{passive:true});
  window.addEventListener('load',function(){send();try{parent.postMessage({type:'elx-ready',side:'clone'},'*')}catch(e){}});
  window.addEventListener('message',function(ev){
    var d=ev.data||{};
    if(d.type==='elx-jump'&&d.hash){var t=document.getElementById(d.hash);if(t){t.scrollIntoView({block:'start'});setTimeout(send,80)}return;}
    if(d.type!=='elx-scrollto')return;
    var e=document.documentElement,b=document.body;var h=Math.max(e.scrollHeight,b.scrollHeight,1);var m=Math.max(h-window.innerHeight,1);window.scrollTo(0,Math.round((d.ratio||0)*m));
  });
})();`;

export function renderElementorDocument(elementor: { title?: string; content?: ElxElement[] }, design: RenderDesign = {}): string {
  const primary = design.primary || '#3644EE';
  const ctx = { css: [] as string[], design };

  const content = Array.isArray(elementor.content) ? elementor.content : [];
  const body = content.map((el, i) => renderElement(el, ctx, i)).join('\n');

  const fonts = new Set<string>();
  (design.fonts || []).forEach((f) => {
    if (f && !/system|apple|emoji/i.test(f)) fonts.add(f);
  });
  content.forEach((el) => collectFontFamilies(el, fonts));
  const fontLink = fonts.size
    ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${[...fonts]
        .slice(0, 8)
        .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700;800`)
        .join('&')}&display=swap">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(elementor.title || 'Cloned page')}</title>
<base target="_blank">
${fontLink}
<style>${baseCss(primary)}</style>
<style id="elx-dynamic">${ctx.css.join('\n')}</style>
</head>
<body class="elementor elementor-page">
${body}
<script>${SYNC_SNIPPET}</script>
</body>
</html>`;
}
