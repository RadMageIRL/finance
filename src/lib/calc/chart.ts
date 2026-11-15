// Stacked column chart as an SVG string. Pure, so the page renders it at build time and the
// calculator script re-renders it with the same code. Every string here comes from numbers
// and fixed labels, never from visitor text. Styling comes from CSS classes (theme tokens),
// so the chart follows Dark and Light without inline styles.
//
// Mark specs (dataviz guidance): columns at most 24px wide, 4px rounded data end and square
// at the baseline, a 2px surface gap between stacked segments, hairline solid gridlines,
// one direct label (the final total), legend kept in HTML next to the chart.

export interface StackSeries {
  key: string;
  label: string;
}

export interface StackedColumns {
  /** One label per column, for example the year. */
  categories: readonly string[];
  series: readonly StackSeries[];
  /** values[column][series], in cents, all nonnegative. */
  values: readonly (readonly number[])[];
  formatTick: (cents: number) => string;
  formatTotal: (cents: number) => string;
  /** Accessible name and description, also used by the table equivalent. */
  title: string;
  description: string;
  idPrefix: string;
  /** Drawing width in CSS pixels; the browser passes the real width so text keeps its size. */
  width?: number;
}

const W_DEFAULT = 640;
const W_MIN = 280;
const H = 300;
const M = { top: 28, right: 12, bottom: 30, left: 56 };
const GAP = 2;
const MAX_BAR = 24;

/** A tick step of 1, 2, 2.5 or 5 times a power of ten, giving about `count` intervals. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Rectangle with the top two corners rounded (the data end); square at the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${f(x)},${f(y + h)}V${f(y + rr)}Q${f(x)},${f(y)} ${f(x + rr)},${f(y)}H${f(x + w - rr)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + rr)}V${f(y + h)}Z`;
}

export function stackedColumnsSvg(spec: StackedColumns): string {
  const W = Math.max(W_MIN, Math.round(spec.width ?? W_DEFAULT));
  // Series names live in the HTML legend and the table; the SVG only draws their marks.
  const { categories, values } = spec;
  const totals = values.map((row) => row.reduce((s, v) => s + v, 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const yMax = ticks[ticks.length - 1] || 1;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const band = plotW / Math.max(categories.length, 1);
  const barW = Math.max(1, Math.min(MAX_BAR, band * 0.7));
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

  const parts: string[] = [];
  parts.push(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${spec.idPrefix}-title ${spec.idPrefix}-desc" preserveAspectRatio="xMidYMid meet">`);
  parts.push(`<title id="${spec.idPrefix}-title">${escapeXml(spec.title)}</title>`);
  parts.push(`<desc id="${spec.idPrefix}-desc">${escapeXml(spec.description)}</desc>`);

  // Gridlines and y-axis labels.
  for (const t of ticks) {
    const ty = f(y(t));
    parts.push(`<line class="chart__grid${t === 0 ? ' chart__grid--base' : ''}" x1="${M.left}" x2="${W - M.right}" y1="${ty}" y2="${ty}"/>`);
    parts.push(`<text class="chart__tick" x="${M.left - 8}" y="${ty}" dy="0.32em" text-anchor="end">${escapeXml(spec.formatTick(t))}</text>`);
  }

  // Columns: segments stacked bottom to top in series order, 2px surface gap between them.
  // As many year labels as fit at about 32px apart, at most 10.
  const maxLabels = Math.max(2, Math.min(10, Math.floor(plotW / 32)));
  const labelEvery = Math.max(1, Math.ceil(categories.length / maxLabels));
  categories.forEach((category, i) => {
    const x = M.left + band * i + (band - barW) / 2;
    const row = values[i] ?? [];
    const lastNonZero = row.reduce((last, v, s) => (v > 0 ? s : last), -1);
    parts.push(`<g class="chart__col" data-index="${i}">`);
    let base = 0;
    row.forEach((v, s) => {
      if (v <= 0) return;
      const yTop = y(base + v);
      const yBottom = y(base);
      const gapBelow = base > 0 ? GAP / 2 : 0;
      const gapAbove = s === lastNonZero ? 0 : GAP / 2;
      const h = Math.max(0, yBottom - yTop - gapBelow - gapAbove);
      if (h > 0) {
        const cls = `chart__seg chart__seg--${s + 1}`;
        if (s === lastNonZero) parts.push(`<path class="${cls}" d="${topRounded(x, yTop + gapAbove, barW, h, 4)}"/>`);
        else parts.push(`<rect class="${cls}" x="${f(x)}" y="${f(yTop + gapAbove)}" width="${f(barW)}" height="${f(h)}"/>`);
      }
      base += v;
    });
    // Hit target: the whole band, bigger than the marks.
    parts.push(`<rect class="chart__hit" x="${f(M.left + band * i)}" y="${M.top}" width="${f(band)}" height="${plotH}"/>`);
    parts.push('</g>');
    // Every labelEvery-th year, plus the last; a regular label too close to the last is skipped.
    const lastIndex = categories.length - 1;
    if (i === lastIndex || (i % labelEvery === 0 && lastIndex - i >= labelEvery)) {
      parts.push(`<text class="chart__tick" x="${f(x + barW / 2)}" y="${H - M.bottom + 18}" text-anchor="middle">${escapeXml(category)}</text>`);
    }
  });

  // One direct label: the final total, right-aligned to the last column's right edge.
  const last = totals.length - 1;
  if (last >= 0 && totals[last]! > 0) {
    const right = M.left + band * last + (band + barW) / 2;
    parts.push(`<text class="chart__label" x="${f(Math.min(right, W - M.right))}" y="${f(y(totals[last]!) - 8)}" text-anchor="end">${escapeXml(spec.formatTotal(totals[last]!))}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

export interface HorizontalBars {
  /** One label per bar, for example "Account A". */
  categories: readonly string[];
  /** One value per bar, in cents, all nonnegative. */
  values: readonly number[];
  formatValue: (cents: number) => string;
  title: string;
  description: string;
  idPrefix: string;
  width?: number;
}

const BAR_H = 24;
const BAR_GAP = 16;
const BAR_LABEL_W = 92;
const BAR_VALUE_W = 96;

/**
 * Horizontal bars for comparing a few items, each with its value written at the end of its
 * bar (direct labels, so no axis is needed). Same marks and classes as the column chart: a
 * 4px rounded data end, a square base, and a hit area per bar for the shared tooltip.
 */
export function horizontalBarsSvg(spec: HorizontalBars): string {
  const W = Math.max(W_MIN, Math.round(spec.width ?? W_DEFAULT));
  const top = 8;
  const H = top + spec.categories.length * (BAR_H + BAR_GAP);
  const x0 = BAR_LABEL_W;
  const plotW = Math.max(40, W - x0 - BAR_VALUE_W);
  const max = Math.max(...spec.values, 0) || 1;
  const parts: string[] = [];
  parts.push(`<svg class="chart chart--bars" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${spec.idPrefix}-title ${spec.idPrefix}-desc" preserveAspectRatio="xMidYMid meet">`);
  parts.push(`<title id="${spec.idPrefix}-title">${escapeXml(spec.title)}</title>`);
  parts.push(`<desc id="${spec.idPrefix}-desc">${escapeXml(spec.description)}</desc>`);
  parts.push(`<line class="chart__grid chart__grid--base" x1="${x0}" x2="${x0}" y1="${top - 4}" y2="${H - BAR_GAP + 4}"/>`);
  spec.categories.forEach((category, i) => {
    const y = top + i * (BAR_H + BAR_GAP);
    const value = spec.values[i] ?? 0;
    const w = (value / max) * plotW;
    parts.push(`<g class="chart__col" data-index="${i}">`);
    if (w > 0) {
      const r = Math.min(4, w, BAR_H / 2);
      // Square at the base (left), rounded at the data end (right).
      parts.push(`<path class="chart__seg chart__seg--1" d="M${f(x0)},${f(y)}H${f(x0 + w - r)}Q${f(x0 + w)},${f(y)} ${f(x0 + w)},${f(y + r)}V${f(y + BAR_H - r)}Q${f(x0 + w)},${f(y + BAR_H)} ${f(x0 + w - r)},${f(y + BAR_H)}H${f(x0)}Z"/>`);
    }
    parts.push(`<rect class="chart__hit" x="0" y="${f(y - BAR_GAP / 2)}" width="${W}" height="${BAR_H + BAR_GAP}"/>`);
    parts.push('</g>');
    parts.push(`<text class="chart__tick chart__tick--bar" x="${x0 - 10}" y="${f(y + BAR_H / 2)}" dy="0.32em" text-anchor="end">${escapeXml(category)}</text>`);
    parts.push(`<text class="chart__label" x="${f(x0 + w + 8)}" y="${f(y + BAR_H / 2)}" dy="0.32em">${escapeXml(spec.formatValue(value))}</text>`);
  });
  parts.push('</svg>');
  return parts.join('');
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
