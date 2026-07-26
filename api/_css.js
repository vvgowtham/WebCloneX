// Minimal CSS cascade engine for WebClonerELX.
// Parses stylesheets, indexes rules, and resolves computed values for the
// subset of properties needed to reproduce a layout faithfully.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const WANTED = new Set([
  'display',
  'visibility',
  'color',
  'background',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'font-size',
  'font-weight',
  'font-family',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-block-start',
  'padding-block-end',
  'padding-inline-start',
  'padding-inline-end',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'margin-block-start',
  'margin-block-end',
  'width',
  'max-width',
  'min-width',
  'height',
  'min-height',
  'max-height',
  'flex-direction',
  'justify-content',
  'align-items',
  'align-content',
  'gap',
  'row-gap',
  'column-gap',
  'border-radius',
  'border-width',
  'border-style',
  'border-color',
  'box-shadow',
  'order',
  'flex-wrap',
  'text-shadow',
  'opacity',
]);

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function mediaApplies(cond) {
  const c = cond.toLowerCase();
  if (/print|speech/.test(c)) return false;
  // desktop viewport ~1440px
  const maxes = [...c.matchAll(/max-width\s*:\s*(\d+)px/g)].map((m) => Number(m[1]));
  const mins = [...c.matchAll(/min-width\s*:\s*(\d+)px/g)].map((m) => Number(m[1]));
  if (maxes.some((v) => v < 1440)) return false;
  if (mins.some((v) => v > 1440)) return false;
  return true;
}

function parseDeclarations(text) {
  const out = {};
  let buf = '';
  let depth = 0;
  const chunks = [];
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) {
      chunks.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) chunks.push(buf);

  for (const chunk of chunks) {
    const i = chunk.indexOf(':');
    if (i < 0) continue;
    const prop = chunk.slice(0, i).trim().toLowerCase();
    let value = chunk.slice(i + 1).trim();
    if (!prop || !value) continue;
    const important = /!important\s*$/i.test(value);
    if (important) value = value.replace(/!important\s*$/i, '').trim();
    if (prop.startsWith('--')) {
      out[prop] = { value, important };
      continue;
    }
    if (!WANTED.has(prop)) continue;
    out[prop] = { value, important };
  }
  return out;
}

// Split a selector into compounds, respecting escapes, quotes, brackets and
// nested parentheses. Modern frameworks (Tailwind v4) emit selectors like
// `.peer-has-checked\:hidden:is(:where(.peer):has(:checked) ~ *)` which a naive
// split would shred into universal matchers that then poison every element.
function splitTopLevel(sel) {
  const parts = [];
  let buf = '';
  let paren = 0;
  let bracket = 0;
  let quote = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '\\') {
      buf += ch + (sel[i + 1] || '');
      i++;
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') paren++;
    if (ch === ')') paren--;
    if (ch === '[') bracket++;
    if (ch === ']') bracket--;
    if (paren === 0 && bracket === 0) {
      if (ch === '>' || ch === '+' || ch === '~') {
        if (buf.trim()) parts.push(buf.trim());
        parts.push(ch);
        buf = '';
        continue;
      }
      if (/\s/.test(ch)) {
        if (buf.trim()) parts.push(buf.trim());
        buf = '';
        continue;
      }
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return { parts, balanced: paren === 0 && bracket === 0 && !quote };
}

function parseSelector(sel) {
  const s = sel.trim();
  if (!s) return null;
  // Pseudo-elements never correspond to a real DOM node.
  if (/::(before|after|first-letter|first-line|placeholder|marker|selection|backdrop|file-selector-button)/i.test(s)) return null;

  const { parts, balanced } = splitTopLevel(s);
  if (!balanced || !parts.length) return null;

  const compounds = [];
  let combinator = ' ';
  for (const p of parts) {
    if (p === '>' || p === '+' || p === '~') {
      combinator = p;
      continue;
    }
    const compiled = compileCompound(p);
    compounds.push({ combinator, raw: p, ...compiled });
    combinator = ' ';
  }
  if (!compounds.length) return null;
  // If the rightmost compound can never match, drop the rule entirely.
  if (compounds[compounds.length - 1].dead) return null;
  return compounds;
}

// Balanced-paren matcher for functional pseudo-classes.
function matchPseudoFn(s, names) {
  const re = new RegExp(`:(${names})\\(`, 'i');
  const m = s.match(re);
  if (!m) return null;
  const open = (m.index || 0) + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) {
        return { name: m[1].toLowerCase(), start: m.index || 0, end: i + 1, inner: s.slice(open + 1, i) };
      }
    }
  }
  return null;
}

function compileCompound(raw) {
  const nots = [];
  // CSS escapes (Tailwind's `.peer-has-checked\:hidden`) — unescape so the
  // class name matches what is actually in the DOM.
  let s = raw.replace(/\\(.)/g, '$1');
  let guard = 0;

  // :not(...) → remembered as exclusions
  while (guard++ < 12) {
    const m = matchPseudoFn(s, 'not');
    if (!m) break;
    m.inner
      .split(',')
      .map((x) => x.trim())
      .forEach((x) => {
        if (/[\s>+~()]/.test(x)) return; // complex :not() — cannot evaluate, ignore
        const c = x.match(/\.([A-Za-z0-9_-]+)/g);
        if (c) nots.push(...c.map((k) => k.slice(1)));
      });
    s = s.slice(0, m.start) + s.slice(m.end);
  }

  // :is()/:where()/:matches()/:any() → inline the first alternative so the
  // compound keeps its real target instead of collapsing to a universal match.
  guard = 0;
  let zeroSpec = false;
  while (guard++ < 12) {
    const m = matchPseudoFn(s, 'is|where|matches|any');
    if (!m) break;
    if (m.name === 'where') zeroSpec = true;
    const first = (m.inner.split(',')[0] || '').trim();
    // Only inline simple compounds; anything with combinators or further
    // nesting is unevaluable and must kill the rule rather than widen it.
    const replacement = !first || /[\s>+~()]/.test(first) ? '\u0000' : first;
    s = s.slice(0, m.start) + replacement + s.slice(m.end);
  }

  // Any remaining functional pseudo (:has(), :nth-child(...) with args) —
  // strip with balanced matching so stray ")" never leaks into the compound.
  guard = 0;
  while (guard++ < 12) {
    const m = matchPseudoFn(s, '[a-z-]+');
    if (!m) break;
    const unevaluableFn = /^(has|nth-child|nth-of-type|nth-last-child|nth-last-of-type|dir|lang|host-context)$/i.test(m.name);
    s = s.slice(0, m.start) + (unevaluableFn ? '\u0000' : '') + s.slice(m.end);
  }

  // Unbalanced leftovers mean we mis-parsed → refuse to match.
  if (/[()]/.test(s)) return { id: '', classes: [], attrs: [], tag: '', universal: false, dead: true, nots, specificity: 0 };

  // Pseudo-classes/elements we cannot evaluate statically. If a compound is
  // built only out of these it must NOT be treated as a universal match —
  // otherwise state/structural rules leak onto every element.
  const UNEVALUABLE =
    /^(hover|focus|focus-within|focus-visible|focus-visible-within|active|visited|link|any-link|target|target-within|checked|unchecked|disabled|enabled|indeterminate|nth-child|nth-of-type|nth-last-child|nth-last-of-type|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type|empty|placeholder-shown|required|optional|valid|invalid|user-valid|user-invalid|read-only|read-write|default|in-range|out-of-range|fullscreen|picture-in-picture|modal|popover-open|open|autofill|defined|dir|lang|has|host|host-context|state|current|past|future|playing|paused|muted|seeking|buffering|stalled)$/i;

  let dead = false;
  const pseudos = [...s.matchAll(/::?([a-z-]+)(\([^()]*\))?/gi)];
  const hadPseudo = pseudos.length > 0;
  for (const p of pseudos) {
    if (p[0].startsWith('::')) dead = true; // pseudo-element -> not a real node
    else if (UNEVALUABLE.test(p[1])) dead = true;
  }
  s = s.replace(/::?[a-z-]+(\([^()]*\))?/gi, '');

  const bare = !/[#.\[a-zA-Z]/.test(s.replace(/\u0000/g, ''));

  // Unresolvable functional pseudo → never match rather than match everything.
  if (s.includes('\u0000')) return { id: '', classes: [], attrs: [], tag: '', universal: false, dead: true, nots, specificity: 0 };
  // Compound made only of unevaluable pseudos → dead.
  if (dead && bare) return { id: '', classes: [], attrs: [], tag: '', universal: false, dead: true, nots, specificity: 0 };

  const id = (s.match(/#([A-Za-z0-9_-]+)/) || [])[1] || '';
  const classes = (s.match(/\.([A-Za-z0-9_-]+)/g) || []).map((c) => c.slice(1));
  const attrs = [...s.matchAll(/\[([A-Za-z-]+)(?:([~^$*|]?=)"?([^\]"]*)"?)?\]/g)].map((m) => ({
    name: m[1].toLowerCase(),
    op: m[2] || '',
    value: m[3] || '',
  }));
  const tagMatch = s.match(/^([A-Za-z][A-Za-z0-9]*)/);
  const tag = tagMatch ? tagMatch[1].toUpperCase() : '';
  const universal = !id && !classes.length && !attrs.length && !tag;
  let specificity = (id ? 100 : 0) + classes.length * 10 + attrs.length * 10 + (tag ? 1 : 0);
  if (zeroSpec) specificity = Math.max(0, specificity - 10);
  if (universal && hadPseudo) specificity = 0;
  return { id, classes, attrs, tag, universal, dead, nots, specificity };
}

function keyFor(compound) {
  const el = compound.classes.find((c) => c.startsWith('elementor-element-'));
  if (el) return 'c:' + el;
  if (compound.id) return '#' + compound.id;
  if (compound.classes.length) return 'c:' + compound.classes[compound.classes.length - 1];
  if (compound.tag) return 't:' + compound.tag;
  return '*';
}

export function parseStylesheet(css, sink, order) {
  const text = stripComments(css);
  let i = 0;
  const n = text.length;
  const stack = [];
  let bufStart = 0;

  const flushRule = (selectorText, body) => {
    const decls = parseDeclarations(body);
    if (!Object.keys(decls).length) return;
    selectorText.split(',').forEach((sel) => {
      const compounds = parseSelector(sel);
      if (!compounds) return;
      const last = compounds[compounds.length - 1];
      const spec = compounds.reduce((a, c) => a + c.specificity, 0);
      const rule = { compounds, decls, spec, order: order.n++ };
      const k = keyFor(last);
      if (!sink.index.has(k)) sink.index.set(k, []);
      sink.index.get(k).push(rule);
      // collect custom properties globally
      for (const [p, v] of Object.entries(decls)) {
        if (p.startsWith('--') && !sink.vars.has(p)) sink.vars.set(p, v.value);
      }
    });
  };

  while (i < n) {
    const ch = text[i];
    if (ch === '{') {
      const head = text.slice(bufStart, i).trim();
      if (head.startsWith('@')) {
        const at = head.slice(1).split(/[\s({]/)[0].toLowerCase();
        if (at === 'media' && !mediaApplies(head)) {
          // skip the whole block
          let depth = 1;
          i++;
          while (i < n && depth > 0) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') depth--;
            i++;
          }
          bufStart = i;
          continue;
        }
        if (at === 'media' || at === 'supports' || at === 'layer') {
          stack.push('nested');
          i++;
          bufStart = i;
          continue;
        }
        // font-face, keyframes, etc → skip block
        let depth = 1;
        i++;
        while (i < n && depth > 0) {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') depth--;
          i++;
        }
        bufStart = i;
        continue;
      }
      // normal rule
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(i + 1, j - 1);
      flushRule(head, body);
      i = j;
      bufStart = i;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      i++;
      bufStart = i;
      continue;
    }
    i++;
  }
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

function classListOf(el) {
  if (el.__cls) return el.__cls;
  const raw = (el.getAttribute && el.getAttribute('class')) || '';
  const set = new Set(raw.split(/\s+/).filter(Boolean));
  el.__cls = set;
  return set;
}

function compoundMatches(el, c) {
  if (!el || el.nodeType !== 1) return false;
  if (c.dead) return false;
  if (c.universal) return true;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && (el.getAttribute('id') || '') !== c.id) return false;
  if (c.classes.length) {
    const cl = classListOf(el);
    for (const k of c.classes) if (!cl.has(k)) return false;
  }
  if (c.nots.length) {
    const cl = classListOf(el);
    for (const k of c.nots) if (cl.has(k)) return false;
  }
  if (c.attrs.length) {
    for (const a of c.attrs) {
      const v = el.getAttribute(a.name);
      if (v === undefined || v === null) return false;
      if (!a.op) continue;
      if (a.op === '=' && v !== a.value) return false;
      if (a.op === '*=' && !v.includes(a.value)) return false;
      if (a.op === '^=' && !v.startsWith(a.value)) return false;
      if (a.op === '$=' && !v.endsWith(a.value)) return false;
      if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
    }
  }
  return true;
}

function selectorMatches(el, compounds) {
  const last = compounds[compounds.length - 1];
  if (!compoundMatches(el, last)) return false;
  let idx = compounds.length - 2;
  let node = el;
  while (idx >= 0) {
    const c = compounds[idx];
    if (c.combinator === '+' || c.combinator === '~') return false; // unsupported
    const childOnly = compounds[idx + 1].combinator === '>';
    if (childOnly) {
      node = node.parentNode;
      if (!compoundMatches(node, c)) return false;
    } else {
      let p = node.parentNode;
      let found = null;
      while (p && p.nodeType === 1) {
        if (compoundMatches(p, c)) {
          found = p;
          break;
        }
        p = p.parentNode;
      }
      if (!found) return false;
      node = found;
    }
    idx--;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function createSheet() {
  return { index: new Map(), vars: new Map() };
}

export async function loadStyles(root, base, rawHtml, opts = {}) {
  const sheet = createSheet();
  const order = { n: 0 };

  // inline <style> blocks first (document order roughly preserved)
  const inline = root.querySelectorAll('style').map((s) => s.text || '');

  const hrefs = root
    .querySelectorAll('link')
    .filter((l) => /stylesheet/i.test(l.getAttribute('rel') || ''))
    .map((l) => l.getAttribute('href') || '')
    .map((h) => {
      try {
        return new URL(h, base).href;
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .filter((h) => !/font-?awesome|eicons|animations\/styles|swiper|lightbox|wp-emoji|dashicons/i.test(h));

  // Elementor per-post css carries the real per-element rules → highest value
  const scored = hrefs
    .map((h, i) => {
      let score = 5;
      if (/elementor\/css\/post-/i.test(h)) score = 0;
      else if (/elementor\/css\/global/i.test(h)) score = 1;
      else if (/themes\/.*style|theme\.min|child/i.test(h)) score = 2;
      else if (/elementor.*frontend/i.test(h)) score = 3;
      else if (/widget-/i.test(h)) score = 4;
      return { h, score, i };
    })
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, opts.maxSheets || 12);

  const fetched = await Promise.all(
    scored.map(async ({ h }) => {
      try {
        const r = await fetch(h, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
        if (!r.ok) return '';
        const t = await r.text();
        return t.length > 600000 ? t.slice(0, 600000) : t;
      } catch {
        return '';
      }
    })
  );

  // parse generic sheets first, elementor post css last so it wins on equal specificity
  const orderedExternal = fetched;
  for (const css of orderedExternal) if (css) parseStylesheet(css, sheet, order);
  for (const css of inline) if (css) parseStylesheet(css, sheet, order);

  sheet.stats = { sheets: scored.length, bytes: fetched.reduce((a, b) => a + b.length, 0), rules: order.n };
  return sheet;
}

export function resolveVar(sheet, value, depth = 0) {
  if (!value || depth > 6 || !value.includes('var(')) return value;
  return resolveVar(
    sheet,
    value.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*))?\)/g, (_m, name, fb) => {
      const v = sheet.vars.get(name);
      if (v !== undefined) return v;
      return fb !== undefined ? fb : '';
    }),
    depth + 1
  );
}

export function computedStyle(sheet, el) {
  if (!el || el.nodeType !== 1) return {};
  if (el.__cs) return el.__cs;

  const cl = classListOf(el);
  const buckets = [];
  const elKey = [...cl].find((c) => c.startsWith('elementor-element-'));
  if (elKey) buckets.push(sheet.index.get('c:' + elKey));
  for (const c of cl) buckets.push(sheet.index.get('c:' + c));
  const id = el.getAttribute('id');
  if (id) buckets.push(sheet.index.get('#' + id));
  buckets.push(sheet.index.get('t:' + el.tagName));
  buckets.push(sheet.index.get('*'));

  const winners = new Map(); // prop -> {spec, order, important, value}
  const seen = new Set();
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const rule of bucket) {
      if (seen.has(rule)) continue;
      seen.add(rule);
      if (!selectorMatches(el, rule.compounds)) continue;
      for (const [prop, d] of Object.entries(rule.decls)) {
        if (prop.startsWith('--')) continue;
        const prev = winners.get(prop);
        const better =
          !prev ||
          (d.important && !prev.important) ||
          (d.important === prev.important && (rule.spec > prev.spec || (rule.spec === prev.spec && rule.order > prev.order)));
        if (better) winners.set(prop, { spec: rule.spec, order: rule.order, important: d.important, value: d.value });
      }
    }
  }

  const out = {};
  for (const [prop, w] of winners) out[prop] = resolveVar(sheet, w.value).trim();

  // inline style attribute has the highest weight (short of !important rules)
  const inlineRaw = el.getAttribute('style');
  if (inlineRaw) {
    const decls = parseDeclarations(inlineRaw);
    for (const [prop, d] of Object.entries(decls)) {
      if (prop.startsWith('--')) continue;
      const prev = winners.get(prop);
      if (prev && prev.important && !d.important) continue;
      out[prop] = resolveVar(sheet, d.value).trim();
    }
  }

  el.__cs = out;
  return out;
}

/* helpers ---------------------------------------------------------- */

export function px(v) {
  if (!v) return null;
  const m = String(v).match(/(-?[\d.]+)\s*px/);
  if (m) return parseFloat(m[1]);
  const rem = String(v).match(/(-?[\d.]+)\s*rem/);
  if (rem) return parseFloat(rem[1]) * 16;
  const em = String(v).match(/(-?[\d.]+)\s*em/);
  if (em) return parseFloat(em[1]) * 16;
  const bare = String(v).trim().match(/^(-?[\d.]+)$/);
  if (bare) return parseFloat(bare[1]);
  return null;
}

export function pct(v) {
  const m = String(v || '').match(/([\d.]+)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

export function boxOf(cs, kind) {
  const shorthand = cs[kind];
  const sides = { top: null, right: null, bottom: null, left: null };
  if (shorthand) {
    const parts = shorthand.trim().split(/\s+/).map((p) => px(p));
    if (parts.length === 1) sides.top = sides.right = sides.bottom = sides.left = parts[0];
    else if (parts.length === 2) {
      sides.top = sides.bottom = parts[0];
      sides.right = sides.left = parts[1];
    } else if (parts.length === 3) {
      sides.top = parts[0];
      sides.right = sides.left = parts[1];
      sides.bottom = parts[2];
    } else if (parts.length >= 4) {
      sides.top = parts[0];
      sides.right = parts[1];
      sides.bottom = parts[2];
      sides.left = parts[3];
    }
  }
  const map = {
    top: [`${kind}-top`, `${kind}-block-start`],
    right: [`${kind}-right`, `${kind}-inline-end`],
    bottom: [`${kind}-bottom`, `${kind}-block-end`],
    left: [`${kind}-left`, `${kind}-inline-start`],
  };
  for (const [side, keys] of Object.entries(map)) {
    for (const k of keys) {
      if (cs[k] !== undefined) {
        const v = px(cs[k]);
        if (v !== null) sides[side] = v;
      }
    }
  }
  return sides;
}

export function isHidden(cs, el) {
  if (!cs) return false;
  const raw = (el && el.getAttribute && el.getAttribute('class')) || '';
  // Entrance-animation wrappers are hidden in CSS but revealed by JS on scroll.
  const revealed = /elementor-invisible|animated|aos-init|wow\b|elementor-motion-effects/.test(raw);
  if (/none/i.test(cs.display || '')) return true;
  if (!revealed && /hidden|collapse/i.test(cs.visibility || '')) return true;
  if (!revealed && cs.opacity !== undefined && parseFloat(cs.opacity) === 0) return true;
  const cl = (el && el.getAttribute('class')) || '';
  if (/elementor-hidden-desktop|elementor-hidden-widescreen|screen-reader-text|visually-hidden|sr-only/.test(cl)) return true;
  return false;
}

// Classes whose "hidden" styling is undone by JavaScript on load. These
// elements are genuinely visible to a user, so the cascade result must be
// ignored for them.
export const JS_REVEALED = /elementor-invisible|animated|aos-init|wow\b|reveal|fade-in-up|elementor-motion-effects/;
