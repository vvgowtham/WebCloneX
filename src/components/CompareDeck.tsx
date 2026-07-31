import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Globe, RefreshCw, ExternalLink, Monitor, Laptop, MoveVertical, ListTree, Download, Loader2, AlertTriangle,
} from 'lucide-react';
import type { CloneResult } from '../lib/types';
import { renderElementorDocument, type ElxElement } from '../lib/elementorHtml';

/**
 * Side-by-side fidelity comparison: the live source site (proxied so it can
 * be iframed) on the left, the converted Elementor JSON rendered as real
 * HTML on the right. Both panes run at the same logical viewport with
 * synchronised scrolling.
 */

const DEVICES = [
  { key: 'desktop', label: 'Desktop', width: 1440, icon: Monitor },
  { key: 'laptop', label: 'Laptop', width: 1280, icon: Laptop },
] as const;

type Side = 'source' | 'clone';

const STAGE_H = 620; // css px of visible stage height

function Pane({
  side,
  viewport,
  src,
  srcDoc,
  frameRef,
  onLoad,
  failed,
  fallback,
}: {
  side: Side;
  viewport: number;
  src?: string;
  srcDoc?: string;
  frameRef?: React.RefObject<HTMLIFrameElement | null>;
  onLoad?: () => void;
  failed?: boolean;
  fallback?: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / viewport));
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [viewport]);

  const frameH = scale > 0 ? Math.round(STAGE_H / scale) : STAGE_H;

  return (
    <div ref={boxRef} className="relative bg-white" style={{ height: STAGE_H, overflow: 'hidden' }}>
      <div style={{ width: viewport, height: frameH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <iframe
          ref={frameRef}
          src={src}
          srcDoc={srcDoc}
          title={side === 'source' ? 'Live source website' : 'Converted Elementor JSON render'}
          sandbox="allow-scripts allow-same-origin allow-popups"
          onLoad={onLoad}
          style={{ width: viewport, height: frameH, border: 0, display: 'block', background: '#fff' }}
        />
      </div>
      {side === 'source' && fallback}
      {failed && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-panel px-6 text-center">
          <AlertTriangle size={22} className="text-amber" />
          <p className="text-sm text-muted">The live site could not be loaded for the preview.</p>
        </div>
      )}
    </div>
  );
}

export default function CompareDeck({ result }: { result: CloneResult }) {
  const [device, setDevice] = useState<(typeof DEVICES)[number]['key']>('desktop');
  const [sync, setSync] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [srcReady, setSrcReady] = useState(false);
  const [srcError, setSrcError] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);

  const viewport = DEVICES.find((d) => d.key === device)!.width;

  const sourceRef = useRef<HTMLIFrameElement>(null);
  const cloneRef = useRef<HTMLIFrameElement>(null);
  const suppressUntil = useRef<Record<Side, number>>({ source: 0, clone: 0 });
  const pendingJump = useRef(false);
  const jumpTimer = useRef<number | undefined>(undefined);

  const proxySrc = useMemo(
    () => `/api/proxy?url=${encodeURIComponent(result.meta.finalUrl || result.meta.url)}&r=${reloadKey}`,
    [result.meta.finalUrl, result.meta.url, reloadKey]
  );

  const cloneDoc = useMemo(
    () =>
      renderElementorDocument(result.elementor as unknown as { title?: string; content?: ElxElement[] }, {
        primary: result.design.primary,
        fonts: result.design.fonts,
      }),
    [result]
  );

  // scroll synchronisation between the two iframes
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; side?: Side; ratio?: number } | null;
      if (!d || d.type !== 'elx-scroll' || (d.side !== 'source' && d.side !== 'clone')) return;
      const from: Side = d.side;
      const to: Side = from === 'source' ? 'clone' : 'source';
      if (!sync && !pendingJump.current) return;
      if (Date.now() < suppressUntil.current[from]) return;
      suppressUntil.current[to] = Date.now() + 150;
      const win = (to === 'source' ? sourceRef.current : cloneRef.current)?.contentWindow;
      win?.postMessage({ type: 'elx-scrollto', ratio: d.ratio ?? 0 }, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sync]);

  const jumpTo = (index: number) => {
    pendingJump.current = true;
    window.clearTimeout(jumpTimer.current);
    jumpTimer.current = window.setTimeout(() => {
      pendingJump.current = false;
    }, 900);
    suppressUntil.current.clone = 0;
    cloneRef.current?.contentWindow?.postMessage({ type: 'elx-jump', hash: `elx-sec-${index}` }, '*');
    setJumpOpen(false);
  };

  const downloadCloneHtml = () => {
    const blob = new Blob([cloneDoc], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `webclonerelx-preview-${result.meta.host.replace(/[^a-z0-9]+/gi, '-')}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="glass flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
          <Monitor size={13} className="text-volt" /> viewport {viewport}px
        </span>
        <div className="flex rounded-md border border-edge2 p-0.5">
          {DEVICES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setDevice(key)}
              className={`flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] transition ${
                device === key ? 'bg-volt text-void' : 'text-muted hover:text-ink'
              }`}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setSync((s) => !s)}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition ${
            sync ? 'border-volt/50 bg-volt/10 text-volt' : 'border-edge2 text-muted hover:text-ink'
          }`}
        >
          <MoveVertical size={12} /> sync scroll
        </button>

        <div className="relative">
          <button
            onClick={() => setJumpOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-md border border-edge2 px-2.5 py-1.5 font-mono text-[11px] text-muted transition hover:border-cyan/50 hover:text-cyan"
          >
            <ListTree size={12} /> jump to section
          </button>
          {jumpOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-edge2 bg-panel2 p-1 shadow-xl">
              {result.sections.map((s) => (
                <button
                  key={s.index}
                  onClick={() => jumpTo(s.index)}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left font-mono text-[11px] text-muted transition hover:bg-volt/10 hover:text-volt"
                >
                  <span className="truncate">{s.name}</span>
                  <span className="ml-2 shrink-0 text-dim">
                    {s.columnCount}col · {s.widgetCount}w
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              setSrcReady(false);
              setReloadKey((k) => k + 1);
            }}
            className="flex items-center gap-1.5 rounded-md border border-edge2 px-2.5 py-1.5 font-mono text-[11px] text-muted transition hover:text-ink"
          >
            <RefreshCw size={12} /> reload source
          </button>
          <button
            onClick={downloadCloneHtml}
            className="flex items-center gap-1.5 rounded-md border border-edge2 px-2.5 py-1.5 font-mono text-[11px] text-muted transition hover:text-ink"
            title="Download the rendered clone preview as a standalone HTML file"
          >
            <Download size={12} /> clone html
          </button>
        </div>
      </div>

      {/* panes */}
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="glass overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-cyan/15 font-mono text-[10px] font-bold text-cyan">S</span>
            <span className="font-display text-[13px] font-semibold">Live source</span>
            <a
              href={result.meta.finalUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex min-w-0 items-center gap-1 truncate font-mono text-[10px] text-cyan hover:underline"
            >
              <Globe size={10} className="shrink-0" />
              <span className="truncate">{result.meta.finalUrl}</span>
              <ExternalLink size={9} className="shrink-0" />
            </a>
          </div>
          <Pane
            side="source"
            viewport={viewport}
            key={proxySrc}
            src={proxySrc}
            frameRef={sourceRef}
            onLoad={() => {
              setSrcReady(true);
              setSrcError(false);
            }}
            failed={srcError}
            fallback={
              !srcReady && !srcError ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-panel text-muted">
                  <Loader2 size={22} className="animate-spin text-volt" />
                  <span className="font-mono text-xs">loading live site…</span>
                </div>
              ) : undefined
            }
          />
        </div>

        <div className="glass overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-volt/15 font-mono text-[10px] font-bold text-volt">E</span>
            <span className="font-display text-[13px] font-semibold">Converted Elementor JSON</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-dim">
              {result.sections.length} sections · {result.stats.widgets} widgets · {result.options.mode} mode
            </span>
          </div>
          <Pane side="clone" viewport={viewport} srcDoc={cloneDoc} frameRef={cloneRef} />
        </div>
      </div>

      <p className="font-mono text-[10px] leading-relaxed text-dim">
        Left: the live site served through the WebClonerELX proxy (its X-Frame-Options headers are stripped so it can be
        embedded). Right: the exported Elementor template JSON rendered with Elementor&apos;s own frontend DOM/CSS
        structure — what you get after importing it. Both panes run at {viewport}px and scroll together; use “jump to
        section” to compare any block.
      </p>
    </div>
  );
}
