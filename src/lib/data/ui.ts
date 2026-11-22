// The props contract of the shared dashboard components (brief Q, docs/P36_V020_PARALLEL_DASHBOARDS.md).
// Agent 4 implements the components in src/components/data/ and src/layouts/DataLayout.astro
// against these types; the topic pages (agents 1 to 3) pass them. The integrator owns this file;
// a change is requested, not made.
//
// Numbers stay decimal strings everywhere: a chart parses them for drawing positions only, and
// every displayed number comes from a string (design P28 8.2).

/** The four dashboard pages, by their path segment under /finance/data/. */
export type DashboardId = 'overview' | 'federal-funds-rate' | 'money-stock' | 'public-debt';

/** One point of a line: a reference period (YYYY-MM-DD or YYYY-MM) and a decimal string, null for a gap. */
export interface ChartPoint {
  x: string;
  y: string | null;
}

/** One line of a chart: one unit and one frequency per chart, no dual axes (design 8.1). */
export interface ChartLine {
  key: string;
  label: string;
  /** 'line' for observed values; 'step' for change points such as a single-rate target. */
  shape: 'line' | 'step';
  /** 'observed' for provider values; 'derived' for values derived by RadMage Finance (drawn and labeled differently). */
  kind: 'observed' | 'derived';
  points: ChartPoint[];
}

/** A band between two step lines, for the target range from 2008-12-16 (decision D9). */
export interface ChartBand {
  key: string;
  label: string;
  kind: 'observed' | 'derived';
  points: { x: string; lower: string; upper: string }[];
}

/** Everything a chart needs; DataChart renders it as static SVG at build time with an HTML legend. */
export interface ChartSpec {
  /** Unique on the page; used for ids. */
  id: string;
  title: string;
  /** The unit, for example "Percent" or "U.S. dollars"; shown on the value axis. */
  unitLabel: string;
  /** 'day' or 'month', for the reference-period axis. */
  periodKind: 'day' | 'month';
  lines: ChartLine[];
  bands?: ChartBand[];
  /** Extra lines under the chart, for example "The latest two months are subject to revision." */
  notes?: string[];
  /** The id of the table that holds the same values (the accessible alternative). */
  tableId?: string;
}

/** A table column; numeric columns are right-aligned in tabular numerals with the unit in the header. */
export interface TableColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface TableSpec {
  id: string;
  caption: string;
  columns: TableColumn[];
  /** Display strings, already formatted; an empty string shows as the text "Not available". */
  rows: Record<string, string>[];
}

/** A headline figure: the current value with its period and dates (design 8.6). */
export interface Headline {
  label: string;
  /** The formatted value, for example "3.88 percent". */
  value: string;
  /** For example "Business day of November 17, 2026". */
  period: string;
  /** 'observed' or 'derived' (a derived value is labeled "Derived by RadMage Finance"). */
  kind: 'observed' | 'derived';
  /** Optional smaller lines: released, retrieved, a revision note. */
  details?: string[];
}

/** A computed figure: always labeled "Computed by RadMage Finance" with its formula. */
export interface ComputedFigure {
  label: string;
  value: string;
  formula: string;
  /** Why the figure is not shown when it is not valid, for example "No observation a year earlier". */
  unavailableReason?: string | null;
}

/** The status of a page's data, for the shared state component (design 7.1, 7.5). */
export type DataState = 'current' | 'stale' | 'unavailable' | 'fixture';
