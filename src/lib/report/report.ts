// Calculator reports: one model, rendered as a self-contained HTML document (download), as
// the print view (Save as PDF), and as a plain-text summary. Everything is built in the
// browser from the same table sources the page shows; nothing is uploaded.
//
// Every string that reaches HTML goes through escapeHtml, including the fixed labels, so a
// value could never become markup even if one day it came from the visitor. The document
// carries a Content-Security-Policy that allows no scripts and no network requests at all.

import { pageCount, type TableRow, type TableSource } from './table';

export interface ReportItem {
  label: string;
  value: string;
}

export interface ReportShare {
  label: string;
  value: string;
  /** Share of the final balance, for example "21.8%". */
  share: string;
}

export interface ReportChart {
  heading: string;
  /** SVG markup from src/lib/calc/chart.ts (numbers and fixed labels only). */
  svg: string;
  legend: readonly string[];
  /** One or two sentences that say what the chart shows, for print and screen readers. */
  summary: string;
}

export interface ReportSchedule {
  heading: string;
  table: TableSource;
  /** What the rows mean, for example how interest is accrued and credited. */
  notes: readonly string[];
  /**
   * Set when the visitor chose a schedule too long for a readable report (a daily one over
   * REPORT_ROW_LIMIT rows) and the report shows the schedule by month instead: the chosen
   * schedule's heading and row count. The CSV still has every row of the chosen schedule.
   */
  fallbackFrom?: { heading: string; rows: number };
  /** Show each year's month table under the year (the visitor's export choice; section 14). */
  months?: boolean;
}

/** Whether a report schedule includes the month tables: asked for, and the table has them. */
export const scheduleMonths = (schedule: ReportSchedule): boolean => Boolean(schedule.months && schedule.table.detail);

export interface Report {
  /** The calculator's name, for example "High-yield savings calculator". */
  calculator: string;
  generated: Date;
  headline: ReportItem;
  summary: readonly ReportItem[];
  sentence: string;
  inputs: readonly ReportItem[];
  /** How the final balance splits into what was put in and interest, or null. */
  composition: readonly ReportShare[] | null;
  /** Heading and caption for the composition; savings defaults apply when left out. */
  compositionText?: { heading: string; caption: string; shareLabel: string };
  /** Each rate change, stated in words, or null when there are none to state. */
  rateChanges: readonly string[] | null;
  /** Further short tables, for example an account comparison. */
  tables: readonly { heading: string; table: TableSource }[];
  chart: ReportChart | null;
  schedule: ReportSchedule | null;
  assumptions: readonly string[];
  sources: readonly string[];
}

export const REPORT_NOTICE =
  'For illustration only. This is not a bank or account statement, not an offer of any product, and not financial, tax or legal advice. The results follow from the inputs and assumptions listed in this report; real accounts, loans and rates will differ.';

const COMPOSITION_DEFAULT = { heading: 'Interest versus what was put in', caption: 'How the final balance is made up', shareLabel: 'Share of the final balance' };

export const REPORT_PRIVACY = 'Calculated in your browser. Nothing you entered or any result was sent to a server.';

/** The RadMage Finance mark (the same drawing as public/favicon.svg; a unit test keeps them equal). */
export const BRAND_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><path fill="#33506B" d="M2 0h12v1h-12zM1 1h1v1h-1zM14 1h1v1h-1zM0 2h1v1h-1zM15 2h1v1h-1zM0 3h1v1h-1zM15 3h1v1h-1zM0 4h1v1h-1zM15 4h1v1h-1zM0 5h1v1h-1zM15 5h1v1h-1zM0 6h1v1h-1zM15 6h1v1h-1zM0 7h1v1h-1zM15 7h1v1h-1zM0 8h1v1h-1zM15 8h1v1h-1zM0 9h1v1h-1zM15 9h1v1h-1zM0 10h1v1h-1zM15 10h1v1h-1zM0 11h1v1h-1zM15 11h1v1h-1zM0 12h1v1h-1zM15 12h1v1h-1zM0 13h1v1h-1zM15 13h1v1h-1zM1 14h1v1h-1zM14 14h1v1h-1zM2 15h12v1h-12z"/><path fill="#1B2636" d="M2 1h12v1h-12zM1 2h14v1h-14zM1 3h1v1h-1zM6 3h2v1h-2zM9 3h3v1h-3zM13 3h2v1h-2zM1 4h1v1h-1zM7 4h1v1h-1zM10 4h1v1h-1zM14 4h1v1h-1zM1 5h1v1h-1zM4 5h2v1h-2zM11 5h1v1h-1zM14 5h1v1h-1zM1 6h1v1h-1zM4 6h2v1h-2zM14 6h1v1h-1zM1 7h1v1h-1zM6 7h1v1h-1zM10 7h1v1h-1zM14 7h1v1h-1zM1 8h1v1h-1zM7 8h1v1h-1zM10 8h2v1h-2zM14 8h1v1h-1zM1 9h1v1h-1zM4 9h1v1h-1zM6 9h2v1h-2zM10 9h2v1h-2zM14 9h1v1h-1zM1 10h1v1h-1zM4 10h2v1h-2zM7 10h1v1h-1zM10 10h2v1h-2zM14 10h1v1h-1zM1 11h1v1h-1zM4 11h2v1h-2zM10 11h2v1h-2zM14 11h1v1h-1zM1 12h2v1h-2zM4 12h3v1h-3zM8 12h1v1h-1zM10 12h3v1h-3zM14 12h1v1h-1zM1 13h14v1h-14zM2 14h12v1h-12z"/><path fill="#C4F1FA" d="M2 3h4v1h-4zM8 3h1v1h-1zM12 3h1v1h-1zM2 4h1v1h-1zM6 4h1v1h-1zM8 4h2v1h-2zM11 4h2v1h-2zM2 5h1v1h-1zM6 5h1v1h-1zM8 5h1v1h-1zM10 5h1v1h-1zM12 5h1v1h-1z"/><path fill="#0B4A5B" d="M3 4h3v1h-3zM13 4h1v1h-1zM3 5h1v1h-1zM7 5h1v1h-1zM9 5h1v1h-1zM13 5h1v1h-1zM3 6h1v1h-1zM7 6h1v1h-1zM9 6h1v1h-1zM11 6h1v1h-1zM13 6h1v1h-1zM7 7h1v1h-1zM9 7h1v1h-1zM11 7h1v1h-1zM13 7h1v1h-1zM3 8h1v1h-1zM5 8h2v1h-2zM9 8h1v1h-1zM13 8h1v1h-1zM3 9h1v1h-1zM9 9h1v1h-1zM13 9h1v1h-1zM3 10h1v1h-1zM9 10h1v1h-1zM13 10h1v1h-1zM3 11h1v1h-1zM7 11h1v1h-1zM9 11h1v1h-1zM13 11h1v1h-1zM3 12h1v1h-1zM7 12h1v1h-1zM9 12h1v1h-1zM13 12h1v1h-1z"/><path fill="#7DD3E8" d="M2 6h1v1h-1zM6 6h1v1h-1zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM2 7h4v1h-4zM8 7h1v1h-1zM12 7h1v1h-1zM2 8h1v1h-1zM4 8h1v1h-1zM8 8h1v1h-1zM12 8h1v1h-1zM2 9h1v1h-1zM5 9h1v1h-1zM8 9h1v1h-1zM12 9h1v1h-1zM2 10h1v1h-1zM6 10h1v1h-1zM8 10h1v1h-1zM12 10h1v1h-1zM2 11h1v1h-1zM6 11h1v1h-1zM8 11h1v1h-1zM12 11h1v1h-1z"/></svg>';

/**
 * The report document's policy: nothing may load or run. Styles are inline, the mark and the
 * chart are inline SVG, and there is no script at all.
 */
export const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

/**
 * Rows above which a report and its printout show a long daily schedule by month instead
 * (about ten years of days); the CSV always keeps every row.
 */
export const REPORT_ROW_LIMIT = 3_660;

const HTML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

const e = escapeHtml;

const generatedFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' });

export function formatGenerated(date: Date): string {
  return generatedFormat.format(date);
}

/** A local calendar date as YYYY-MM-DD, for file names. */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A download name that never contains an amount the visitor entered: the site, the
 * calculator, what the file is, and the date. For example
 * radmage-finance-savings-schedule-by-month-2026-11-15.csv.
 */
export function exportFilename(calculator: string, what: string, date: Date, extension: 'csv' | 'html' | 'txt'): string {
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `radmage-finance-${slug(calculator)}-${slug(what)}-${isoDate(date)}.${extension}`;
}

function items(list: readonly ReportItem[]): string {
  return `<dl class="rmf-report__items">${list.map((i) => `<div><dt>${e(i.label)}</dt><dd>${e(i.value)}</dd></div>`).join('')}</dl>`;
}

function rowHtml(row: TableRow): string {
  const note = row.note ? ` <span class="rmf-report__note">${e(row.note)}</span>` : '';
  return `<tr${row.strong ? ' class="rmf-report__strong"' : ''}><th scope="row">${e(row.head)}${note}</th>${row.cells.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`;
}

/** The whole table, every row, with the numeric columns marked for alignment. */
export function tableHtml(table: TableSource, limit = Number.POSITIVE_INFINITY, options: { detail?: boolean } = {}): string {
  const numeric = table.columns.map((c) => c.numeric);
  const cols = numeric.map((n) => `<col${n ? ' class="num"' : ''}>`).join('');
  const head = table.columns.map((c, i) => `<th scope="col"${numeric[i] ? ' class="num"' : ''}>${e(c.label)}</th>`).join('');
  const body: string[] = [];
  const detail = options.detail ? table.detail : undefined;
  for (let i = 0; i < Math.min(table.count, limit); i += 1) {
    body.push(rowHtml(table.row(i)));
    // The year's months as their own table, in a row that spans the year table (section 14).
    if (detail) body.push(`<tr class="rmf-report__detail"><td colspan="${table.columns.length}">${tableHtml(detail.table(i))}</td></tr>`);
  }
  const foot = table.footer ? `<tfoot>${rowHtml(table.footer)}</tfoot>` : '';
  return `<table><caption>${e(table.caption)}</caption><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${body.join('')}</tbody>${foot}</table>`;
}

function section(cls: string, heading: string, body: string): string {
  return `<section class="rmf-report__section${cls ? ` rmf-report__${cls}` : ''}"><h2>${e(heading)}</h2>${body}</section>`;
}

/** The report's markup (an article), shared by the downloaded document and the print view. */
export function reportBody(report: Report): string {
  const parts: string[] = ['<article class="rmf-report">'];
  parts.push(
    '<header class="rmf-report__head">' +
      `<p class="rmf-report__brand"><span class="rmf-report__mark" aria-hidden="true">${BRAND_MARK}</span><span>RadMage <b>Finance</b></span></p>` +
      `<p class="rmf-report__kind">Calculator report</p>` +
      `<h1>${e(report.calculator)}</h1>` +
      `<p class="rmf-report__meta">Generated ${e(formatGenerated(report.generated))}. ${e(REPORT_PRIVACY)}</p>` +
      `<p class="rmf-report__notice"><strong>Hypothetical calculation.</strong> ${e(REPORT_NOTICE)}</p>` +
      '</header>',
  );
  parts.push(
    section(
      'summary',
      'Summary',
      `<p class="rmf-report__headline"><span>${e(report.headline.label)}</span> <strong>${e(report.headline.value)}</strong></p>${items(report.summary)}<p>${e(report.sentence)}</p>`,
    ),
  );
  const composed = report.compositionText ?? COMPOSITION_DEFAULT;
  if (report.composition) {
    const rows = report.composition.map((c) => `<tr><th scope="row">${e(c.label)}</th><td>${e(c.value)}</td><td>${e(c.share)}</td></tr>`).join('');
    parts.push(
      section(
        'composition',
        composed.heading,
        `<table><caption>${e(composed.caption)}</caption><colgroup><col><col class="num"><col class="num"></colgroup><thead><tr><th scope="col">Part</th><th scope="col" class="num">Amount</th><th scope="col" class="num">${e(composed.shareLabel)}</th></tr></thead><tbody>${rows}</tbody></table>`,
      ),
    );
  }
  parts.push(section('inputs', 'Scenario', items(report.inputs)));
  if (report.rateChanges?.length) parts.push(section('rates', 'Rate changes', `<ul>${report.rateChanges.map((r) => `<li>${e(r)}</li>`).join('')}</ul>`));
  for (const t of report.tables) parts.push(section('extra', t.heading, tableHtml(t.table)));
  if (report.chart) {
    const legend = report.chart.legend.map((label, i) => `<li><svg class="rmf-report__key" viewBox="0 0 12 12" aria-hidden="true"><rect class="chart__seg chart__seg--${i + 1}" width="12" height="12" rx="2"/>${i > 0 ? `<rect class="chart__tex" fill="url(#report-chart-tex-${i + 1})" width="12" height="12" rx="2"/>` : ''}</svg>${e(label)}</li>`).join('');
    parts.push(section('chart', report.chart.heading, `<ul class="rmf-report__legend">${legend}</ul><div class="rmf-report__figure">${report.chart.svg}</div><p class="rmf-report__caption">${e(report.chart.summary)}</p>`));
  }
  parts.push(section('assumptions', 'Assumptions', `<ul>${report.assumptions.map((a) => `<li>${e(a)}</li>`).join('')}</ul>`));
  if (report.schedule) {
    const { table, notes, heading } = report.schedule;
    const months = scheduleMonths(report.schedule);
    const notesHtml = [...notes, ...(months ? [`Each year is followed by its ${table.detail!.noun}, taken from the same schedule; each ${table.detail!.noun} table ends with the year's totals.`] : [])]
      .map((n) => `<p class="rmf-report__small">${e(n)}</p>`)
      .join('');
    parts.push(section('schedule', months ? `${heading}, with each year's ${table.detail!.noun}` : heading, `${notesHtml}${tableHtml(table, Number.POSITIVE_INFINITY, { detail: months })}`));
  }
  if (report.sources.length) parts.push(section('sources', 'Sources', `<ul>${report.sources.map((s) => `<li>${e(s)}</li>`).join('')}</ul>`));
  parts.push(`<footer class="rmf-report__foot"><p>RadMage Finance, published by RadMage Labs. A hypothetical calculation. ${e(REPORT_NOTICE)}</p></footer>`);
  parts.push('</article>');
  return parts.join('');
}

/** A complete, self-contained HTML document: inline styles, inline SVG, no scripts, no requests. */
export function reportDocument(report: Report, css: string): string {
  const title = `${report.calculator} report, RadMage Finance`;
  return (
    '<!doctype html>\n<html lang="en-US">\n<head>\n<meta charset="utf-8">\n' +
    `<meta http-equiv="Content-Security-Policy" content="${e(REPORT_CSP)}">\n` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light dark">\n<meta name="robots" content="noindex">\n' +
    `<title>${e(title)}</title>\n<style>\n${css.replace(/<\//g, '<\\/')}\n</style>\n</head>\n<body class="rmf-report-page">\n${reportBody(report)}\n</body>\n</html>\n`
  );
}

/** The schedule a report includes: the table, or a note pointing to the CSV when it is too long. */
export function reportSchedule(schedule: ReportSchedule, fallback: ReportSchedule | null): ReportSchedule {
  if (schedule.table.count <= REPORT_ROW_LIMIT || !fallback) return schedule;
  return {
    ...fallback,
    fallbackFrom: { heading: schedule.heading, rows: schedule.table.count },
    notes: [
      `The ${schedule.heading.toLowerCase()} has ${schedule.table.count.toLocaleString('en-US')} rows, too many for a readable report, so this report shows the schedule by month. Download the CSV for every row.`,
      ...fallback.notes,
    ],
  };
}

function wrap(text: string, width = 78): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = '';
    }
    line += line ? ` ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** A list item: a hyphen on its first line, the lines after it indented to match. */
function bullet(text: string): string[] {
  return wrap(text, 76).map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`));
}

/** A plain-text summary: everything in the report except the chart and the schedule rows. */
export function reportText(report: Report): string {
  const out: string[] = [];
  const heading = (text: string) => out.push('', text, '-'.repeat(text.length));
  out.push(`RadMage Finance: ${report.calculator}`, `Generated ${formatGenerated(report.generated)}`, '');
  out.push(...wrap(`HYPOTHETICAL CALCULATION. ${REPORT_NOTICE}`));
  heading('Summary');
  out.push(`${report.headline.label}: ${report.headline.value}`);
  for (const i of report.summary) out.push(`${i.label}: ${i.value}`);
  out.push('', ...wrap(report.sentence));
  if (report.composition) {
    heading((report.compositionText ?? COMPOSITION_DEFAULT).heading);
    const width = Math.max(...report.composition.map((c) => c.label.length));
    for (const c of report.composition) out.push(`${c.label.padEnd(width)}  ${c.value.padStart(18)}  ${c.share.padStart(6)}`);
  }
  heading('Scenario');
  for (const i of report.inputs) out.push(`${i.label}: ${i.value}`);
  if (report.rateChanges?.length) {
    heading('Rate changes');
    for (const r of report.rateChanges) out.push(...bullet(r));
  }
  for (const t of report.tables) {
    heading(t.heading);
    for (let i = 0; i < t.table.count; i += 1) {
      const row = t.table.row(i);
      out.push(`${row.head}: ${row.cells.map((c, k) => `${t.table.columns[k + 1]!.label} ${c}`).join(', ')}`);
    }
  }
  heading('Assumptions');
  for (const a of report.assumptions) out.push(...bullet(a));
  if (report.schedule) {
    heading('Schedule');
    const rows = report.schedule.table.count;
    const chosen = report.schedule.fallbackFrom;
    if (chosen) {
      out.push(...wrap(`You chose the ${chosen.heading.toLowerCase()}, which has ${chosen.rows.toLocaleString('en-US')} rows: too many for a readable report, so the HTML report and the printout show the ${report.schedule.heading.toLowerCase()} instead (${rows.toLocaleString('en-US')} ${rows === 1 ? 'row' : 'rows'}). Download the CSV to get every row of the ${chosen.heading.toLowerCase()}.`));
    } else {
      out.push(...wrap(`The ${report.schedule.heading.toLowerCase()} has ${rows.toLocaleString('en-US')} ${rows === 1 ? 'row' : 'rows'}${pageCount(report.schedule.table) > 1 ? `, in ${pageCount(report.schedule.table).toLocaleString('en-US')} pages on the calculator page` : ''}. Download the CSV or the HTML report to see every row.`));
    }
    if (scheduleMonths(report.schedule)) {
      const noun = report.schedule.table.detail!.noun;
      out.push(...wrap(`With each year's ${noun} included, the HTML report and the printout show the ${noun} of every year under that year, and the CSV holds every one of the ${report.schedule.table.detail!.all().count.toLocaleString('en-US')} ${noun}.`));
    }
  }
  if (report.sources.length) {
    heading('Sources');
    for (const s of report.sources) out.push(...bullet(s));
  }
  out.push('', 'RadMage Finance, published by RadMage Labs.', '');
  return out.join('\r\n');
}
