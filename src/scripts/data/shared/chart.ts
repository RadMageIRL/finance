// Reading a dashboard chart (design P28 8.2, 9): the chart takes focus; Left and Right move one
// reading point (C6 of src/lib/data/line-chart.ts), Page Up and Page Down about a month on a
// daily chart and a year on a monthly one, Home and End to the ends, Escape clears. The pointer
// reads the nearest point. A cursor and a mark on each line show the point, and a polite live
// region lists every series there (values from the page's own decimal strings, worded by the
// same code as the build). Focus never moves on its own and nothing traps it.
import { PLOT_H, PLOT_W, decodeChartData, readoutAt } from '../../../lib/data/line-chart';
import type { ChartData } from '../../../lib/data/line-chart';

const nearest = (nav: readonly number[], at: number): number => {
  let lo = 0;
  let hi = nav.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((nav[mid] ?? 0) < at) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((nav[lo - 1] ?? 0) - at) <= Math.abs((nav[lo] ?? 0) - at)) return lo - 1;
  return lo;
};

/** The value of series `s` drawn at reading point `index`, as a number for the focus mark. */
function drawnValue(d: ChartData, s: number, index: number): number | null {
  const series = d.series[s];
  const at = d.nav[index];
  if (!series || at === undefined) return null;
  if (series.type === 'line') {
    const v = series.values[index];
    return typeof v === 'string' ? Number(v) : null;
  }
  if (series.type === 'step') {
    let found: string | null = null;
    for (const p of series.points) {
      if (p.at <= at) found = p.y;
      else break;
    }
    return found === null ? null : Number(found);
  }
  return null;
}

export function wireChart(figure: HTMLElement): void {
  const box = figure.querySelector<HTMLElement>('[data-chart-box]');
  const svg = box?.querySelector<SVGSVGElement>('.dchart__svg');
  const readout = box?.querySelector<HTMLElement>('[data-readout]');
  if (!box || !svg || !readout || !figure.dataset.chart) return;
  const labels = [...figure.querySelectorAll<HTMLElement>('[data-key-label]')].map((li) => li.dataset.keyLabel ?? '');
  const data = decodeChartData(figure.dataset.chart, labels, figure.dataset.unit ?? '');
  if (!data.nav.length) return;
  const low = Number(figure.dataset.low);
  const high = Number(figure.dataset.high);
  const cursor = svg.querySelector('.dchart__cursor');
  const marks = [...svg.querySelectorAll<SVGPathElement>('[data-focus]')];
  const x = (at: number) => ((at - data.first) / (data.last - data.first)) * PLOT_W;
  const y = (v: number) => PLOT_H - ((v - low) / (high - low)) * PLOT_H;
  let active = -1;
  box.tabIndex = 0;

  const show = (index: number) => {
    const at = data.nav[index];
    if (at === undefined) return;
    active = index;
    const xu = String(Math.round(x(at) * 10) / 10);
    cursor?.setAttribute('x1', xu);
    cursor?.setAttribute('x2', xu);
    cursor?.setAttribute('visibility', 'visible');
    marks.forEach((mark) => {
      const v = drawnValue(data, Number(mark.dataset.focus), index);
      if (v === null || !Number.isFinite(v)) mark.setAttribute('visibility', 'hidden');
      else {
        mark.setAttribute('d', `M${xu},${Math.round(y(v) * 10) / 10}h0`);
        mark.setAttribute('visibility', 'visible');
      }
    });
    const { period, rows } = readoutAt(data, index);
    const head = document.createElement('strong');
    head.textContent = period;
    const list = rows.map((r) => {
      const line = document.createElement('span');
      const value = document.createElement('b');
      value.textContent = r.value;
      line.append(value, ` ${r.label}`);
      return line;
    });
    readout.replaceChildren(head, ...list);
    readout.dataset.index = String(index);
  };
  const hide = () => {
    active = -1;
    cursor?.setAttribute('visibility', 'hidden');
    marks.forEach((m) => m.setAttribute('visibility', 'hidden'));
  };

  // Page Up and Page Down: the first reading point at least a month (day charts: 30 days) or a
  // year (month charts: 12 months) away, or the end.
  const jump = data.kind === 'day' ? 30 : 12;
  const pageFrom = (from: number, dir: 1 | -1): number => {
    const start = data.nav[from] ?? data.nav[0] ?? 0;
    let i = from;
    while (i + dir >= 0 && i + dir < data.nav.length && Math.abs((data.nav[i] ?? 0) - start) < jump) i += dir;
    return i;
  };

  box.addEventListener('keydown', (event) => {
    const last = data.nav.length - 1;
    const from = active < 0 ? 0 : active;
    let to: number | null = null;
    if (event.key === 'ArrowRight') to = active < 0 ? 0 : Math.min(last, active + 1);
    else if (event.key === 'ArrowLeft') to = active < 0 ? 0 : Math.max(0, active - 1);
    else if (event.key === 'PageDown') to = pageFrom(from, 1);
    else if (event.key === 'PageUp') to = pageFrom(from, -1);
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = last;
    else if (event.key === 'Escape') {
      hide();
      return;
    }
    if (to === null) return;
    event.preventDefault();
    show(to);
  });
  svg.addEventListener('pointermove', (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const at = data.first + ((event.clientX - rect.left) / rect.width) * (data.last - data.first);
    show(nearest(data.nav, at));
  });
  svg.addEventListener('pointerleave', () => {
    if (document.activeElement !== box) hide();
  });
  box.addEventListener('blur', hide);
}

export function wireCharts(): void {
  document.querySelectorAll<HTMLElement>('[data-dchart]').forEach(wireChart);
}
