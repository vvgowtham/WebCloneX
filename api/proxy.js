// Live-site preview proxy.
// Serves any public page from our own origin so it can be iframed for the
// side-by-side comparison view (target sites usually send X-Frame-Options or
// CSP frame-ancestors, which would otherwise block embedding). All resource
// URLs are absolutised so images/CSS/JS keep loading from the origin host.

import { parse } from 'node-html-parser';
import { fetchHtml } from './_engine.js';

export const config = { maxDuration: 60 };

const SRC_ATTRS = ['src', 'href', 'poster', 'action', 'data-src', 'data-lazy-src', 'data-bg', 'data-original'];

function absolutise(value, base) {
  if (!value) return value;
  const v = String(value).trim();
  if (!v || v.startsWith('#') || /^(data:|mailto:|tel:|javascript:|blob:|about:|sms:|whatsapp:)/i.test(v)) return value;
  try {
    return new URL(v, base).href;
  } catch {
    return value;
  }
}

function rewriteSrcset(value, base) {
  if (!value) return value;
  return String(value)
    .split(',')
    .map((part) => {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) return part;
      const url = absolutise(bits[0], base);
      return [url, ...bits.slice(1)].join(' ');
    })
    .join(', ');
}

// Absolutise url() references inside inline style attributes / css text.
function rewriteCssUrls(css, base) {
  return String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
    const a = absolutise(u, base);
    return `url(${q || ''}${a}${q || ''})`;
  });
}

const SYNC_SCRIPT = `(function(){
  function ratio(){
    var el=document.documentElement,b=document.body;
    var h=Math.max(el.scrollHeight,b.scrollHeight,1);
    var top=window.scrollY||el.scrollTop||0;
    var max=Math.max(h-window.innerHeight,1);
    return {top:top,ratio:top/max,height:h,inner:window.innerHeight};
  }
  function send(){
    try{parent.postMessage(Object.assign({type:'elx-scroll',side:'source'},ratio()),'*');}catch(e){}
  }
  var t=null;
  window.addEventListener('scroll',function(){if(t)return;t=setTimeout(function(){t=null;send();},60);},{passive:true});
  window.addEventListener('load',function(){send();try{parent.postMessage({type:'elx-ready',side:'source'},'*');}catch(e){}});
  window.addEventListener('message',function(ev){
    var d=ev.data||{};
    if(d.type==='elx-jump'&&d.hash){var t=document.getElementById(d.hash);if(t){t.scrollIntoView({block:'start'});setTimeout(send,80)}return;}
    if(d.type!=='elx-scrollto')return;
    var el=document.documentElement,b=document.body;
    var h=Math.max(el.scrollHeight,b.scrollHeight,1);
    var max=Math.max(h-window.innerHeight,1);
    window.scrollTo(0,Math.round((d.ratio||0)*max));
  });
})();`;

function buildPage(html, baseUrl, opts) {
  const root = parse(html, {
    comment: false,
    blockTextElements: { script: true, style: true, pre: true, textarea: true },
  });

  // Neutralise CSP meta tags — we are intentionally re-serving the page.
  root.querySelectorAll('meta').forEach((m) => {
    const eq = (m.getAttribute('http-equiv') || '').toLowerCase();
    if (eq.includes('content-security-policy') || eq.includes('x-frame-options')) m.remove();
  });

  // Absolutise resource attributes.
  root.querySelectorAll('*').forEach((el) => {
    for (const a of SRC_ATTRS) {
      const v = el.getAttribute(a);
      if (v) el.setAttribute(a, absolutise(v, baseUrl));
    }
    const ss = el.getAttribute('srcset');
    if (ss) el.setAttribute('srcset', rewriteSrcset(ss, baseUrl));
    const st = el.getAttribute('style');
    if (st && st.includes('url(')) el.setAttribute('style', rewriteCssUrls(st, baseUrl));
  });

  if (opts.nojs) root.querySelectorAll('script').forEach((s) => s.remove());

  const head = root.querySelector('head') || root;
  head.insertAdjacentHTML(
    'afterbegin',
    `<base href="${baseUrl}" target="_blank"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{scroll-behavior:auto !important}</style>`
  );

  const body = root.querySelector('body');
  if (body) body.insertAdjacentHTML('beforeend', `<script>${SYNC_SCRIPT}</script>`);

  const out = root.toString();
  return /^<!doctype/i.test(html) && !/^<!doctype/i.test(out) ? '<!DOCTYPE html>' + out : out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let url = String((req.query && req.query.url) || '').trim();
  const nojs = String((req.query && req.query.nojs) || '') === '1';
  if (!url || !/^https?:\/\//i.test(url)) {
    if (url && !/^https?:/i.test(url)) url = 'https://' + url;
    else return res.status(400).json({ error: 'url query param is required' });
  }

  try {
    const { html, finalUrl } = await fetchHtml(url);
    const page = buildPage(html, finalUrl || url, { nojs });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // Intentionally no X-Frame-Options / CSP frame-ancestors here.
    return res.status(200).send(page);
  } catch (err) {
    const msg = String(err.message || err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(502).send(
      `<!DOCTYPE html><html><body style="font-family:system-ui;background:#101019;color:#cfd2dc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
        <div style="max-width:420px;text-align:center;padding:24px">
          <h2 style="margin:0 0 8px">Live preview unavailable</h2>
          <p style="color:#8b8fa3;font-size:14px;line-height:1.6">${msg.replace(/</g, '&lt;')}</p>
        </div>
      </body></html>`
    );
  }
}
