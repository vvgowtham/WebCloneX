/**
 * Stage 2-4 of the universal scan pipeline: real Chromium capture.
 *
 * Opens the page in a headless browser, waits for network idle / JS / AJAX /
 * lazy content, auto-scrolls top → bottom to trigger intersection observers
 * and infinite sections, then returns the fully rendered DOM.
 *
 * Hard requirements are OPTIONAL: when Chromium cannot launch (local dev
 * without system libs, platforms without the runtime), `browserCapture`
 * resolves to null and the engine falls back to the fetch pipeline — the
 * clone must never fail because of the browser stage.
 *
 * On Vercel / AWS Lambda `@sparticuz/chromium` provides the full runtime.
 */

const VIEWPORT = { width: 1440, height: 900 };

async function loadBrowserDeps() {
  try {
    const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ]);
    return { chromium, puppeteer };
  } catch {
    return null;
  }
}

// Scroll the whole document slowly enough for IntersectionObservers,
// infinite feeds and lazy images to fire. Runs inside the page.
const AUTO_SCROLL = `(async () => {
  await new Promise((resolve) => {
    let y = 0;
    const step = Math.max(window.innerHeight * 0.66, 320);
    const timer = setInterval(() => {
      window.scrollBy(0, step);
      y += step;
      const h = Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight || 0);
      if (y >= h + window.innerHeight) {
        clearInterval(timer);
        resolve();
      }
    }, 140);
    setTimeout(() => { clearInterval(timer); resolve(); }, 14000);
  });
  window.scrollTo(0, 0);
})()`;

// Snapshot extra runtime data our static cascade cannot know: which elements
// ended up display:none after JS, lazy-loaded img URLs (data-src → src),
// and the number of live DOM elements. Injected as attributes on <html>.
const TAG_RUNTIME = `(() => {
  const els = document.querySelectorAll('*');
  let hidden = 0;
  for (const el of els) {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') {
      el.setAttribute('data-elx-js-hidden', '1');
      hidden++;
    }
  }
  return { elements: els.length, jsHidden: hidden, title: document.title };
})()`;

export async function browserCapture(url, opts = {}) {
  if (String(process.env.ELX_BROWSER || '1') === '0') return null;
  const deps = await loadBrowserDeps();
  if (!deps) return null;
  const { chromium, puppeteer } = deps;

  const log = opts.log || (() => {});
  let browser = null;
  try {
    log('Launching headless Chromium…');
    const execPath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: [...chromium.args, '--disable-dev-shm-usage', '--no-sandbox'],
      defaultViewport: VIEWPORT,
      executablePath: execPath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(opts.timeoutMs || 45000);

    const failedRequests = [];
    page.on('requestfailed', (r) => {
      try {
        if (/document|stylesheet|image|media/i.test(r.resourceType())) failedRequests.push(r.url().slice(0, 200));
      } catch { /* noop */ }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: opts.timeoutMs || 45000 });

    log('Waiting for network idle, JavaScript and AJAX…');
    try {
      await page.waitForNetworkIdle({ idleTime: 900, timeout: 12000 });
    } catch { /* long-pollers never idles — fine */ }

    log('Scrolling to trigger lazy loading and observers…');
    await page.evaluate(AUTO_SCROLL);
    await new Promise((r) => setTimeout(r, 900));

    // font loading settles late
    try {
      await page.evaluate('document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()');
    } catch { /* noop */ }

    log('Collecting rendered DOM…');
    const runtime = await page.evaluate(TAG_RUNTIME);
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const finalUrl = page.url();

    return {
      html,
      finalUrl,
      title: (runtime && runtime.title) || '',
      runtime: { elements: runtime.elements, jsHidden: runtime.jsHidden },
      failedRequests: failedRequests.slice(0, 20),
      engine: 'chromium',
    };
  } catch (err) {
    if (opts.warn) opts.warn(`browser capture unavailable: ${String((err && err.message) || err).split('\n')[0].slice(0, 160)}`);
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* noop */ }
    }
  }
}
