import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { WidgetMapRow } from '../lib/types';
import { Spinner, ErrorBox, Tag, SectionTitle } from '../components/Bits';

export default function Mapping() {
  const [rows, setRows] = useState<WidgetMapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');

  const load = () => {
    setLoading(true);
    setError('');
    fetch('/api/catalog')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Failed to load widget map');
        setRows(d.widgets || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const cats = useMemo(() => ['all', ...Array.from(new Set(rows.map((r) => r.category)))], [rows]);
  const filtered = rows.filter(
    (r) =>
      (cat === 'all' || r.category === cat) &&
      (q === '' ||
        (r.source_element + r.elementor_widget + r.notes).toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <SectionTitle
        kicker="conversion rules"
        title="DOM → Elementor widget map"
        sub="The exact translation table the engine applies while walking the source document. Pro rules activate when the Pro widget set is enabled."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-edge2 bg-void/70 px-3 py-2 focus-within:border-volt/60 sm:max-w-sm">
          <Search size={15} className="text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search element or widget…"
            className="w-full bg-transparent font-mono text-xs text-ink outline-none placeholder:text-dim"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition ${
                cat === c ? 'border-volt/50 bg-volt/12 text-volt' : 'border-edge2 text-muted hover:text-ink'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="glass rounded-2xl p-6">
          <Spinner label="loading widget map…" />
        </div>
      )}
      {error && !loading && <ErrorBox message={error} onRetry={load} />}

      {!loading && !error && (
        <div className="glass overflow-hidden rounded-2xl">
          <div className="hidden grid-cols-12 gap-3 border-b border-edge px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-dim md:grid">
            <div className="col-span-3">source element</div>
            <div className="col-span-3">elementor widget</div>
            <div className="col-span-6">behaviour</div>
          </div>
          {filtered.map((r) => (
            <div key={r.id} className="grid grid-cols-1 gap-1 border-b border-edge/60 px-4 py-3 transition last:border-0 hover:bg-white/3 md:grid-cols-12 md:gap-3">
              <div className="md:col-span-3">
                <code className="font-mono text-xs text-volt">{r.source_element}</code>
              </div>
              <div className="flex items-center gap-2 md:col-span-3">
                <code className="font-mono text-xs text-cyan">{r.elementor_widget}</code>
                {r.requires_pro && <Tag tone="magenta">pro</Tag>}
              </div>
              <div className="text-[13px] leading-relaxed text-muted md:col-span-6">{r.notes}</div>
            </div>
          ))}
          {!filtered.length && <div className="px-4 py-8 text-center text-sm text-dim">No rules match that filter.</div>}
        </div>
      )}
    </div>
  );
}
