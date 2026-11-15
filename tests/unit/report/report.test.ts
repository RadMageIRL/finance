// The shared report system: escaping, a self-contained offline document, file names
// without amounts, CSV and HTML that carry exactly the figures the page shows, and the
// row limit for very long schedules.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compoundReport, compoundSchedule, compoundScheduleConfig, DEFAULT_INPUT } from '../../../src/lib/calc/compound-view';
import { formatUSD } from '../../../src/lib/calc/format';
import { DEFAULT_RATES, illustrationInput, illustrationTable, ratesReport } from '../../../src/lib/calc/rates-view';
import { DEFAULT_SAVINGS, savingsReport, savingsSchedule, savingsScheduleConfig } from '../../../src/lib/calc/savings-view';
import { scheduleTable } from '../../../src/lib/calc/schedule-view';
import { compoundInterest, type CompoundInput } from '../../../src/lib/engines/compound';
import { savingsGrowth } from '../../../src/lib/engines/hysa';
import { compareRates } from '../../../src/lib/engines/rate-compare';
import { rateIllustration } from '../../../src/lib/engines/rate-illustration';
import type { Grouping } from '../../../src/lib/engines/schedule';
import {
  BRAND_MARK,
  escapeHtml,
  exportFilename,
  REPORT_CSP,
  REPORT_NOTICE,
  REPORT_ROW_LIMIT,
  reportBody,
  reportDocument,
  reportText,
  type Report,
} from '../../../src/lib/report/report';
import { pageCount, pageRows, staticTable, tableCsv } from '../../../src/lib/report/table';

const CSS = readFileSync('src/styles/report.css', 'utf8');
const WHEN = new Date(2026, 10, 15, 14, 30);

function savings(change: Partial<typeof DEFAULT_SAVINGS> = {}) {
  const input = { ...DEFAULT_SAVINGS, ...change };
  const r = savingsGrowth(input);
  if (!r.ok) throw new Error('invalid');
  return { input, result: r.value, schedule: savingsSchedule(input, r.value) };
}

function compound(change: Partial<CompoundInput> = {}) {
  const input = { ...DEFAULT_INPUT, ...change };
  const r = compoundInterest(input);
  if (!r.ok) throw new Error('invalid');
  return { input, result: r.value, schedule: compoundSchedule(input, r.value) };
}

/** A report whose every field holds markup, to prove nothing reaches the HTML unescaped. */
function hostile(): Report {
  const bad = '<script>alert("x")</script><img src=x onerror=alert(1)>&\'';
  const table = staticTable({ caption: bad, columns: [{ label: bad, numeric: false }, { label: bad, numeric: true }], rows: [{ head: bad, cells: [bad], note: bad }] });
  return {
    calculator: bad,
    generated: WHEN,
    headline: { label: bad, value: bad },
    summary: [{ label: bad, value: bad }],
    sentence: bad,
    inputs: [{ label: bad, value: bad }],
    composition: [{ label: bad, value: bad, share: bad }],
    rateChanges: [bad],
    tables: [{ heading: bad, table }],
    chart: { heading: bad, svg: '<svg class="chart"></svg>', legend: [bad], summary: bad },
    schedule: { heading: bad, table, notes: [bad] },
    assumptions: [bad],
    sources: [bad],
  };
}

describe('escaping', () => {
  it('escapes the five characters that can change HTML', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('never lets a report value become markup, in any section', () => {
    const html = reportBody(hostile());
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    // The attribute text survives only as escaped text inside an escaped tag.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the report document', () => {
  const { input, result, schedule } = savings();
  const doc = reportDocument(savingsReport(input, result, schedule, 'month', WHEN), CSS);

  it('carries a policy that allows no scripts and no requests, and has no script at all', () => {
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${escapeHtml(REPORT_CSP)}">`);
    expect(REPORT_CSP).toContain("default-src 'none'");
    expect(doc).not.toMatch(/<script|<link|<iframe|<object|<embed|@import|@font-face/i);
    expect(doc).not.toMatch(/\s(src|href|action|srcset)=/i);
  });

  it('refers to no other site: the only URLs are the SVG namespace', () => {
    const urls = [...doc.matchAll(/https?:\/\/[^\s"')<]+/g)].map((m) => m[0]);
    expect(new Set(urls)).toEqual(new Set(['http://www.w3.org/2000/svg']));
  });

  it('names the brand, the calculator and the date, and says it is hypothetical, not a statement or advice', () => {
    expect(doc).toContain('RadMage <b>Finance</b>');
    expect(doc).toContain('<h1>High-yield savings calculator</h1>');
    expect(doc).toContain('Generated November 15, 2026');
    expect(doc).toContain('Hypothetical calculation.');
    expect(REPORT_NOTICE).toMatch(/not a bank or account statement/);
    expect(REPORT_NOTICE).toMatch(/not financial, tax or legal advice/);
  });

  it('holds the inputs, assumptions, summary, chart and every row of the schedule', () => {
    for (const heading of ['Summary', 'Interest versus what was put in', 'Scenario', 'Rate changes', 'Balance by month', 'Assumptions', 'Schedule by month', 'Sources']) expect(doc, heading).toContain(`<h2>${heading}</h2>`);
    expect(doc.match(/<tbody>/g)!.length).toBeGreaterThanOrEqual(2);
    expect(doc).toContain('<svg class="chart chart--area"');
    // 60 months, each a row with its header cell.
    const scheduleHtml = doc.slice(doc.indexOf('<h2>Schedule by month</h2>'));
    expect(scheduleHtml.slice(0, scheduleHtml.indexOf('</tbody>')).match(/<tr><th scope="row">/g)).toHaveLength(60);
  });

  it('uses the same mark as the site icon', () => {
    expect(BRAND_MARK).toBe(readFileSync('public/favicon.svg', 'utf8').trim());
  });

  it('keeps every chart pattern id unique to the report', () => {
    const ids = [...doc.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id!.startsWith('report-chart-tex-'))).toEqual(['report-chart-tex-2', 'report-chart-tex-3']);
  });
});

describe('file names', () => {
  it('name the site, the calculator, what the file is and the date, never an amount', () => {
    expect(exportFilename('savings', 'Schedule by month', WHEN, 'csv')).toBe('radmage-finance-savings-schedule-by-month-2026-11-15.csv');
    expect(exportFilename('apr-apy', 'report', WHEN, 'html')).toBe('radmage-finance-apr-apy-report-2026-11-15.html');
    expect(exportFilename('compound-interest', 'summary', WHEN, 'txt')).toMatch(/^radmage-finance-[a-z-]+-2026-11-15\.txt$/);
  });
});

describe('the same figures everywhere', () => {
  const dollars = (csv: string | number) => formatUSD(Math.round(Number(csv) * 100));

  it('CSV values are the table values, unformatted, for every grouping of both savings engines', () => {
    const cases = [
      { ...savings(), config: savingsScheduleConfig(savings().result) },
      { ...compound(), config: compoundScheduleConfig(DEFAULT_INPUT) },
    ];
    for (const c of cases) {
      for (const g of ['day', 'month', 'year'] as const) {
        const table = scheduleTable(c.schedule, g, c.config);
        const header = table.csvHeader;
        const at = (name: string) => header.indexOf(name);
        for (const i of [0, 1, Math.floor(table.count / 2), table.count - 1]) {
          const csv = table.csvRow(i);
          const cells = table.row(i).cells;
          expect(dollars(csv[at('opening_balance_usd')]!), `${g} ${i}`).toBe(cells[0]);
          expect(dollars(csv[at('interest_credited_usd')]!), `${g} ${i}`).toBe(cells[3]);
          expect(dollars(csv[at('closing_balance_usd')]!), `${g} ${i}`).toBe(cells[5]);
          expect(dollars(csv[at('cumulative_interest_usd')]!), `${g} ${i}`).toBe(cells[6]);
          // Accrued: six decimals in the CSV, four on the page.
          expect(`$${Number(csv[at('interest_accrued_usd')]!).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`).toBe(cells[2]);
        }
      }
    }
  });

  it('the report shows exactly the rows of the live table', () => {
    const { input, result, schedule } = savings();
    const live = scheduleTable(schedule, 'month', savingsScheduleConfig(result));
    const report = savingsReport(input, result, schedule, 'month', WHEN).schedule!.table;
    expect(report.count).toBe(live.count);
    for (let i = 0; i < live.count; i += 1) expect(report.row(i)).toEqual(live.row(i));
    expect(tableCsv(report)).toBe(tableCsv(live));
  });

  it('the illustration CSV adds up: each interest is the change in the shown balance', () => {
    const c = compareRates(DEFAULT_RATES.accounts, DEFAULT_RATES.balance);
    if (!c.ok) throw new Error('invalid');
    const rows = rateIllustration(illustrationInput(c.value, 2), 'month');
    if (!rows.ok) throw new Error('invalid');
    const table = illustrationTable(c.value, rows.value, 'month');
    let previous = DEFAULT_RATES.balance;
    for (let i = 0; i < table.count; i += 1) {
      const csv = table.csvRow(i);
      const [balance, inPeriod, toDate] = [csv[4], csv[5], csv[6]].map((v) => Math.round(Number(v) * 100));
      expect(balance! - previous).toBe(inPeriod);
      expect(balance! - DEFAULT_RATES.balance).toBe(toDate);
      expect(formatUSD(balance!)).toBe(table.row(i).cells[0]);
      previous = balance!;
    }
  });
});

describe('long schedules', () => {
  it('pages a century of days a year at a time, and clamps any page number', () => {
    const { schedule } = compound({ years: 100, periodsPerYear: 365 });
    const table = scheduleTable(schedule, 'day', compoundScheduleConfig({ ...DEFAULT_INPUT, periodsPerYear: 365 }));
    expect(table.count).toBe(36_500);
    expect(pageCount(table)).toBe(100);
    expect(pageRows(table, 3)).toEqual({ page: 3, from: 1_095, to: 1_460 });
    expect(pageRows(table, 500).page).toBe(99);
    expect(pageRows(table, -2).page).toBe(0);
    expect(table.pageLabel(3)).toBe('Year 4');
  });

  it('exports every row to CSV, and prints a long daily schedule by month instead', () => {
    const c = compound({ years: 100, periodsPerYear: 365 });
    const daily = tableCsv(scheduleTable(c.schedule, 'day', compoundScheduleConfig(c.input)));
    expect(daily.split('\r\n')).toHaveLength(36_502);
    expect(daily.length).toBeLessThan(8_000_000);
    const report = compoundReport(c.input, c.result, c.schedule, 'day', WHEN);
    expect(report.schedule!.table.count).toBe(1_200);
    expect(report.schedule!.notes[0]).toContain('36,500 rows');
    expect(REPORT_ROW_LIMIT).toBeLessThan(36_500);
    const short = compound({ years: 2, periodsPerYear: 365 });
    expect(compoundReport(short.input, short.result, short.schedule, 'day', WHEN).schedule!.table.count).toBe(730);
  });

  it('prints a long daily illustration by month too', () => {
    const c = compareRates(DEFAULT_RATES.accounts, DEFAULT_RATES.balance);
    if (!c.ok) throw new Error('invalid');
    const rowsFor = (g: Grouping) => {
      const r = rateIllustration(illustrationInput(c.value, 30), g);
      if (!r.ok) throw new Error('invalid');
      return r.value;
    };
    const report = ratesReport({ ...DEFAULT_RATES, years: 30 }, c.value, rowsFor, 'day', WHEN);
    expect(report.schedule!.table.count).toBe(360);
    expect(report.schedule!.notes[0]).toContain('10,950 rows');
    expect(report.schedule!.fallbackFrom).toEqual({ heading: 'Balance illustration by day', rows: 10_950 });
  });
});

describe('the plain-text summary of a long daily schedule', () => {
  it('says the report and printout show it by month and only the CSV has every day', () => {
    const c = compound({ years: 100, periodsPerYear: 365 });
    const text = reportText(compoundReport(c.input, c.result, c.schedule, 'day', WHEN)).replace(/\s+/g, ' ');
    expect(text).toContain('You chose the schedule by day, which has 36,500 rows: too many for a readable report, so the HTML report and the printout show the schedule by month instead (1,200 rows). Download the CSV to get every row of the schedule by day.');
    expect(text).not.toContain('Download the CSV or the HTML report to see every row.');
    const short = compound({ years: 2, periodsPerYear: 365 });
    expect(reportText(compoundReport(short.input, short.result, short.schedule, 'day', WHEN)).replace(/\s+/g, ' ')).toContain('Download the CSV or the HTML report to see every row.');
  });
});

describe('the plain-text summary', () => {
  it('states the notice, the figures and the assumptions, and no schedule rows', () => {
    const { input, result, schedule } = savings();
    const text = reportText(savingsReport(input, result, schedule, 'year', WHEN));
    expect(text).toMatch(/^RadMage Finance: High-yield savings calculator\r\n/);
    expect(text).toContain('HYPOTHETICAL CALCULATION.');
    expect(text).toContain(`Projected balance: ${formatUSD(result.finalBalance)}`);
    expect(text).toContain('Assumption (rounding)');
    expect(text.replace(/\s+/g, ' ')).toContain('Download the CSV or the HTML report to see every row.');
    // Bullets: a hyphen on the first line of each item, an indent on the lines that follow it.
    expect(text).toContain('- Assumption (rounding)');
    expect(text).not.toMatch(/\r\n {2}- /);
    expect(text).not.toContain('<');
    for (const line of text.split('\r\n')) expect(line.length, line).toBeLessThanOrEqual(80);
  });
});
