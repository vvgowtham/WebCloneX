import { useMemo, useState } from 'react';
import { Copy, Check, Download, Braces } from 'lucide-react';

function highlight(json: string) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'text-amber';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'text-cyan' : 'text-volt';
        else if (/true|false/.test(match)) cls = 'text-magenta';
        else if (/null/.test(match)) cls = 'text-dim';
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

export default function JsonViewer({ data, filename }: { data: unknown; filename: string }) {
  const [copied, setCopied] = useState(false);
  const [pretty, setPretty] = useState(true);
  const [limit, setLimit] = useState(140000);

  const text = useMemo(() => JSON.stringify(data, null, pretty ? 2 : 0), [data, pretty]);
  const shown = text.slice(0, limit);
  const html = useMemo(() => highlight(shown), [shown]);
  const kb = Math.round((text.length / 1024) * 10) / 10;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const download = () => {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="glass overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <Braces size={15} className="text-volt" />
        <span className="font-mono text-xs text-muted">{filename}</span>
        <span className="font-mono text-[11px] text-dim">{kb} KB</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPretty((p) => !p)}
            className="rounded-md border border-edge2 px-2.5 py-1 font-mono text-[11px] text-muted transition hover:border-volt/50 hover:text-volt"
          >
            {pretty ? 'minify' : 'prettify'}
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-md border border-edge2 px-2.5 py-1 font-mono text-[11px] text-muted transition hover:border-volt/50 hover:text-volt"
          >
            {copied ? <Check size={12} className="text-volt" /> : <Copy size={12} />} {copied ? 'copied' : 'copy'}
          </button>
          <button
            onClick={download}
            className="flex items-center gap-1.5 rounded-md bg-volt px-2.5 py-1 font-mono text-[11px] font-semibold text-void transition hover:bg-volt2"
          >
            <Download size={12} /> .json
          </button>
        </div>
      </div>
      <pre
        className="max-h-[560px] overflow-auto bg-void/60 p-4 font-mono text-[11.5px] leading-[1.55] text-muted"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {text.length > shown.length && (
        <button
          onClick={() => setLimit((l) => l + 200000)}
          className="w-full border-t border-edge py-2 font-mono text-[11px] text-dim transition hover:bg-white/4 hover:text-volt"
        >
          show more · {Math.round(((text.length - shown.length) / 1024) * 10) / 10} KB remaining
        </button>
      )}
    </div>
  );
}
