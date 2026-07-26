import { useCallback, useEffect, useState } from 'react';
import { Trash2, RefreshCw, Download, Eye, ExternalLink } from 'lucide-react';
import type { JobRow, CloneResult } from '../lib/types';
import { Spinner, ErrorBox, Tag, SectionTitle } from '../components/Bits';
import JsonViewer from '../components/JsonViewer';
import StructureTree from '../components/StructureTree';

export default function HistoryPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CloneResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/jobs');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load history');
      setJobs(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (id: number) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/jobs?id=${id}`);
      const data = await res.json();
      setDetail(data.result || null);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const remove = async (id: number) => {
    await fetch('/api/jobs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
    }
    load();
  };

  const downloadJob = async (id: number, host: string) => {
    const res = await fetch(`/api/jobs?id=${id}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data.result?.elementor ?? {}, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `webclonerelx-${host.replace(/[^a-z0-9]+/gi, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <SectionTitle
          kicker="conversion log"
          title="Clone history"
          sub="Every conversion is persisted with its full Elementor payload — reopen, inspect and re-download at any time."
        />
        <button
          onClick={load}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-edge2 px-3 py-2 font-mono text-[11px] text-muted transition hover:border-volt/50 hover:text-volt"
        >
          <RefreshCw size={13} /> refresh
        </button>
      </div>

      {loading && (
        <div className="glass rounded-2xl p-6">
          <Spinner label="loading conversion history…" />
        </div>
      )}
      {error && !loading && <ErrorBox message={error} onRetry={load} />}

      {!loading && !error && !jobs.length && (
        <div className="glass rounded-2xl p-8 text-center">
          <p className="font-display text-lg font-bold">No conversions yet</p>
          <p className="mt-1 text-sm text-muted">Run your first clone from the Studio tab.</p>
        </div>
      )}

      <div className="space-y-2">
        {jobs.map((j) => (
          <div key={j.id} className="glass overflow-hidden rounded-xl">
            <div className="flex flex-wrap items-center gap-3 px-3 py-3">
              <img
                src={j.favicon || `https://www.google.com/s2/favicons?domain=${j.host}&sz=32`}
                alt=""
                className="h-7 w-7 rounded border border-edge bg-white/5 object-contain p-0.5"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-sm font-semibold">{j.page_title}</div>
                <a
                  href={j.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 font-mono text-[11px] text-dim hover:text-cyan"
                >
                  {j.host} <ExternalLink size={9} />
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {j.status === 'success' ? (
                  <>
                    <Tag tone="volt">{j.sections_count} sections</Tag>
                    <Tag tone="cyan">{j.widgets_count} widgets</Tag>
                    <Tag>{j.mode === 'container' ? 'flex' : 'section'}</Tag>
                    <Tag tone="amber">{j.platform}</Tag>
                  </>
                ) : (
                  <Tag tone="magenta">failed</Tag>
                )}
                <span className="font-mono text-[10px] text-dim">{new Date(j.created_at).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1">
                {j.status === 'success' && (
                  <>
                    <button
                      onClick={() => open(j.id)}
                      title="Inspect"
                      className="rounded-md border border-edge2 p-1.5 text-muted transition hover:border-volt/50 hover:text-volt"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      onClick={() => downloadJob(j.id, j.host)}
                      title="Download JSON"
                      className="rounded-md border border-edge2 p-1.5 text-muted transition hover:border-cyan/50 hover:text-cyan"
                    >
                      <Download size={14} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => remove(j.id)}
                  title="Delete"
                  className="rounded-md border border-edge2 p-1.5 text-muted transition hover:border-magenta/50 hover:text-magenta"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {j.status === 'error' && j.error && (
              <div className="border-t border-edge bg-magenta/5 px-4 py-2 font-mono text-[11px] text-magenta">{j.error}</div>
            )}

            {openId === j.id && (
              <div className="space-y-3 border-t border-edge bg-void/40 p-3">
                {detailLoading && <Spinner label="loading payload…" />}
                {detail && (
                  <>
                    <StructureTree sections={detail.sections} />
                    <JsonViewer data={detail.elementor} filename={`webclonerelx-${j.host}.json`} />
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
