import { useState } from 'react';
import {
  ChevronRight, Columns3, Image as ImageIcon, Heading1, Type, MousePointerClick, List, Minus, Film, Map, Code2,
  FileInput, Quote, Table2, Menu, Box, GalleryHorizontal, Share2, MoveVertical, Rows3,
} from 'lucide-react';
import type { CloneSection, PreviewBlock, PreviewColumn } from '../lib/types';
import { Tag } from './Bits';

const ICONS: Record<string, typeof Type> = {
  heading: Heading1,
  'text-editor': Type,
  image: ImageIcon,
  button: MousePointerClick,
  'icon-list': List,
  'nav-menu': Menu,
  'icon-box': Box,
  'image-carousel': GalleryHorizontal,
  'image-gallery': ImageIcon,
  'loop-carousel': GalleryHorizontal,
  'social-icons': Share2,
  divider: Minus,
  spacer: MoveVertical,
  video: Film,
  google_maps: Map,
  html: Code2,
  form: FileInput,
  shortcode: FileInput,
  blockquote: Quote,
  table: Table2,
};

const TYPE_TONE: Record<string, 'volt' | 'cyan' | 'magenta' | 'amber' | 'edge'> = {
  header: 'cyan',
  footer: 'cyan',
  hero: 'volt',
  features: 'amber',
  gallery: 'magenta',
  testimonials: 'magenta',
  pricing: 'amber',
  contact: 'cyan',
  cta: 'volt',
};

function detailOf(b: Extract<PreviewBlock, { kind: 'widget' }>) {
  const p = b.preview || { kind: '' };
  if (p.kind === 'image') return p.url ? p.url.split('/').pop() || p.url : '';
  if (p.kind === 'carousel') return `${(p.images || []).length} slides${p.slideHeight ? ` · ${Math.round(p.slideHeight)}px tall` : ''}`;
  if (p.kind === 'gallery') return `${(p.images || []).length} images (grid)`;
  if (p.kind === 'menu') return (p.items || []).slice(0, 5).map((i) => (typeof i === 'string' ? i : i.text)).join(' · ');
  if (p.kind === 'list') return (p.items || []).slice(0, 4).map((i) => (typeof i === 'string' ? i : i.text)).join(' · ');
  if (p.kind === 'button') return `${p.text} → ${p.url ? p.url.replace(/^https?:\/\//, '').slice(0, 40) : '#'}`;
  if (p.kind === 'iconbox') return p.desc || p.text || '';
  if (p.kind === 'form') return `${p.count} fields · submit "${p.submit}"`;
  if (p.kind === 'spacer') return `${p.height}px`;
  return p.text || '';
}

function WidgetRow({ b }: { b: Extract<PreviewBlock, { kind: 'widget' }> }) {
  const Icon = ICONS[b.type] || Code2;
  const p = b.preview || { kind: '' };
  const detail = detailOf(b);

  return (
    <div className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-white/4">
      <Icon size={14} className="mt-0.5 shrink-0 text-volt" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-cyan">{b.type}</span>
          <span className="text-[11px] text-dim">{b.label}</span>
          {p.align && p.align !== 'left' && <Tag tone="amber">{p.align}</Tag>}
          {p.width?.mode === 'auto' && <Tag>auto-w</Tag>}
          {p.width?.mode === 'pct' && <Tag>{p.width.value}%</Tag>}
          {p.color && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-dim">
              <span className="h-2.5 w-2.5 rounded-sm border border-edge2" style={{ background: p.color }} />
              {p.color}
            </span>
          )}
        </div>
        {detail && <div className="mt-0.5 truncate text-xs text-muted">{detail}</div>}
      </div>
    </div>
  );
}

function ColumnBlock({ col, index, total, depth }: { col: PreviewColumn; index: number; total: number; depth: number }) {
  return (
    <div className="rounded-lg border border-edge/70 bg-void/40 p-2">
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
        <span>
          col {index + 1}/{total} · {col.width}%
        </span>
        {col.align !== 'left' && <span className="text-amber">{col.align}</span>}
        {col.valign !== 'flex-start' && <span className="text-cyan">v:{col.valign.replace('flex-', '')}</span>}
        {col.background?.color && (
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm border border-edge2" style={{ background: col.background.color }} />
          </span>
        )}
      </div>
      {col.blocks.length ? (
        col.blocks.map((b, i) =>
          b.kind === 'widget' ? (
            <WidgetRow key={i} b={b} />
          ) : (
            <div key={i} className="my-1.5 rounded-lg border border-cyan/25 bg-cyan/5 p-2">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan">
                <Rows3 size={11} /> inner section · {b.columns.length} columns · gap {b.gap}px
              </div>
              <div className={`grid gap-2 ${b.columns.length > 1 ? 'md:grid-cols-2 xl:grid-cols-3' : ''}`}>
                {b.columns.map((c, ci) => (
                  <ColumnBlock key={ci} col={c} index={ci} total={b.columns.length} depth={depth + 1} />
                ))}
              </div>
            </div>
          )
        )
      ) : (
        <div className="px-2 py-1 text-xs text-dim">empty</div>
      )}
    </div>
  );
}

export default function StructureTree({ sections }: { sections: CloneSection[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true, 1: true });

  return (
    <div className="space-y-2">
      {sections.map((s) => {
        const isOpen = !!open[s.index];
        return (
          <div key={s.index} className="glass overflow-hidden rounded-xl">
            <button
              onClick={() => setOpen((o) => ({ ...o, [s.index]: !isOpen }))}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/4"
            >
              <ChevronRight size={15} className={`shrink-0 text-dim transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <span className="font-display text-sm font-semibold">{s.name}</span>
              <Tag tone={TYPE_TONE[s.type] || 'edge'}>{s.type}</Tag>
              <span className="ml-auto hidden items-center gap-3 font-mono text-[11px] text-dim sm:flex">
                <span className="flex items-center gap-1">
                  <Columns3 size={12} /> {s.columnCount}
                </span>
                <span>{s.widgetCount} widgets</span>
                <span>{s.contentWidth}px</span>
                <span>
                  pad {s.padding?.top}/{s.padding?.bottom}
                </span>
                {s.background?.color && (
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded-sm border border-edge2" style={{ background: s.background.color }} />
                    {s.background.color}
                  </span>
                )}
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-edge px-3 py-2">
                <div className={`grid gap-2 ${s.columns.length > 1 ? 'md:grid-cols-2 xl:grid-cols-3' : ''}`}>
                  {s.columns.map((c, ci) => (
                    <ColumnBlock key={ci} col={c} index={ci} total={s.columns.length} depth={0} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
