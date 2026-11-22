// The line chart of the economic dashboards (design P28 8.1 and 8.2; brief Q, agent 4):
// hand-written SVG, no dependency, pure, so the build renders it and the browser reads the
// same encoded data with the same code (`decodeChartData`, `readoutAt`). Styling comes from
// CSS classes and theme tokens (src/styles/data.css); there are no inline styles and every
// string comes from the dataset's decimal strings, the period strings or fixed words.
//
// LAYOUT. The marks are drawn in a plot of 1000 by 240 units that the page stretches to the
// width of the content column (preserveAspectRatio "none", strokes that do not scale), so the
// chart fits any width without a script. Text is never inside the stretched drawing: the value
// axis labels are HTML beside it (evenly spaced, like the gridlines) and the period labels are
// SVG text at percent positions in a strip that is not stretched, so text keeps its size.
//
// RULES (the independent oracle tests/oracle/econ_shell.py is written from these):
//
// C1 Positions. A chart's periods are all days (YYYY-MM-DD; position: the count of days since
//    1970-01-01 in the Gregorian calendar) or all months (YYYY-MM; position: year * 12 +
//    month - 1). The period domain runs from the smallest to the largest position of any point
//    of any line or band; when they are equal it is widened by one on each side. A position p
//    is at (p - first) / (last - first) of the plot width.
// C2 Value axis. It spans every non-null value of every line and both ends of every band, and
//    always includes zero (so a line is never read against a cut-off baseline). Work in units
//    of the most decimal places any value has. The tick step is the first of 1, 2, 5, 10, 20,
//    25, 50, 100, 200, 250, 500, ... units (1, 2, 2.5 and 5 times a power of ten, never finer
//    than one unit) that covers the span in at most five steps. The axis ends are the
//    multiples of the step at or beyond the lowest and highest values. When every value is
//    zero (or there are none) the axis runs from 0 to 1 unit.
// C3 Tick labels are exact: the tick value with trailing zeros after the point removed and the
//    whole part grouped by commas. For the unit "U.S. dollars" the ticks are written in
//    trillions, billions or millions (the decimal point moved exactly 12, 9 or 6 places) when
//    the largest tick in absolute value is at least 10^12, 10^9 or 10^6, and the axis title
//    says so ("Trillions of U.S. dollars"); otherwise the axis title is the unit label.
// C4 Period labels. Calendar steps, in order: 1, 3 and 6 months, then 1, 2, 5, 10, 20, 25 and
//    50 years. A month step s labels the first of every month whose position (as in C1 for
//    months) is a multiple of s; a year step s labels January 1 of every year that is a
//    multiple of s. Only labels inside the period domain count. The chart uses the first step
//    with at most 8 labels on wide plots and at most 4 on narrow ones (the largest step when
//    none qualifies). Labels read "2026" for year steps and "Jan 2026" for month steps. When
//    no label falls inside the domain, the first and last points' periods are labeled instead
//    ("Nov 12, 2026" for days, "Nov 2026" for months).
// C5 Screen resolution. The plot is drawn in 500 columns (2 of its 1000 units each, so at most
//    one pair per pixel column on the widest plot). A point at fraction f of the plot is in
//    column floor(f * 500), the last column for f = 1. Each line of shape "line" is split into
//    runs at its null points (a gap is never bridged). Within a run, a column with at most two
//    points keeps them; a column with more keeps its lowest and its highest value (the earliest
//    point on a tie, exact decimal comparison). The first and last points of a run are always
//    kept, so a line starts and ends at its real first and latest values. So there are at most
//    two points per column (plus the run's ends) and every extreme stays visible. A run of one
//    point is drawn as a marker, joined to nothing.
// C6 Reading. The points a reader can step through with the keyboard: the plot is divided into
//    125 reading columns (floor(f * 125), the last for f = 1), and in each, every line of shape
//    "line" contributes its non-null points there when it has at most two, otherwise the point
//    with its lowest and the point with its highest value (the earliest on a tie); its first
//    and last non-null points are always included, so Home and End reach them. These are drawn
//    points (each reading column is four drawing columns), so every extreme can be read;
//    together, in period order without repeats, they are the reading points (for a chart with
//    only step lines and bands: their points). A short range thus keeps every point readable
//    when it has at most two per reading column. At each reading point a
//    "line" shows its value at exactly that period ("Not available" for a null value; nothing
//    when it has no point there); a "step" line and a band show the value in effect: that of
//    their last point at or before the period (nothing before their first point or where that
//    point is null). A derived series is named with " (derived)" after its label, unless the
//    label already contains the word "derived" (in any case).
// C7 Steps and bands. A step line or a band holds each value until its next point, and its
//    last value to the end of the period domain. A null point of a step line ends the step
//    there; the next non-null point starts a new one.
// C8 Description. For each line: its label and kind ("observed" or "derived"), its first and
//    last period with a value, its latest value, and its lowest and highest values with their
//    periods (the earliest on a tie, exact decimal comparison), all from every point given,
//    not only those drawn. For each band: its label, kind and the latest range with the period
//    it took effect.
// C9 Marks. Observed lines are solid, except that a second and third observed line are
//    dashed (8 3 2 3) and dotted (2 3) so they differ without color; derived lines and the
//    edges of a derived band are dashed (6 4). Colors follow the line's position in the chart
//    (series tokens 1 to 3, never cycled past 3: a fourth line reuses the third's color with
//    its own dash). Bands carry a hatch texture that shows in print and forced colors.
// C10 Annotations (an optional list of { x, label } that a page passes beside its spec). They are
//    numbered 1, 2, ... in period order (in the order given on a tie). One whose period is inside
//    the period domain is marked by a vertical line at its position (C1) with its number above
//    the plot; one outside it is listed as outside the range shown. The list under the chart and
//    the description give each number, its period in words and its label.
import { formatDay, formatMonth, groupDigits, shiftLeft } from './format';
import { compareDecimal, rangeText, valueText } from './shell-text';
import type { ChartBand, ChartLine, ChartSpec } from './ui';

/** Plot width and height in drawing units. */
export const PLOT_W = 1000;
export const PLOT_H = 240;
/** Drawing columns (C5) and reading columns (C6). */
export const DRAW_COLUMNS = 500;
export const READ_COLUMNS = 125;
export const WIDE_LABELS = 8;
export const NARROW_LABELS = 4;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DECIMAL = /^-?\d+(\.\d+)?$/;

// ---- C1: positions ----------------------------------------------------------------------

/** Days since 1970-01-01 for a YYYY-MM-DD date (proleptic Gregorian calendar). */
export function dayNumber(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`not a day: ${day}`);
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error(`not a day: ${day}`);
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const n = era * 146097 + doe - 719468;
  if (dayString(n) !== day) throw new Error(`not a day: ${day}`);
  return n;
}

/** The YYYY-MM-DD date of a day number. */
export function dayString(n: number): string {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (mo <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** year * 12 + month - 1 for a YYYY-MM month. */
export function monthNumber(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`not a month: ${month}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

/** The YYYY-MM month of a month number. */
export function monthString(n: number): string {
  return `${String(Math.floor(n / 12)).padStart(4, '0')}-${String((n % 12) + 1).padStart(2, '0')}`;
}

export type PeriodKind = 'day' | 'month';

export const position = (kind: PeriodKind, period: string): number => (kind === 'day' ? dayNumber(period) : monthNumber(period));
export const periodOf = (kind: PeriodKind, n: number): string => (kind === 'day' ? dayString(n) : monthString(n));

/** The period in words, as tooltips and descriptions show it. */
export const periodWords = (kind: PeriodKind, n: number): string => (kind === 'day' ? formatDay(dayString(n)) : formatMonth(monthString(n)));

// ---- exact decimals as scaled integers --------------------------------------------------

const places = (s: string): number => (s.includes('.') ? s.length - s.indexOf('.') - 1 : 0);

function toUnits(s: string, scale: number): bigint {
  if (!DECIMAL.test(s)) throw new Error(`not a decimal string: ${s}`);
  const neg = s.startsWith('-');
  const [i = '0', f = ''] = (neg ? s.slice(1) : s).split('.');
  const n = BigInt(i + f.padEnd(scale, '0'));
  return neg ? -n : n;
}

function fromUnits(n: bigint, scale: number): string {
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(scale + 1, '0');
  const int = scale ? digits.slice(0, -scale) : digits;
  const frac = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
  const out = frac ? `${int}.${frac}` : int;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a >= 0n ? (a + b - 1n) / b : -(-a / b));
const floorDiv = (a: bigint, b: bigint): bigint => (a >= 0n ? a / b : -((-a + b - 1n) / b));

// ---- C2, C3: the value axis -------------------------------------------------------------

export interface ValueAxis {
  /** Tick values as exact decimal strings, lowest first. */
  ticks: string[];
  /** Tick labels (C3), lowest first. */
  labels: string[];
  /** The axis title (C3). */
  title: string;
  /** Axis ends as numbers, for drawing only. */
  low: number;
  high: number;
}

/** C2 and C3: ticks for a set of decimal strings in one unit. */
export function valueAxis(values: readonly string[], unitLabel: string): ValueAxis {
  const scale = values.reduce((m, v) => Math.max(m, places(v)), 0);
  let lo = 0n;
  let hi = 0n;
  for (const v of values) {
    const u = toUnits(v, scale);
    if (u < lo) lo = u;
    if (u > hi) hi = u;
  }
  if (lo === hi) hi = lo + 1n;
  const span = hi - lo;
  let step = 1n;
  for (let p = 1n; ; p *= 10n) {
    const found = [1n * p, 2n * p, ...(p >= 10n ? [(25n * p) / 10n] : []), 5n * p].find((s) => span <= 5n * s);
    if (found) {
      step = found;
      break;
    }
  }
  const first = floorDiv(lo, step) * step;
  const last = ceilDiv(hi, step) * step;
  const ticks: string[] = [];
  for (let t = first; t <= last; t += step) ticks.push(fromUnits(t, scale));
  let title = unitLabel;
  let shift = 0;
  if (unitLabel === 'U.S. dollars') {
    const top = ticks.reduce((m, t) => (compareDecimal(t.replace(/^-/, ''), m) > 0 ? t.replace(/^-/, '') : m), '0');
    if (compareDecimal(top, '1000000000000') >= 0) [shift, title] = [12, 'Trillions of U.S. dollars'];
    else if (compareDecimal(top, '1000000000') >= 0) [shift, title] = [9, 'Billions of U.S. dollars'];
    else if (compareDecimal(top, '1000000') >= 0) [shift, title] = [6, 'Millions of U.S. dollars'];
  }
  const labels = ticks.map((t) => {
    const neg = t.startsWith('-');
    const abs = shiftLeft(neg ? t.slice(1) : t, shift);
    return `${neg ? '-' : ''}${groupDigits(abs)}`;
  });
  return { ticks, labels, title, low: Number(ticks[0]), high: Number(ticks[ticks.length - 1]) };
}

// ---- C4: period labels ------------------------------------------------------------------

export interface PeriodLabel {
  /** The position (C1). */
  at: number;
  text: string;
}

const STEPS: readonly { months: number }[] = [1, 3, 6, 12, 24, 60, 120, 240, 300, 600].map((months) => ({ months }));

/** C4: the period labels for a domain at most `most` labels long. */
export function periodLabels(kind: PeriodKind, first: number, last: number, most: number, ends: readonly [number, number] = [first, last]): PeriodLabel[] {
  const firstMonth = kind === 'day' ? monthNumber(dayString(first).slice(0, 7)) : first;
  const lastMonth = kind === 'day' ? monthNumber(dayString(last).slice(0, 7)) : last;
  const candidates = (months: number): PeriodLabel[] => {
    const out: PeriodLabel[] = [];
    for (let m = firstMonth; m <= lastMonth; m += 1) {
      if (months < 12 ? m % months !== 0 : m % 12 !== 0 || Math.floor(m / 12) % (months / 12) !== 0) continue;
      const at = kind === 'day' ? dayNumber(`${monthString(m)}-01`) : m;
      if (at < first || at > last) continue;
      const text = months < 12 ? `${MONTHS[m % 12]} ${Math.floor(m / 12)}` : String(Math.floor(m / 12));
      out.push({ at, text });
    }
    return out;
  };
  let chosen: PeriodLabel[] | null = null;
  let largest: PeriodLabel[] = [];
  for (const s of STEPS) {
    const c = candidates(s.months);
    largest = c;
    if (c.length <= most) {
      chosen = c;
      break;
    }
  }
  const labels = chosen ?? largest;
  if (labels.length > 0) return labels;
  const word = (n: number) => {
    if (kind === 'month') return `${MONTHS[n % 12]} ${Math.floor(n / 12)}`;
    const d = dayString(n);
    return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
  };
  return ends[0] === ends[1] ? [{ at: ends[0], text: word(ends[0]) }] : [{ at: ends[0], text: word(ends[0]) }, { at: ends[1], text: word(ends[1]) }];
}

// ---- C5, C6: screen resolution and reading ----------------------------------------------

interface Pt {
  at: number;
  y: string | null;
}

const sortPoints = (pts: Pt[]): Pt[] => [...pts].sort((a, b) => a.at - b.at);

/** C5 and C6: the column of a position among `columns` columns. */
export function columnOf(at: number, first: number, last: number, columns: number = DRAW_COLUMNS): number {
  return Math.min(columns - 1, Math.floor(((at - first) / (last - first)) * columns));
}

/** C6: the reading points a line contributes: its lowest and highest non-null value per reading column. */
export function readingPoints(points: readonly Pt[], first: number, last: number): number[] {
  return withEnds(points.filter((p) => p.y !== null), first, last, READ_COLUMNS).map((p) => p.at);
}

/** C5, C6: the kept points of a run of non-null points, with its first and last point. */
function withEnds(points: readonly Pt[], first: number, last: number, columns: number): Pt[] {
  const kept = extremes(points, first, last, columns);
  const ends = [points[0], points[points.length - 1]].filter((p): p is Pt => p !== undefined && !kept.includes(p));
  return ends.length ? [...kept, ...new Set(ends)].sort((a, b) => a.at - b.at) : kept;
}

/**
 * The points a column keeps (C5, C6): all of them when it has at most two, otherwise its lowest
 * and its highest value (the earliest on a tie), in period order. Points must be non-null.
 */
function extremes(points: readonly Pt[], first: number, last: number, columns: number): Pt[] {
  const byColumn = new Map<number, { all: Pt[]; min: Pt; max: Pt }>();
  for (const p of points) {
    const c = columnOf(p.at, first, last, columns);
    const cur = byColumn.get(c);
    if (!cur) byColumn.set(c, { all: [p], min: p, max: p });
    else {
      cur.all.push(p);
      if (compareDecimal(p.y as string, cur.min.y as string) < 0) cur.min = p;
      if (compareDecimal(p.y as string, cur.max.y as string) > 0) cur.max = p;
    }
  }
  const kept: Pt[] = [];
  for (const { all, min, max } of byColumn.values()) {
    if (all.length <= 2) kept.push(...all);
    else {
      kept.push(min);
      if (max !== min) kept.push(max);
    }
  }
  return kept.sort((a, b) => a.at - b.at);
}

/** C5: the runs of a line (split at nulls) with the points each keeps, in period order. */
export function keptRuns(points: readonly Pt[], first: number, last: number): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  const flush = () => {
    if (run.length) runs.push(run);
    run = [];
  };
  for (const p of points) {
    if (p.y === null) flush();
    else run.push(p);
  }
  flush();
  return runs.map((r) => withEnds(r, first, last, DRAW_COLUMNS));
}

/** The value in effect at `at` for a step line or band: its last point at or before it. */
function inEffect<T extends { at: number }>(pts: readonly T[], at: number): T | null {
  let found: T | null = null;
  for (const p of pts) {
    if (p.at <= at) found = p;
    else break;
  }
  return found;
}

// ---- the encoded reading data (shared with the browser) ---------------------------------

/** What the browser reads: the reading positions, then each line and band in legend order. */
export interface ChartData {
  kind: PeriodKind;
  first: number;
  last: number;
  unitLabel: string;
  /** Reading positions (C6), ascending. */
  nav: number[];
  series: (
    | { type: 'line'; kind: 'observed' | 'derived'; label: string; values: (string | null | undefined)[] }
    | { type: 'step'; kind: 'observed' | 'derived'; label: string; points: Pt[] }
    | { type: 'band'; kind: 'observed' | 'derived'; label: string; points: { at: number; lower: string; upper: string }[] }
  )[];
}

// The encoding uses only characters that need no escaping in an HTML attribute: sections are
// separated by ";", items by ",", fields by ":", a null value is "~" and an absent one empty.
// Labels and the unit come from the HTML (the legend and a data attribute), not from here.

/** Encodes the reading data of a chart for its `data-chart` attribute. */
export function encodeChartData(d: ChartData): string {
  const nav: string[] = [];
  let prev = d.first;
  for (const n of d.nav) {
    nav.push(String(n - prev));
    prev = n;
  }
  const parts = [`${d.kind},${d.first},${d.last}`, nav.join(',')];
  for (const s of d.series) {
    const k = s.kind === 'derived' ? 'd' : 'o';
    if (s.type === 'line') parts.push(`L${k}${s.values.map((v) => (v === undefined ? '' : v === null ? '~' : v)).join(',')}`);
    else if (s.type === 'step') parts.push(`S${k}${s.points.map((p) => `${p.at - d.first}:${p.y ?? '~'}`).join(',')}`);
    else parts.push(`B${k}${s.points.map((p) => `${p.at - d.first}:${p.lower}:${p.upper}`).join(',')}`);
  }
  return parts.join(';');
}

/** Decodes a `data-chart` attribute; labels and the unit are given by the page. */
export function decodeChartData(text: string, labels: readonly string[], unitLabel: string): ChartData {
  const [head = '', navText = '', ...rest] = text.split(';');
  const [kindText, firstText, lastText] = head.split(',');
  const kind: PeriodKind = kindText === 'month' ? 'month' : 'day';
  const first = Number(firstText);
  const last = Number(lastText);
  const nav: number[] = [];
  let at = first;
  for (const part of navText ? navText.split(',') : []) {
    at += Number(part);
    nav.push(at);
  }
  const series: ChartData['series'] = rest.map((s, i) => {
    const type = s.charAt(0);
    const k = s.charAt(1) === 'd' ? ('derived' as const) : ('observed' as const);
    const body = s.slice(2);
    const label = labels[i] ?? '';
    const items = body ? body.split(',') : [];
    if (type === 'L') return { type: 'line' as const, kind: k, label, values: items.map((v) => (v === '' ? undefined : v === '~' ? null : v)) };
    if (type === 'S')
      return {
        type: 'step' as const,
        kind: k,
        label,
        points: items.map((it) => {
          const [dx = '0', y = '~'] = it.split(':');
          return { at: first + Number(dx), y: y === '~' ? null : y };
        }),
      };
    return {
      type: 'band' as const,
      kind: k,
      label,
      points: items.map((it) => {
        const [dx = '0', lower = '0', upper = '0'] = it.split(':');
        return { at: first + Number(dx), lower, upper };
      }),
    };
  });
  return { kind, first, last, unitLabel, nav, series };
}

/** C6: the readout at reading position `index`: the period in words, then one line per series. */
export function readoutAt(d: ChartData, index: number): { period: string; rows: { label: string; value: string }[] } {
  const at = d.nav[index];
  if (at === undefined) return { period: '', rows: [] };
  const rows: { label: string; value: string }[] = [];
  for (const s of d.series) {
    const label = s.kind === 'derived' && !/derived/i.test(s.label) ? `${s.label} (derived)` : s.label;
    if (s.type === 'line') {
      const v = s.values[index];
      if (v === undefined) continue;
      rows.push({ label, value: v === null ? 'Not available' : valueText(v, d.unitLabel) });
    } else if (s.type === 'step') {
      const p = inEffect(s.points, at);
      if (p && p.y !== null) rows.push({ label, value: valueText(p.y, d.unitLabel) });
    } else {
      const p = inEffect(s.points, at);
      if (p) rows.push({ label, value: rangeText(p.lower, p.upper, d.unitLabel) });
    }
  }
  return { period: periodWords(d.kind, at), rows };
}

// ---- C8: the description ----------------------------------------------------------------

function describeLine(kind: PeriodKind, line: ChartLine, unitLabel: string): string {
  const pts = line.points.filter((p): p is { x: string; y: string } => p.y !== null);
  const head = `${line.label} (${line.kind})`;
  if (pts.length === 0) return `${head}: no values in this range.`;
  const sorted = [...pts].sort((a, b) => position(kind, a.x) - position(kind, b.x));
  let min = sorted[0]!;
  let max = sorted[0]!;
  for (const p of sorted) {
    if (compareDecimal(p.y, min.y) < 0) min = p;
    if (compareDecimal(p.y, max.y) > 0) max = p;
  }
  const latest = sorted[sorted.length - 1]!;
  const w = (x: string) => periodWords(kind, position(kind, x));
  return `${head}: ${w(sorted[0]!.x)} to ${w(latest.x)}. Latest ${valueText(latest.y, unitLabel)} (${w(latest.x)}). Lowest ${valueText(min.y, unitLabel)} (${w(min.x)}); highest ${valueText(max.y, unitLabel)} (${w(max.x)}).`;
}

function describeBand(kind: PeriodKind, band: ChartBand, unitLabel: string): string {
  const head = `${band.label} (${band.kind})`;
  if (band.points.length === 0) return `${head}: no values in this range.`;
  const latest = [...band.points].sort((a, b) => position(kind, a.x) - position(kind, b.x))[band.points.length - 1]!;
  return `${head}: latest ${rangeText(latest.lower, latest.upper, unitLabel)}, in effect from ${periodWords(kind, position(kind, latest.x))}.`;
}

/** C8: the chart's description, one sentence group per line and band. */
export function describeChart(spec: ChartSpec): string {
  return [...spec.lines.map((l) => describeLine(spec.periodKind, l, spec.unitLabel)), ...(spec.bands ?? []).map((b) => describeBand(spec.periodKind, b, spec.unitLabel))].join(' ');
}

// ---- rendering --------------------------------------------------------------------------

export interface ChartAnnotation {
  x: string;
  label: string;
}

export interface PlacedAnnotation {
  n: number;
  at: number;
  period: string;
  label: string;
  inRange: boolean;
}

/** C10: the annotations of a chart, numbered and placed. */
export function placeAnnotations(kind: PeriodKind, first: number, last: number, annotations: readonly ChartAnnotation[]): PlacedAnnotation[] {
  return annotations
    .map((a, i) => ({ a, i, at: position(kind, a.x) }))
    .sort((p, q) => p.at - q.at || p.i - q.i)
    .map(({ a, at }, k) => ({ n: k + 1, at, period: periodWords(kind, at), label: a.label, inRange: at >= first && at <= last }));
}

export interface RenderedChart {
  /** False when no line or band has a value: the page shows a sentence instead of a plot. */
  hasData: boolean;
  /** The stretched plot: gridlines, bands, lines, markers, cursor and focus marks. */
  plotSvg: string;
  /** The period labels strip for wide plots and for narrow ones. */
  wideAxisSvg: string;
  narrowAxisSvg: string;
  /** The value axis (C2, C3), labels top first for the HTML column. */
  axis: ValueAxis;
  description: string;
  /** The encoded reading data (C6). */
  data: string;
  /** C10: the annotations, numbered, and the strip of their numbers above the plot (empty without any). */
  annotations: PlacedAnnotation[];
  annotationSvg: string;
  /** Points given, points drawn and reading positions, for tests and the page's notes. */
  given: number;
  drawn: number;
  readable: number;
}

/** Coordinates in drawing units, to one decimal, without trailing zeros. */
const f = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
};

/** The dash class of a line (C9): its position among observed lines, or derived. */
function lineClasses(index: number, line: { kind: 'observed' | 'derived' }, observedIndex: number): string {
  const color = Math.min(index + 1, 3);
  const dash = line.kind === 'derived' ? 'is-derived' : `is-observed is-observed-${Math.min(observedIndex + 1, 3)}`;
  return `dchart__line dchart__line--${color} ${dash}`;
}

const NSS = ' vector-effect="non-scaling-stroke"';

/** Tenths of a unit as the shortest decimal ("12" for 1.2, "-5" for -0.5 as "-.5"). */
const tenths = (n: number): string => {
  const neg = n < 0;
  const a = Math.abs(n);
  const whole = Math.floor(a / 10);
  const frac = a % 10;
  const text = frac ? `${whole ? whole : ''}.${frac}` : String(whole);
  return neg ? `-${text}` : text;
};

/**
 * A polyline as compact path data: the first point absolute, the rest relative, each from
 * positions rounded to a tenth of a unit, so rounding never accumulates along the line.
 */
export function relativePath(points: readonly (readonly [number, number])[]): string {
  let px = 0;
  let py = 0;
  return points
    .map(([x0, y0], i) => {
      const X = Math.round(x0 * 10);
      const Y = Math.round(y0 * 10);
      const out = i === 0 ? `M${tenths(X)},${tenths(Y)}` : `l${tenths(X - px)},${tenths(Y - py)}`;
      px = X;
      py = Y;
      return out;
    })
    .join('');
}

/** Renders a chart spec (build time), with optional annotations (C10). Throws on a malformed period or value. */
export function renderChart(spec: ChartSpec, options: { annotations?: readonly ChartAnnotation[] } = {}): RenderedChart {
  const kind = spec.periodKind;
  const lines = spec.lines.map((l) => ({ line: l, pts: sortPoints(l.points.map((p) => ({ at: position(kind, p.x), y: p.y }))) }));
  const bands = (spec.bands ?? []).map((b) => ({ band: b, pts: [...b.points.map((p) => ({ at: position(kind, p.x), lower: p.lower, upper: p.upper }))].sort((a, c) => a.at - c.at) }));
  const allAt = [...lines.flatMap((l) => l.pts.map((p) => p.at)), ...bands.flatMap((b) => b.pts.map((p) => p.at))];
  const values = [...lines.flatMap((l) => l.pts.flatMap((p) => (p.y === null ? [] : [p.y]))), ...bands.flatMap((b) => b.pts.flatMap((p) => [p.lower, p.upper]))];
  const given = lines.reduce((n, l) => n + l.pts.length, 0) + bands.reduce((n, b) => n + b.pts.length, 0);
  let first = allAt.length ? Math.min(...allAt) : 0;
  let last = allAt.length ? Math.max(...allAt) : 1;
  if (first === last) {
    first -= 1;
    last += 1;
  }
  const axis = valueAxis(values, spec.unitLabel);
  const x = (at: number) => ((at - first) / (last - first)) * PLOT_W;
  const y = (v: string) => PLOT_H - ((Number(v) - axis.low) / (axis.high - axis.low)) * PLOT_H;
  const id = spec.id;

  const parts: string[] = [];
  parts.push(`<svg class="dchart__svg" viewBox="0 0 ${PLOT_W} ${PLOT_H}" preserveAspectRatio="none" role="img" aria-labelledby="${id}-svg-title ${id}-svg-desc" focusable="false">`);
  const marked = placeAnnotations(kind, first, last, options.annotations ?? []);
  const description = [describeChart(spec), ...marked.map((a) => `Note ${a.n}, ${a.period}${a.inRange ? '' : ' (outside the range shown)'}: ${a.label}`)].join(' ');
  parts.push(`<title id="${id}-svg-title">${esc(spec.title)}</title><desc id="${id}-svg-desc">${esc(description)}</desc>`);
  parts.push(`<defs><pattern id="${id}-tex" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><line class="dchart__tex-line" x1="0" y1="0" x2="0" y2="8"/></pattern></defs>`);
  // Gridlines at each tick, evenly spaced from the bottom (C2 steps are equal).
  const n = axis.ticks.length - 1;
  axis.ticks.forEach((t, i) => {
    const ty = f(PLOT_H - (i / n) * PLOT_H);
    parts.push(`<line class="dchart__grid${t === '0' ? ' dchart__grid--zero' : ''}" x1="0" x2="${PLOT_W}" y1="${ty}" y2="${ty}"${NSS}/>`);
  });

  let drawn = 0;
  // Bands first, under the lines (C7).
  bands.forEach(({ band, pts }, bi) => {
    if (!pts.length) return;
    const color = Math.min(lines.length + bi + 1, 3);
    // Each value holds from its point to the next point (the last to the end of the domain).
    const upper: string[] = [];
    const lower: string[] = [];
    pts.forEach((p, i) => {
      const x0 = f(x(p.at));
      const x1 = f(x(pts[i + 1]?.at ?? last));
      upper.push(`${x0},${f(y(p.upper))}`, `${x1},${f(y(p.upper))}`);
      lower.push(`${x0},${f(y(p.lower))}`, `${x1},${f(y(p.lower))}`);
    });
    const top = `M${upper.join('L')}`;
    const lowerPath = `M${lower.join('L')}`;
    const area = `${top}L${[...lower].reverse().join('L')}Z`;
    const dash = band.kind === 'derived' ? 'is-derived' : 'is-observed';
    parts.push(`<path class="dchart__band dchart__band--${color}" d="${area}"/>`);
    parts.push(`<path class="dchart__tex" fill="url(#${id}-tex)" d="${area}"/>`);
    parts.push(`<path class="dchart__edge dchart__edge--${color} ${dash}" d="${top}"${NSS}/>`);
    parts.push(`<path class="dchart__edge dchart__edge--${color} ${dash}" d="${lowerPath}"${NSS}/>`);
    drawn += pts.length;
  });

  // Lines: "line" shapes reduced to screen resolution (C5), steps as given (C7).
  const reading: number[] = [];
  let observedIndex = 0;
  lines.forEach(({ line, pts }, li) => {
    const cls = lineClasses(li, line, line.kind === 'observed' ? observedIndex : 0);
    if (line.kind === 'observed') observedIndex += 1;
    if (line.shape === 'step') {
      const d: string[] = [];
      let open = false;
      pts.forEach((p, i) => {
        if (p.y === null) {
          open = false;
          return;
        }
        const x1 = x(pts[i + 1]?.at ?? last);
        d.push(open ? `V${f(y(p.y))}H${f(x1)}` : `M${f(x(p.at))},${f(y(p.y))}H${f(x1)}`);
        open = true;
        drawn += 1;
      });
      if (d.length) parts.push(`<path class="${cls}" d="${d.join('')}"${NSS}/>`);
      return;
    }
    const runs = keptRuns(pts, first, last);
    const d: string[] = [];
    const dots: string[] = [];
    for (const r of runs) {
      drawn += r.length;
      if (r.length === 1) dots.push(`M${f(x(r[0]!.at))},${f(y(r[0]!.y as string))}h0`);
      else d.push(relativePath(r.map((p) => [x(p.at), y(p.y as string)])));
    }
    if (d.length) parts.push(`<path class="${cls}" d="${d.join('')}"${NSS}/>`);
    if (dots.length) {
      parts.push(`<path class="dchart__dot-ring" d="${dots.join('')}"${NSS}/>`);
      parts.push(`<path class="dchart__dot dchart__dot--${Math.min(li + 1, 3)}" d="${dots.join('')}"${NSS}/>`);
    }
    reading.push(...readingPoints(pts, first, last));
  });

  // C6: reading positions and each series' values there.
  const lineNav = [...new Set(reading)].sort((a, b) => a - b);
  const nav = lineNav.length ? lineNav : [...new Set([...lines.flatMap((l) => l.pts.map((p) => p.at)), ...bands.flatMap((b) => b.pts.map((p) => p.at))])].sort((a, b) => a - b);
  const data: ChartData = {
    kind,
    first,
    last,
    unitLabel: spec.unitLabel,
    nav,
    series: [
      ...lines.map(({ line, pts }) => {
        if (line.shape === 'step') return { type: 'step' as const, kind: line.kind, label: line.label, points: pts };
        const at = new Map(pts.map((p) => [p.at, p.y]));
        return { type: 'line' as const, kind: line.kind, label: line.label, values: nav.map((n2) => (at.has(n2) ? (at.get(n2) as string | null) : undefined)) };
      }),
      ...bands.map(({ band, pts }) => ({ type: 'band' as const, kind: band.kind, label: band.label, points: pts })),
    ],
  };

  const placed = marked;
  for (const a of placed) if (a.inRange) parts.push(`<line class="dchart__mark" x1="${f(x(a.at))}" x2="${f(x(a.at))}" y1="0" y2="${PLOT_H}" data-mark="${a.n}"${NSS}/>`);
  parts.push(`<line class="dchart__cursor" x1="0" x2="0" y1="0" y2="${PLOT_H}" visibility="hidden"${NSS}/>`);
  lines.forEach((_l, li) => parts.push(`<path class="dchart__focus dchart__focus--${Math.min(li + 1, 3)}" d="M0,0h0" visibility="hidden" data-focus="${li}"${NSS}/>`));
  parts.push('</svg>');

  const axisSvg = (most: number, cls: string) => {
    const labels = periodLabels(kind, first, last, most, allAt.length ? [Math.min(...allAt), Math.max(...allAt)] : [first, last]);
    const texts = labels.map((l) => `<text x="${f((x(l.at) / PLOT_W) * 100)}%" y="15" text-anchor="middle">${esc(l.text)}</text>`).join('');
    return `<svg class="dchart__xaxis ${cls}" width="100%" height="22" aria-hidden="true" focusable="false">${texts}</svg>`;
  };

  return {
    hasData: values.length > 0,
    annotations: placed,
    annotationSvg: placed.some((a) => a.inRange)
      ? `<svg class="dchart__marks" width="100%" height="16" aria-hidden="true" focusable="false">${placed
          .filter((a) => a.inRange)
          .map((a) => `<text x="${f((x(a.at) / PLOT_W) * 100)}%" y="12" text-anchor="middle">${a.n}</text>`)
          .join('')}</svg>`
      : '',
    plotSvg: parts.join(''),
    wideAxisSvg: axisSvg(WIDE_LABELS, 'dchart__xaxis--wide'),
    narrowAxisSvg: axisSvg(NARROW_LABELS, 'dchart__xaxis--narrow'),
    axis,
    description,
    data: encodeChartData(data),
    given,
    drawn,
    readable: nav.length,
  };
}

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
