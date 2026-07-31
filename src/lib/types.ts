export type WidgetPreview = {
  kind: string;
  text?: string;
  desc?: string;
  url?: string;
  items?: (string | { text: string; url?: string; children?: string[] })[];
  images?: string[];
  cards?: { title: string; image: string }[];
  fields?: string[];
  submit?: string;
  inline?: boolean;
  nav?: boolean;
  level?: number;
  count?: number;
  color?: string;
  bg?: string;
  fg?: string;
  radius?: number | null;
  size?: number | null;
  weight?: string | number | null;
  family?: string | null;
  iconColor?: string;
  iconUrl?: string;
  natWidth?: number | null;
  align?: string;
  height?: number;
  widget?: string;
  width?: { mode: string; value?: number };
  captions?: string[];
  slideHeight?: number | null;
  opacity?: number | null;
};

export type PreviewBlock =
  | { kind: 'widget'; type: string; label: string; preview: WidgetPreview }
  | {
      kind: 'row';
      gap: number;
      alignItems: string;
      background: { color: string; image: string };
      columns: PreviewColumn[];
    };

export type PreviewColumn = {
  width: number;
  align: string;
  valign: string;
  background: { color: string; image: string };
  blocks: PreviewBlock[];
};

export type SectionWidget = {
  column: number;
  type: string;
  label: string;
  preview: WidgetPreview;
};

export type CloneSection = {
  index: number;
  type: string;
  name: string;
  columnCount: number;
  columns: PreviewColumn[];
  background: { color: string; image: string };
  padding: { unit: string; top: string; right: string; bottom: string; left: string; isLinked: boolean };
  contentWidth: number;
  gap: number;
  alignItems: string;
  /** detected layout engine: grid | flex-row | flex-column | positioned | float | block */
  layout?: string;
  widgetCount: number;
  widgets: SectionWidget[];
};

export type PipelineError = {
  stage: string;
  node: string;
  reason: string;
};

export type FidelityReport = {
  textCoverage: number;
  animationsKept: number;
  imagesKept: number;
  sectionsBuilt: number;
  widgetsBuilt: number;
  errorsRecovered: number;
  pipeline: string;
  score: number;
};

export type CloneResult = {
  ok: boolean;
  jobId?: number;
  createdAt?: string;
  meta: {
    url: string;
    finalUrl: string;
    host: string;
    title: string;
    description: string;
    ogImage: string;
    favicon: string;
    lang: string;
    platform: string;
    fetchedVia: string;
    cssSheets: number;
    cssRules: number;
  };
  design: {
    colors: { hex: string; count: number }[];
    fonts: string[];
    primary: string;
    secondary: string;
    kitColors?: { name: string; hex: string; custom?: boolean }[];
  };
  options: { mode: string; pro: boolean; maxSections: number };
  stats: {
    sections: number;
    widgets: number;
    images: number;
    backgrounds: number;
    byType: Record<string, number>;
    htmlKb: number;
    jsonKb: number;
    cssKb: number;
    cssRules: number;
    extraction: string;
    durationMs: number;
    errors?: number;
    fidelityScore?: number;
  };
  sections: CloneSection[];
  assets: { type: string; url: string; alt: string }[];
  elementor: Record<string, unknown>;
  /** timestamped pipeline log lines, e.g. "[+1.2s] Opening website…" */
  log?: string[];
  errors?: PipelineError[];
  fidelity?: FidelityReport;
};

export type JobRow = {
  id: number;
  url: string;
  host: string;
  page_title: string;
  favicon: string | null;
  platform: string;
  mode: string;
  status: string;
  sections_count: number;
  widgets_count: number;
  images_count: number;
  duration_ms: number | null;
  html_kb: number | null;
  json_kb: number | null;
  error: string | null;
  created_at: string;
};

export type WidgetMapRow = {
  id: number;
  source_element: string;
  elementor_widget: string;
  category: string;
  notes: string;
  requires_pro: boolean;
};

export type SampleRow = {
  id: number;
  label: string;
  url: string;
  note: string;
};
