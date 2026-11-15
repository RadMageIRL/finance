// Export controls: the HTML report, the schedule CSV, the plain-text summary and printing.
// Every file is built here in the browser from the same table sources the page shows, and
// handed to the browser as a download; nothing is sent anywhere. File names carry the
// calculator, what the file is and the date, never an amount the visitor entered.

import REPORT_CSS from '../../styles/report.css?raw';
import { exportFilename, reportBody, reportDocument, reportText, type Report } from '../../lib/report/report';
import { tableCsv, type TableSource } from '../../lib/report/table';
import { $, downloadText } from './kit';

export interface ExportSource {
  /** Short name for file names: "savings", "compound-interest", "apr-apy". */
  name: string;
  /** The report for what is on screen now, or null while results are withheld. */
  report: (generated: Date) => Report | null;
  /** The schedule table and what it is ("schedule by month"), or null while withheld. */
  csv: () => { table: TableSource; what: string } | null;
}

const PRINT_ROOT = 'print-root';

/** Puts the report into the page for printing; print CSS shows only it (src/styles/calc.css). */
function preparePrint(report: Report): void {
  document.querySelector(`.${PRINT_ROOT}`)?.remove();
  const root = document.createElement('div');
  root.className = PRINT_ROOT;
  // reportBody escapes every string; the chart SVG holds numbers and fixed labels only.
  root.innerHTML = reportBody(report);
  document.body.append(root);
}

export function wireExports(root: HTMLElement, source: ExportSource, settle: () => void): void {
  const status = $(root, '[data-out="export-status"]');
  const say = (text: string) => {
    status.textContent = text;
  };
  const withheld = () => say('Fix the highlighted entries first; there are no results to export yet.');

  $(root, '[data-action="report"]').addEventListener('click', () => {
    settle();
    const now = new Date();
    const report = source.report(now);
    if (!report) return withheld();
    const name = exportFilename(source.name, 'report', now, 'html');
    downloadText(name, reportDocument(report, REPORT_CSS), 'text/html;charset=utf-8');
    say(`Report saved as ${name}. It opens in any browser, works offline and loads nothing from the internet.`);
  });

  $(root, '[data-action="csv"]').addEventListener('click', () => {
    settle();
    const csv = source.csv();
    if (!csv) return withheld();
    const name = exportFilename(source.name, csv.what, new Date(), 'csv');
    downloadText(name, tableCsv(csv.table));
    say(`CSV saved as ${name}, ${csv.table.count.toLocaleString('en-US')} rows.`);
  });

  $(root, '[data-action="summary"]').addEventListener('click', () => {
    settle();
    const now = new Date();
    const report = source.report(now);
    if (!report) return withheld();
    const name = exportFilename(source.name, 'summary', now, 'txt');
    downloadText(name, reportText(report), 'text/plain;charset=utf-8');
    say(`Summary saved as ${name}.`);
  });

  $(root, '[data-action="print"]').addEventListener('click', () => {
    settle();
    const report = source.report(new Date());
    if (!report) return withheld();
    preparePrint(report);
    say('Opening the print dialog. Choose Save as PDF there to keep a PDF.');
    window.print();
  });

  // Printing from the browser's own menu prints the report too, when there are results.
  window.addEventListener('beforeprint', () => {
    if (document.querySelector(`.${PRINT_ROOT}`)) return;
    settle();
    const report = source.report(new Date());
    if (report) preparePrint(report);
  });
  window.addEventListener('afterprint', () => document.querySelector(`.${PRINT_ROOT}`)?.remove());
}
