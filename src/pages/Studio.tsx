import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Globe, Zap, Layers, Image as ImageIcon, Palette, Clock, Download, Sparkles, Settings2, ChevronDown, Eye, Braces, ListTree, Boxes, ExternalLink,
} from 'lucide-react';
import type { CloneResult, SampleRow } from '../lib/types';
import { Tag, Stat, Spinner, ErrorBox } from '../components/Bits';
import StructureTree from '../components/StructureTree';
import JsonViewer from '../components/JsonViewer';
import RenderPreview from '../components/RenderPreview';

const PHASES = [
  'Resolving host & fetching HTML…',
  'Stripping scripts, styles & hidden nodes…',
  'Detecting page sections and column grids…',
  'Mapping DOM nodes → Elementor widgets…',
  'Extracting colors, fonts and media assets…',
  'Serialising Elementor template JSON…',
];

type Tab = 'structure' | 'preview' | 'json' | 'assets';

export default function Studio() {
  const [url, setUrl] = useState('https://polytechpvcprofile.com/');
  const [mode, setMode] = useState<'section' | 'container'>('section');
  const [pro, setPro] = useState(false);
  const [maxSections, setMaxSections] = useState(30);
  const [advanced, setAdvanced] = useState(false);

  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CloneResult | null>(null);
  const [tab, setTab] = useState<Tab>('structure');
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [urlError, setUrlError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => r.json())
      .then((d) => setSamples(d.samples || []))
      .catch(() => setSamples([]));
  }, []);

  useEffect(() => {
    if (!loading) return;
    setPhase(0);
    const t = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 1300);
    return () => clearInterval(t);
  }, [loading]);

  const run = useCallback(
    async (target?: string) => {
      const raw = (target ?? url).trim();
      if (!raw || !/\.[a-z]{2,}/i.test(raw)) {
        setUrlError('Enter a valid website address, e.g. example.com');
        return;
      }
      setUrlError('');
      setError('');
      setLoading(true);
      setResult(null);
      try {
        const res = await fetch('/api/clone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: raw, mode, pro, maxSections }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        setResult(data);
        setTab('structure');
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [url, mode, pro, maxSections]
  );

  const fileName = result ? `webclonerelx-${result.meta.host.replace(/[^a-z0-9]+/gi, '-')}-${mode}.json` : 'template.json';

  return (
    <div className="space-y-8">
      {/* Hero + control deck */}
      <section className="rise">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="volt">
            <Sparkles size={11} /> v1.0
          </Tag>
          <Tag tone="cyan">Elementor 3.x schema</Tag>
          <Tag>Section/Column · Flexbox Container</Tag>
        </div>
        <h1 className="mt-4 max-w-3xl font-display text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">
          Clone any website into
          <span className="text-volt"> Elementor blocks</span> and export the JSON.
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
          WebClonerELX scrapes a live page, rebuilds its section → column → widget hierarchy, maps every DOM node to a
          native Elementor widget and emits an import-ready template file.
        </p>
      </section>

      {/* Console */}
      <section className="glass scan relative overflow-hidden rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-edge2 bg-void/70 px-3 py-2.5 focus-within:border-volt/60">
            <Globe size={16} className="shrink-0 text-dim" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && run()}
              placeholder="https://example.com"
              spellCheck={false}
              className="w-full bg-transparent font-mono text-sm text-ink outline-none placeholder:text-dim"
            />
          </div>
          <button
            onClick={() => run()}
            disabled={loading}
            className="volt-glow flex items-center justify-center gap-2 rounded-xl bg-volt px-6 py-3 font-display text-sm font-bold text-void transition hover:bg-volt2 disabled:opacity-50"
          >
            <Zap size={16} />
            {loading ? 'Converting…' : 'Clone → Elementor'}
          </button>
        </div>

        {urlError && <p className="mt-2 font-mono text-xs text-magenta">{urlError}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAdvanced((a) => !a)}
            className="flex items-center gap-1.5 rounded-lg border border-edge2 px-2.5 py-1.5 font-mono text-[11px] text-muted transition hover:border-volt/50 hover:text-volt"
          >
            <Settings2 size={12} /> options
            <ChevronDown size={12} className={advanced ? 'rotate-180 transition' : 'transition'} />
          </button>
          <span className="font-mono text-[11px] text-dim">samples:</span>
          {samples.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setUrl(s.url);
                run(s.url);
              }}
              title={s.note}
              className="rounded-lg border border-edge2 px-2.5 py-1.5 font-mono text-[11px] text-muted transition hover:border-cyan/50 hover:text-cyan"
            >
              {s.label}
            </button>
          ))}
        </div>

        {advanced && (
          <div className="mt-3 grid gap-3 rounded-xl border border-edge bg-void/50 p-3 sm:grid-cols-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">structure mode</div>
              <div className="mt-1.5 flex rounded-lg border border-edge2 p-0.5">
                {(['section', 'container'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 rounded-md px-2 py-1.5 font-mono text-[11px] transition ${
                      mode === m ? 'bg-volt text-void font-semibold' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {m === 'section' ? 'Section/Column' : 'Flex Container'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">widget set</div>
              <div className="mt-1.5 flex rounded-lg border border-edge2 p-0.5">
                {[
                  { v: false, l: 'Free' },
                  { v: true, l: 'Pro widgets' },
                ].map((o) => (
                  <button
                    key={o.l}
                    onClick={() => setPro(o.v)}
                    className={`flex-1 rounded-md px-2 py-1.5 font-mono text-[11px] transition ${
                      pro === o.v ? 'bg-cyan text-void font-semibold' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
                max sections · {maxSections}
              </div>
              <input
                type="range"
                min={4}
                max={40}
                value={maxSections}
                onChange={(e) => setMaxSections(Number(e.target.value))}
                className="mt-3 w-full accent-[#d8ff3e]"
              />
            </div>
          </div>
        )}

        {loading && (
          <div className="mt-4 rounded-xl border border-edge bg-void/60 p-4">
            <Spinner label={PHASES[phase]} />
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-edge">
              <div className="sweep h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-volt to-transparent" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {PHASES.map((p, i) => (
                <div key={p} className={`flex items-center gap-1.5 font-mono text-[10px] ${i <= phase ? 'text-volt' : 'text-dim'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${i === phase ? 'bg-volt pulse-dot' : i < phase ? 'bg-volt' : 'bg-edge2'}`} />
                  {p.replace('…', '')}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="mt-4">
            <ErrorBox message={error} onRetry={() => run()} />
          </div>
        )}
      </section>

      {/* Result */}
      {result && (
        <section ref={resultRef} className="rise space-y-5">
          <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-4">
            <img
              src={result.meta.favicon}
              alt=""
              className="h-10 w-10 rounded-lg border border-edge bg-white/5 object-contain p-1"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
            />
            <div className="min-w-0">
              <div className="truncate font-display text-lg font-bold">{result.meta.title}</div>
              <a
                href={result.meta.finalUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 font-mono text-[11px] text-cyan hover:underline"
              >
                {result.meta.finalUrl} <ExternalLink size={10} />
              </a>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Tag tone="amber">{result.meta.platform}</Tag>
              <Tag tone="cyan">{result.options.mode === 'container' ? 'flex container' : 'section/column'}</Tag>
              <Tag tone={result.stats.extraction === 'native-elementor' ? 'volt' : 'edge'}>{result.stats.extraction}</Tag>
              <Tag>{result.meta.fetchedVia}</Tag>
              {result.jobId && <Tag tone="volt">job #{result.jobId}</Tag>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="sections" value={result.stats.sections} accent="#d8ff3e" />
            <Stat label="widgets" value={result.stats.widgets} accent="#3ee0ff" />
            <Stat label="images" value={result.stats.images} accent="#ff5cad" />
            <Stat label="css rules" value={result.stats.cssRules ?? 0} />
            <Stat label="json size" value={`${result.stats.jsonKb} KB`} />
            <Stat label="duration" value={`${(result.stats.durationMs / 1000).toFixed(2)}s`} accent="#ffb547" />
          </div>

          {/* design tokens */}
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <Palette size={15} className="text-volt" />
              <span className="font-display text-sm font-semibold">Extracted global kit</span>
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">system colors</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {result.design.colors.slice(0, 10).map((c) => (
                    <div key={c.hex} className="flex items-center gap-1.5 rounded-lg border border-edge2 bg-void/60 px-2 py-1">
                      <span className="h-4 w-4 rounded border border-edge2" style={{ background: c.hex }} />
                      <span className="font-mono text-[11px] text-muted">{c.hex}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">typography detected</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {result.design.fonts.length ? (
                    result.design.fonts.map((f) => (
                      <span key={f} className="rounded-lg border border-edge2 bg-void/60 px-2.5 py-1 text-xs text-muted">
                        {f}
                      </span>
                    ))
                  ) : (
                    <span className="font-mono text-[11px] text-dim">theme defaults / no explicit families</span>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-volt/30 bg-volt/8 px-2.5 py-1 font-mono text-[11px] text-volt">
                    primary <span className="h-3 w-3 rounded" style={{ background: result.design.primary }} />
                    {result.design.primary}
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg border border-edge2 px-2.5 py-1 font-mono text-[11px] text-muted">
                    secondary <span className="h-3 w-3 rounded" style={{ background: result.design.secondary }} />
                    {result.design.secondary}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { k: 'structure' as Tab, l: 'Structure tree', i: ListTree },
              { k: 'preview' as Tab, l: 'Block preview', i: Eye },
              { k: 'json' as Tab, l: 'Elementor JSON', i: Braces },
              { k: 'assets' as Tab, l: `Assets (${result.assets.length})`, i: ImageIcon },
            ].map(({ k, l, i: Icon }) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] transition ${
                  tab === k ? 'border-volt/50 bg-volt/12 text-volt' : 'border-edge2 text-muted hover:text-ink'
                }`}
              >
                <Icon size={14} /> {l}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 font-mono text-[11px] text-dim">
              <Clock size={12} /> {result.createdAt ? new Date(result.createdAt).toLocaleString() : 'just now'}
            </div>
          </div>

          {tab === 'structure' && <StructureTree sections={result.sections} />}
          {tab === 'preview' && <RenderPreview sections={result.sections} primary={result.design.primary} />}
          {tab === 'json' && (
            <div className="space-y-3">
              <div className="glass flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-xs text-muted">
                <Download size={14} className="text-volt" />
                Download and import via <span className="font-mono text-cyan">Elementor → Templates → Import Templates</span>, then
                insert it on any page from <span className="font-mono text-cyan">My Templates</span>.
              </div>
              <JsonViewer data={result.elementor} filename={fileName} />
            </div>
          )}
          {tab === 'assets' && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {result.assets.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="glass group overflow-hidden rounded-xl transition hover:border-volt/40"
                >
                  <div className="flex h-28 items-center justify-center bg-void/60 p-2">
                    <img
                      src={a.url}
                      alt={a.alt}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = '0.15')}
                    />
                  </div>
                  <div className="border-t border-edge px-2 py-1.5">
                    <div className="truncate font-mono text-[10px] text-muted">{a.url.split('/').pop()}</div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-dim">{a.type}</div>
                  </div>
                </a>
              ))}
              {!result.assets.length && <div className="text-sm text-dim">No media assets detected.</div>}
            </div>
          )}

          {/* widget breakdown */}
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <Boxes size={15} className="text-volt" />
              <span className="font-display text-sm font-semibold">Widget breakdown</span>
            </div>
            <div className="mt-3 space-y-2">
              {Object.entries(result.stats.byType)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => {
                  const pct = Math.round((v / result.stats.widgets) * 100);
                  return (
                    <div key={k} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 font-mono text-[11px] text-cyan">{k}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
                        <div className="h-full rounded-full bg-gradient-to-r from-volt2 to-volt" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-14 text-right font-mono text-[11px] text-muted">
                        {v} · {pct}%
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </section>
      )}

      {!result && !loading && (
        <section className="grid gap-3 md:grid-cols-3">
          {[
            { i: Globe, t: 'Universal scraper', d: 'Works on WordPress, Shopify, Wix, Webflow, Next.js or fully custom HTML. Auto-fallback proxies handle blocked hosts.' },
            { i: Layers, t: 'Real Elementor tree', d: 'Sections, columns and widget settings — typography, colors, links, backgrounds — not a flat HTML dump.' },
            { i: Download, t: 'Import-ready JSON', d: 'Schema v0.4 template file you can drop straight into Elementor → Templates → Import.' },
          ].map(({ i: Icon, t, d }) => (
            <div key={t} className="glass rounded-2xl p-5">
              <Icon size={20} className="text-volt" />
              <h3 className="mt-3 font-display text-base font-bold">{t}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{d}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
