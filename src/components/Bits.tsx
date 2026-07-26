import type { ReactNode } from 'react';

export function Tag({ children, tone = 'edge' }: { children: ReactNode; tone?: 'edge' | 'volt' | 'cyan' | 'magenta' | 'amber' }) {
  const tones: Record<string, string> = {
    edge: 'border-edge2 text-muted bg-panel2',
    volt: 'border-volt/40 text-volt bg-volt/10',
    cyan: 'border-cyan/40 text-cyan bg-cyan/10',
    magenta: 'border-magenta/40 text-magenta bg-magenta/10',
    amber: 'border-amber/40 text-amber bg-amber/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="glass rounded-xl px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <span className="relative flex h-4 w-4">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-edge2 border-t-volt" />
      </span>
      {label ? <span className="font-mono text-xs">{label}</span> : null}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-magenta/40 bg-magenta/8 px-4 py-3 text-sm">
      <div className="font-display font-semibold text-magenta">Conversion failed</div>
      <p className="mt-1 text-muted">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-magenta/40 px-3 py-1.5 font-mono text-xs text-magenta transition hover:bg-magenta/15"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function SectionTitle({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-volt">{kicker}</div>
      <h2 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {sub && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}
