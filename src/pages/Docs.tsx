import { SectionTitle, Tag } from '../components/Bits';
import { Upload, MousePointerClick, Image as ImageIcon, ShieldCheck, Braces, Workflow, Columns2 } from 'lucide-react';

const STEPS = [
  {
    n: '01',
    icon: Workflow,
    t: 'Paste the source URL',
    d: 'Enter any publicly reachable page in the Studio console. The engine resolves the host, follows redirects and falls back through several proxies when a site blocks datacenter traffic.',
  },
  {
    n: '02',
    icon: MousePointerClick,
    t: 'The CSS cascade is resolved',
    d: 'Up to 12 stylesheets are downloaded and parsed into an indexed rule set. Specificity, !important, inline styles and var() references are resolved per element, so widths, padding, alignment, colour and typography are real computed values — not guesses from the markup.',
  },
  {
    n: '03',
    icon: Columns2,
    t: 'Compare live, side by side',
    d: 'The Live compare tab embeds the source site (served through our proxy so X-Frame-Options never blocks it) next to a faithful HTML render of the exported Elementor JSON itself — not an approximation. Both panes run at the same viewport with synchronised scrolling and per-section jumping, so layout, alignment and colour mismatches are visible at a glance.',
  },
  {
    n: '04',
    icon: Braces,
    t: 'Review the generated tree',
    d: 'Inspect sections, columns and each mapped widget with its extracted content. Switch to Block preview for a schematic overview, or JSON to read the raw template file.',
  },
  {
    n: '05',
    icon: Upload,
    t: 'Import into WordPress',
    d: 'Download the .json file, then in WordPress go to Templates → Saved Templates → Import Templates and upload it. Insert the template on any page from the Elementor library.',
  },
  {
    n: '06',
    icon: ImageIcon,
    t: 'Localise the media',
    d: 'Images are referenced by their original absolute URLs so the layout renders immediately. Use any "import external images" plugin to pull them into the Media Library before going live.',
  },
];

const SCHEMA = `{
  "version": "0.4",
  "title": "Home - Polytech",
  "type": "page",
  "content": [
    {
      "id": "a1b2c3d",
      "elType": "section",
      "settings": {
        "structure": "20",
        "content_width": { "unit": "px", "size": 1140 },
        "padding": { "unit": "px", "top": "70", "bottom": "70" },
        "background_background": "classic",
        "background_color": "#004315",
        "_title": "02 · Hero Banner"
      },
      "elements": [
        {
          "id": "e4f5g6h",
          "elType": "column",
          "settings": { "_column_size": 50, "_inline_size": 50 },
          "elements": [
            {
              "id": "i7j8k9l",
              "elType": "widget",
              "widgetType": "heading",
              "settings": {
                "title": "Innovation in Every Profile",
                "header_size": "h1",
                "align": "left",
                "typography_typography": "custom",
                "typography_font_size": { "unit": "px", "size": 48 }
              }
            }
          ]
        }
      ]
    }
  ],
  "page_settings": { "template": "elementor_canvas", "hide_title": "yes" },
  "global_kit": { "system_colors": [ { "_id": "primary", "color": "#004315" } ] }
}`;

export default function Docs() {
  return (
    <div className="space-y-8">
      <SectionTitle
        kicker="documentation"
        title="How WebClonerELX works"
        sub="A five step pipeline that turns any live page into an Elementor template file — modelled on the ClonewebX workflow, rebuilt as a self-contained conversion engine."
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {STEPS.map(({ n, icon: Icon, t, d }) => (
          <div key={n} className="glass rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <span className="font-display text-3xl font-black text-edge2">{n}</span>
              <Icon size={18} className="text-volt" />
            </div>
            <h3 className="mt-3 font-display text-base font-bold">{t}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Braces size={16} className="text-volt" />
          <h3 className="font-display text-base font-bold">Output schema</h3>
          <Tag tone="cyan">version 0.4</Tag>
          <Tag>type: page</Tag>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          The exported file follows Elementor's native template export format. <code className="font-mono text-cyan">content</code> holds the
          element tree; every node carries <code className="font-mono text-cyan">elType</code>,{' '}
          <code className="font-mono text-cyan">settings</code> and nested <code className="font-mono text-cyan">elements</code>.
        </p>
        <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-edge bg-void/60 p-4 font-mono text-[11.5px] leading-relaxed text-muted">
          {SCHEMA}
        </pre>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="glass rounded-2xl p-5">
          <ShieldCheck size={18} className="text-volt" />
          <h3 className="mt-3 font-display text-base font-bold">What gets converted</h3>
          <ul className="mt-2 space-y-1.5 text-[13px] text-muted">
            {[
              'Native Elementor regions read directly — header, page and footer',
              'True column widths (16/25/33/50/100%) preserved per section',
              'Nested inner sections kept as nested sections, not flattened',
              'Alignment resolved from classes, text-align and flex justify',
              'Auto-width widgets keep shrink-to-fit instead of stretching',
              'Vertical content position (top / middle / bottom) transferred',
              'Headings H1–H6 with computed size, weight, family and colour',
              'Images including lazy data-src, srcset and rendered width',
              'Icon Box, Image Carousel and Nav Menu mapped to real widgets',
              'Responsive-hidden elements dropped, JS-revealed ones kept',
            ].map((x) => (
              <li key={x} className="flex gap-2">
                <span className="text-volt">▸</span>
                {x}
              </li>
            ))}
          </ul>
        </div>
        <div className="glass rounded-2xl p-5">
          <ShieldCheck size={18} className="text-magenta" />
          <h3 className="mt-3 font-display text-base font-bold">Known limits</h3>
          <ul className="mt-2 space-y-1.5 text-[13px] text-muted">
            {[
              'Content rendered only by client-side JavaScript is not captured — the engine reads server HTML.',
              'State pseudo-classes (:hover, :focus, :nth-child) are intentionally not applied.',
              'Media queries are evaluated at a 1440px desktop viewport; mobile overrides are not exported.',
              'Animations, transitions and hover styling are not transferred.',
              'Media stays hot-linked until imported into the WordPress Media Library.',
              'Only clone pages you own or are licensed to reproduce.',
            ].map((x) => (
              <li key={x} className="flex gap-2">
                <span className="text-magenta">▸</span>
                {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
