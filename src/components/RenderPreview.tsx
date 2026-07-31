import { useState } from 'react';
import { Monitor, Smartphone, Ruler } from 'lucide-react';
import type { CloneSection, PreviewBlock, PreviewColumn, WidgetPreview } from '../lib/types';

/**
 * Pixel-faithful approximation of the cloned page.
 * Widths, paddings, alignment, colours and typography all come from the
 * resolved CSS cascade — nothing here is hard-coded per site.
 */

const num = (v: string | number | null | undefined, fb = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fb;
};

function justifyFor(align: string) {
  if (align === 'center') return 'center';
  if (align === 'right') return 'flex-end';
  return 'flex-start';
}

function Widget({ b, scale, primary }: { b: Extract<PreviewBlock, { kind: 'widget' }>; scale: number; primary: string }) {
  const p: WidgetPreview = b.preview || { kind: '' };
  const align = p.align || 'left';
  const s = (v: number) => Math.max(1, v * scale);
  const selfWidth = p.width?.mode === 'auto' ? 'auto' : p.width?.mode === 'pct' ? `${p.width.value}%` : '100%';

  const wrap = (node: React.ReactNode) => (
    <div style={{ width: selfWidth, maxWidth: '100%', textAlign: align as never }}>{node}</div>
  );

  switch (b.type) {
    case 'heading': {
      const size = s(num(p.size, [0, 40, 32, 26, 20, 17, 15][p.level || 2] || 20));
      return wrap(
        <div
          style={{
            fontSize: size,
            fontWeight: num(p.weight, 700),
            fontFamily: p.family || undefined,
            color: p.color || 'inherit',
            lineHeight: 1.22,
            margin: 0,
          }}
        >
          {p.text}
        </div>
      );
    }

    case 'text-editor':
    case 'blockquote':
      return wrap(
        <p
          style={{
            fontSize: s(num(p.size, 14)),
            color: p.color || 'inherit',
            lineHeight: 1.65,
            margin: 0,
            opacity: 0.92,
            ...(b.type === 'blockquote' ? { borderLeft: `3px solid ${primary}`, paddingLeft: s(10), fontStyle: 'italic' } : {}),
          }}
        >
          {(p.text || '').slice(0, 420)}
        </p>
      );

    case 'image': {
      const w = p.natWidth ? Math.min(p.natWidth * scale, 10000) : undefined;
      return (
        <div style={{ display: 'flex', justifyContent: justifyFor(align), width: selfWidth, maxWidth: '100%' }}>
          <img
            src={p.url}
            alt={p.text || ''}
            loading="lazy"
            style={{ width: w ? w : '100%', maxWidth: '100%', height: 'auto', display: 'block' }}
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
          />
        </div>
      );
    }

    case 'button':
      return (
        <div style={{ display: 'flex', justifyContent: justifyFor(align), width: '100%' }}>
          <span
            style={{
              background: p.bg || primary,
              color: p.fg || '#fff',
              borderRadius: s(p.radius ?? 4),
              padding: `${s(9)}px ${s(20)}px`,
              fontSize: s(num(p.size, 13)),
              fontWeight: num(p.weight, 600),
              whiteSpace: 'nowrap',
            }}
          >
            {p.text}
          </span>
        </div>
      );

    case 'icon-list': {
      const items = (p.items || []) as string[];
      return (
        <ul
          style={{
            display: 'flex',
            flexDirection: p.inline ? 'row' : 'column',
            flexWrap: 'wrap',
            gap: p.inline ? s(22) : s(8),
            justifyContent: justifyFor(align),
            listStyle: 'none',
            margin: 0,
            padding: 0,
            width: '100%',
          }}
        >
          {items.slice(0, 12).map((it, i) => (
            <li key={i} style={{ display: 'flex', gap: s(6), alignItems: 'center', fontSize: s(13), color: p.color || 'inherit' }}>
              <span style={{ color: p.iconColor || primary, fontSize: s(11) }}>●</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    }

    case 'nav-menu': {
      const items = (p.items || []) as { text: string; children?: string[] }[];
      return (
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: s(18), justifyContent: justifyFor(align), width: '100%' }}>
          {items.slice(0, 10).map((it, i) => (
            <span key={i} style={{ fontSize: s(13), fontWeight: 500, color: p.color || 'inherit', whiteSpace: 'nowrap' }}>
              {typeof it === 'string' ? it : it.text}
              {typeof it !== 'string' && it.children && it.children.length ? ' ▾' : ''}
            </span>
          ))}
        </nav>
      );
    }

    case 'icon-box':
      return (
        <div style={{ textAlign: (align as never) || 'center', width: '100%' }}>
          {p.iconUrl ? (
            <img src={p.iconUrl} alt="" style={{ width: s(46), height: s(46), objectFit: 'contain', margin: align === 'center' ? '0 auto' : 0 }} />
          ) : (
            <div
              style={{
                width: s(42),
                height: s(42),
                borderRadius: '50%',
                background: primary,
                opacity: 0.9,
                margin: align === 'center' ? '0 auto' : 0,
              }}
            />
          )}
          <div style={{ marginTop: s(8), fontSize: s(14), fontWeight: 700, lineHeight: 1.3 }}>{p.text}</div>
          {p.desc && <div style={{ marginTop: s(4), fontSize: s(12), opacity: 0.8, lineHeight: 1.5 }}>{p.desc}</div>}
        </div>
      );

    case 'image-carousel': {
      const imgs = p.images || [];
      const hero = imgs.length && (p.slideHeight || 0) > 200;
      return (
        <div style={{ display: 'flex', gap: s(8), overflow: 'hidden', width: '100%', position: 'relative' }}>
          {imgs.slice(0, hero ? 1 : 4).map((u, i) => (
            <div key={i} style={{ flex: '1 1 0', minWidth: 0, position: 'relative' }}>
              <img
                src={u}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: hero ? s(p.slideHeight || 320) : s(150), objectFit: 'cover', borderRadius: hero ? 0 : s(6) }}
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
              />
              {(p.captions || [])[i] && (
                <div
                  style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0, padding: `${s(16)}px ${s(10)}px ${s(6)}px`,
                    background: 'linear-gradient(transparent, rgba(0,0,0,.7))', color: '#fff', fontSize: s(12), fontWeight: 600,
                  }}
                >
                  {p.captions![i]}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'image-gallery': {
      const imgs = p.images || [];
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: s(10), width: '100%' }}>
          {imgs.slice(0, 9).map((u, i) => (
            <img
              key={i}
              src={u}
              alt=""
              loading="lazy"
              style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: s(6) }}
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
            />
          ))}
        </div>
      );
    }

    case 'loop-carousel': {
      const cards = p.cards || [];
      return (
        <div style={{ display: 'flex', gap: s(10), width: '100%' }}>
          {cards.slice(0, 3).map((c, i) => (
            <div key={i} style={{ flex: '1 1 0', minWidth: 0 }}>
              {c.image && (
                <img src={c.image} alt="" loading="lazy" style={{ width: '100%', height: s(110), objectFit: 'cover', borderRadius: s(6) }} />
              )}
              <div style={{ marginTop: s(5), fontSize: s(12), fontWeight: 600 }}>{c.title}</div>
            </div>
          ))}
        </div>
      );
    }

    case 'form':
    case 'shortcode':
      return (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: s(7) }}>
          {(p.fields || ['Name', 'Email', 'Message']).slice(0, 5).map((f, i) => (
            <div
              key={i}
              style={{
                border: '1px solid rgba(128,128,128,.4)',
                borderRadius: s(4),
                padding: `${s(8)}px ${s(10)}px`,
                fontSize: s(12),
                opacity: 0.65,
              }}
            >
              {f}
            </div>
          ))}
          <span
            style={{
              alignSelf: justifyFor(align) === 'center' ? 'center' : justifyFor(align) === 'flex-end' ? 'flex-end' : 'flex-start',
              background: primary,
              color: '#fff',
              borderRadius: s(4),
              padding: `${s(8)}px ${s(18)}px`,
              fontSize: s(12),
              fontWeight: 600,
            }}
          >
            {p.submit || 'Submit'}
          </span>
        </div>
      );

    case 'divider':
      return <hr style={{ width: '100%', border: 0, borderTop: '1px solid rgba(128,128,128,.35)', margin: 0 }} />;

    case 'spacer':
      return <div style={{ height: s(p.height || 40), width: '100%' }} />;

    case 'social-icons':
      return (
        <div style={{ display: 'flex', gap: s(8), justifyContent: justifyFor(align), width: '100%' }}>
          {((p.items as string[]) || []).slice(0, 6).map((_u, i) => (
            <span key={i} style={{ width: s(26), height: s(26), borderRadius: '50%', background: primary, opacity: 0.85 }} />
          ))}
        </div>
      );

    case 'video':
    case 'google_maps':
    case 'html':
      return (
        <div
          style={{
            width: '100%',
            border: '1px dashed rgba(128,128,128,.45)',
            borderRadius: s(6),
            padding: `${s(18)}px`,
            textAlign: 'center',
            fontSize: s(11),
            opacity: 0.65,
            fontFamily: 'monospace',
          }}
        >
          {b.type} · {p.widget || p.kind}
        </div>
      );

    default:
      return wrap(<p style={{ fontSize: s(13), opacity: 0.85, margin: 0 }}>{(p.text || '').slice(0, 260)}</p>);
  }
}

function Column({ col, scale, primary }: { col: PreviewColumn; scale: number; primary: string }) {
  return (
    <div
      style={{
        width: `${col.width}%`,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: Math.max(4, 12 * scale),
        alignItems: col.align === 'center' ? 'center' : col.align === 'right' ? 'flex-end' : 'stretch',
        justifyContent: col.valign === 'center' ? 'center' : col.valign === 'flex-end' ? 'flex-end' : 'flex-start',
        background: col.background?.color || undefined,
        backgroundImage: col.background?.image ? `url(${col.background.image})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        boxSizing: 'border-box',
      }}
    >
      {col.blocks.map((b, i) =>
        b.kind === 'widget' ? (
          <Widget key={i} b={b} scale={scale} primary={primary} />
        ) : (
          <div
            key={i}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              width: '100%',
              gap: Math.max(2, (b.gap ?? 20) * scale),
              alignItems: b.alignItems === 'center' ? 'center' : b.alignItems === 'flex-end' ? 'flex-end' : 'flex-start',
              background: b.background?.color || undefined,
            }}
          >
            {b.columns.map((c, ci) => (
              <div
                key={ci}
                style={{
                  width: `calc(${c.width}% - ${(((b.gap ?? 20) * scale) * (b.columns.length - 1)) / b.columns.length}px)`,
                  minWidth: 0,
                }}
              >
                <Column col={{ ...c, width: 100 }} scale={scale} primary={primary} />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

export default function RenderPreview({ sections, primary }: { sections: CloneSection[]; primary: string }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [labels, setLabels] = useState(true);

  const viewport = device === 'desktop' ? 1440 : 390;
  // Render the page at real proportions, scaled down to fit the panel.
  const stageWidth = device === 'desktop' ? 1100 : 390;
  const scale = stageWidth / viewport;

  return (
    <div className="space-y-3">
      <div className="glass flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
        <Ruler size={14} className="text-volt" />
        <span className="font-mono text-[11px] text-muted">
          rendered at {viewport}px viewport · {Math.round(scale * 100)}% scale
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setLabels((l) => !l)}
            className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition ${
              labels ? 'border-volt/50 text-volt' : 'border-edge2 text-muted hover:text-ink'
            }`}
          >
            section labels
          </button>
          <div className="flex rounded-md border border-edge2 p-0.5">
            {[
              { k: 'desktop' as const, i: Monitor },
              { k: 'mobile' as const, i: Smartphone },
            ].map(({ k, i: Icon }) => (
              <button
                key={k}
                onClick={() => setDevice(k)}
                className={`rounded px-2 py-1 transition ${device === k ? 'bg-volt text-void' : 'text-muted hover:text-ink'}`}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-edge bg-white">
        <div style={{ width: stageWidth, margin: '0 auto', color: '#1a1a1a' }}>
          {sections.map((s) => {
            const padT = num(s.padding?.top, 60) * scale;
            const padB = num(s.padding?.bottom, 60) * scale;
            const padL = num(s.padding?.left, 20) * scale;
            const padR = num(s.padding?.right, 20) * scale;
            const inner = Math.min(s.contentWidth * scale, stageWidth - padL - padR);

            return (
              <div key={s.index} style={{ position: 'relative' }}>
                {labels && (
                  <div className="pointer-events-none absolute left-0 top-0 z-10 rounded-br-md bg-volt px-1.5 py-0.5 font-mono text-[9px] font-bold text-void">
                    {s.name} · {s.columnCount}col · {s.contentWidth}px
                  </div>
                )}
                <div
                  style={{
                    background: s.background?.color || undefined,
                    backgroundImage: s.background?.image ? `url(${s.background.image})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    paddingTop: padT,
                    paddingBottom: padB,
                    paddingLeft: padL,
                    paddingRight: padR,
                  }}
                >
                  <div
                    style={{
                      width: inner,
                      maxWidth: '100%',
                      margin: '0 auto',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: Math.max(2, (s.gap ?? 20) * scale),
                      alignItems: s.alignItems === 'center' ? 'center' : s.alignItems === 'flex-end' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {s.columns.map((c, ci) => (
                      <div
                        key={ci}
                        style={{
                          width: `calc(${c.width}% - ${(((s.gap ?? 20) * scale) * (s.columns.length - 1)) / s.columns.length}px)`,
                          minWidth: 0,
                        }}
                      >
                        <Column col={{ ...c, width: 100 }} scale={scale} primary={primary} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
