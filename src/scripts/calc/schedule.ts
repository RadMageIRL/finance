// Schedule section behavior: Chart, Table or Both; grouping by day, month or year; paging
// for long tables; the chart tooltip; and, grouped by year, a button on each year that shows
// its months underneath (each year on its own, or all at once). It only displays what the calculator's view module
// gives it: the same table source that the CSV and the report read. Text is set as text;
// the chart SVG is built from numbers and fixed labels only (src/lib/calc/chart.ts).

import type { Grouping } from '../../lib/engines/schedule';
import { pageCount, pageRows, type TableRow, type TableSource } from '../../lib/report/table';
import { $, debounce, wireChartTooltip } from './kit';

export interface ScheduleSource {
  table: (grouping: Grouping) => TableSource;
  chart: (grouping: Grouping, width?: number) => string;
  tooltip: (grouping: Grouping, index: number) => readonly string[];
  notes: (grouping: Grouping) => readonly string[];
}

export interface ScheduleControl {
  /** Shows a new result (or keeps the last one hidden while results are withheld). */
  update: (source: ScheduleSource | null) => void;
  grouping: () => Grouping;
}

const NOUN: Readonly<Record<Grouping, string>> = { day: 'day', month: 'month', year: 'year' };

function rowElement(row: TableRow, columns: TableSource['columns'], toggle?: HTMLButtonElement): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const th = document.createElement('th');
  th.scope = 'row';
  if (toggle) th.append(toggle);
  else th.textContent = row.head;
  if (row.note) {
    const note = document.createElement('span');
    note.className = 'row-note';
    note.textContent = row.note;
    th.append(note);
  }
  tr.append(th);
  row.cells.forEach((text, i) => {
    const td = document.createElement('td');
    if (columns[i + 1]?.numeric) td.className = 'num';
    td.textContent = text;
    tr.append(td);
  });
  return tr;
}

/** A table source as a table element: caption, header, rows and footer, all set as text. */
function tableElement(source: TableSource): HTMLTableElement {
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.textContent = source.caption;
  const head = document.createElement('tr');
  for (const c of source.columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (c.numeric) th.className = 'num';
    th.textContent = c.label;
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  const tbody = document.createElement('tbody');
  for (let i = 0; i < source.count; i += 1) tbody.append(rowElement(source.row(i), source.columns));
  table.append(caption, thead, tbody);
  if (source.footer) {
    const foot = document.createElement('tfoot');
    foot.append(rowElement(source.footer, source.columns));
    table.append(foot);
  }
  return table;
}

export function wireSchedule(section: HTMLElement, onGrouping?: (grouping: Grouping) => void): ScheduleControl {
  const id = section.id;
  const out = (name: string) => $(section, `[data-out="${name}"]`);
  const chartBox = $(section, '[data-chart]');
  const pager = $(section, '[data-pager]');
  const jump = $(pager, '[data-page="jump"]') as HTMLSelectElement;
  const table = section.querySelector('table')!;
  let source: ScheduleSource | null = null;
  let grouping = (section.querySelector<HTMLInputElement>(`input[name="${id}-group"]:checked`)?.value ?? 'year') as Grouping;
  let page = 0;
  let current: TableSource | null = null;
  // Years whose months are showing, by row index. Kept across recalculations and groupings.
  const expanded = new Set<number>();
  const expandControls = out('expand-controls');
  const expandStatus = out('expand-status');
  const detailId = (i: number) => `${id}-months-${i}`;

  function toggleButton(row: TableRow, i: number, noun: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sched-toggle';
    button.dataset.row = String(i);
    button.setAttribute('aria-expanded', String(expanded.has(i)));
    button.setAttribute('aria-controls', detailId(i));
    const icon = document.createElement('span');
    icon.className = 'sched-toggle__icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = row.head;
    const hidden = document.createElement('span');
    hidden.className = 'vh';
    hidden.textContent = ` ${noun}`;
    button.append(icon, label, hidden);
    return button;
  }

  /** The row under year i that holds its month table; the table is built when first shown. */
  function detailRow(i: number, span: number): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.className = 'sched-detail';
    tr.id = detailId(i);
    tr.hidden = !expanded.has(i);
    const td = document.createElement('td');
    td.colSpan = span;
    tr.append(td);
    if (expanded.has(i)) fillDetail(tr, i);
    return tr;
  }

  function fillDetail(tr: HTMLTableRowElement, i: number): void {
    const cell = tr.firstElementChild as HTMLTableCellElement;
    if (!current?.detail || cell.childElementCount) return;
    const wrap = document.createElement('div');
    wrap.className = 'sched-sub';
    wrap.append(tableElement(current.detail.table(i)));
    cell.append(wrap);
  }

  function setExpanded(i: number, open: boolean): void {
    if (open) expanded.add(i);
    else expanded.delete(i);
    const button = out('table-rows').querySelector<HTMLButtonElement>(`.sched-toggle[data-row="${i}"]`);
    const tr = document.getElementById(detailId(i)) as HTMLTableRowElement | null;
    if (!button || !tr) return;
    button.setAttribute('aria-expanded', String(open));
    button.closest('tr')?.classList.toggle('is-expanded', open);
    if (open) fillDetail(tr, i);
    tr.hidden = !open;
  }

  const chartWidth = () => Math.round(chartBox.clientWidth) || undefined;
  const showsChart = () => section.dataset.view !== 'table';

  function renderChart(): void {
    if (!source || !showsChart()) return;
    out('chart').innerHTML = source.chart(grouping, chartWidth());
  }

  function renderPage(): void {
    if (!current) return;
    const { page: p, from, to } = pageRows(current, page);
    page = p;
    const rows: HTMLTableRowElement[] = [];
    const detail = current.detail;
    for (let i = from; i < to; i += 1) {
      const row = current.row(i);
      const tr = rowElement(row, current.columns, detail ? toggleButton(row, i, detail.noun) : undefined);
      rows.push(tr);
      if (detail) {
        tr.classList.add('sched-year');
        tr.classList.toggle('is-expanded', expanded.has(i));
        rows.push(detailRow(i, current.columns.length));
      }
    }
    out('table-rows').replaceChildren(...rows);
    const pages = pageCount(current);
    pager.hidden = pages <= 1;
    if (pages > 1) {
      jump.value = String(p);
      out('page-status').textContent = `Page ${p + 1} of ${pages}: rows ${(from + 1).toLocaleString('en-US')} to ${to.toLocaleString('en-US')} of ${current.count.toLocaleString('en-US')}.`;
      for (const [name, disabled] of [['first', p === 0], ['previous', p === 0], ['next', p === pages - 1], ['last', p === pages - 1]] as const) {
        ($(pager, `[data-page="${name}"]`) as HTMLButtonElement).disabled = disabled;
      }
    }
  }

  function renderTable(): void {
    if (!source) return;
    current = source.table(grouping);
    for (const i of [...expanded]) if (i >= current.count) expanded.delete(i);
    expandControls.hidden = !current.detail;
    if (current.detail) out('expand-noun').textContent = current.detail.noun;
    out('table-caption').textContent = current.caption;
    const head = out('table-head');
    head.replaceChildren(
      ...current.columns.map((c) => {
        const th = document.createElement('th');
        th.scope = 'col';
        if (c.numeric) th.className = 'num';
        th.textContent = c.label;
        return th;
      }),
    );
    table.querySelector('tfoot')?.remove();
    if (current.footer) {
      const foot = document.createElement('tfoot');
      foot.dataset.out = 'table-foot';
      foot.append(rowElement(current.footer, current.columns));
      table.append(foot);
    }
    const pages = pageCount(current);
    const t = current;
    jump.replaceChildren(
      ...Array.from({ length: pages }, (_, p) => {
        const option = document.createElement('option');
        option.value = String(p);
        option.textContent = t.pageLabel(p);
        return option;
      }),
    );
    renderPage();
  }

  function render(): void {
    if (!source) return;
    section.dataset.grouping = grouping;
    out('schedule-notes').replaceChildren(
      ...source.notes(grouping).map((text) => {
        const p = document.createElement('p');
        p.textContent = text;
        return p;
      }),
    );
    out('chart-noun').textContent = NOUN[grouping];
    renderTable();
    renderChart();
  }

  section.querySelectorAll<HTMLInputElement>('[data-action="view"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      section.dataset.view = radio.value;
      // A chart drawn while hidden has no width; draw it now that it shows.
      renderChart();
    }),
  );
  section.querySelectorAll<HTMLInputElement>('[data-action="group"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      grouping = radio.value as Grouping;
      page = 0;
      render();
      onGrouping?.(grouping);
    }),
  );
  const go = (to: number) => {
    page = to;
    renderPage();
  };
  out('table-rows').addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.sched-toggle');
    if (!button) return;
    const i = Number(button.dataset.row);
    setExpanded(i, !expanded.has(i));
  });
  const expandAll = (open: boolean) => {
    if (!current?.detail) return;
    for (let i = 0; i < current.count; i += 1) {
      if (open) expanded.add(i);
      else expanded.delete(i);
    }
    renderPage();
    expandStatus.textContent = open
      ? `Showing the ${current.detail.noun} of all ${current.count.toLocaleString('en-US')} ${current.count === 1 ? 'year' : 'years'}.`
      : `Showing the years only.`;
  };
  $(section, '[data-action="expand-all"]').addEventListener('click', () => expandAll(true));
  $(section, '[data-action="collapse-all"]').addEventListener('click', () => expandAll(false));
  $(pager, '[data-page="first"]').addEventListener('click', () => go(0));
  $(pager, '[data-page="previous"]').addEventListener('click', () => go(page - 1));
  $(pager, '[data-page="next"]').addEventListener('click', () => go(page + 1));
  $(pager, '[data-page="last"]').addEventListener('click', () => go(Number.MAX_SAFE_INTEGER));
  jump.addEventListener('change', () => go(Number(jump.value)));

  wireChartTooltip(chartBox, {
    count: () => (source ? (current?.count ?? 0) : 0),
    lines: (index) => (source ? source.tooltip(grouping, index) : []),
  });
  if ('ResizeObserver' in window) {
    let width = chartWidth();
    new ResizeObserver(
      debounce(() => {
        const next = chartWidth();
        if (next !== width) {
          width = next;
          renderChart();
        }
      }, 100),
    ).observe(chartBox);
  }

  return {
    update(next) {
      if (!next) return;
      source = next;
      render();
    },
    grouping: () => grouping,
  };
}
