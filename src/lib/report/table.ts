// Table sources: one definition of a table that the live page, the CSV export, the HTML
// report and the print view all read, so they can never show different numbers. Rows are
// built on demand, so a 36,500-row daily schedule costs nothing until a page of it is shown.

import { toCsv, type CsvCell } from '../calc/csv';

export interface TableColumn {
  label: string;
  /** Right-aligned, tabular figures. */
  numeric: boolean;
  /**
   * Schedule tables on the page: the column's place (1 to 3) in the compact view, which shows
   * the row header and these key columns; every other column shows in the detailed view only.
   */
  key?: number;
}

export interface TableRow {
  /** The row header (first column), for example "Mar, year 2". */
  head: string;
  /** One display string per remaining column. */
  cells: readonly string[];
  /** A short marker shown with the row header, for example "New APY". */
  note?: string;
  /** A subtotal or total inside the body, shown in bold. */
  strong?: boolean;
}

export interface TableSource {
  caption: string;
  /** Every column, the row header column first. */
  columns: readonly TableColumn[];
  count: number;
  row: (index: number) => TableRow;
  csvHeader: readonly string[];
  csvRow: (index: number) => readonly CsvCell[];
  /** Rows per page in the live view; the whole table when it is at least the count. */
  pageSize: number;
  /** The label of a page (0-based) for the pager, for example "Year 3". */
  pageLabel: (page: number) => string;
  footer?: TableRow;
  /** Year tables only: the months under each year (ENGINE_CONVENTIONS section 14). */
  detail?: TableDetail;
}

export interface TableDetail {
  /** The month table under row `index` (0-based), with a footer that totals the year. */
  table: (index: number) => TableSource;
  /** Every month of the term in one table: what the CSV holds when months are included. */
  all: () => TableSource;
  /** What the rows under a year are, for button names and headings: "months" or "payments". */
  noun: string;
}

export function tableCsv(table: TableSource): string {
  const rows: (readonly CsvCell[])[] = [];
  for (let i = 0; i < table.count; i += 1) rows.push(table.csvRow(i));
  return toCsv(table.csvHeader, rows);
}

export function pageCount(table: TableSource): number {
  return Math.max(1, Math.ceil(table.count / table.pageSize));
}

/** The row indexes on a page (0-based page number, clamped to the pages there are). */
export function pageRows(table: TableSource, page: number): { page: number; from: number; to: number } {
  const last = pageCount(table) - 1;
  const p = Math.max(0, Math.min(last, Math.floor(page)));
  return { page: p, from: p * table.pageSize, to: Math.min(table.count, (p + 1) * table.pageSize) };
}

/** A table from rows already in memory (short tables such as an account comparison). */
export function staticTable(spec: {
  caption: string;
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
  csvHeader?: readonly string[];
  csvRows?: readonly (readonly CsvCell[])[];
  footer?: TableRow;
}): TableSource {
  return {
    caption: spec.caption,
    columns: spec.columns,
    count: spec.rows.length,
    row: (i) => spec.rows[i]!,
    csvHeader: spec.csvHeader ?? spec.columns.map((c) => c.label),
    csvRow: (i) => spec.csvRows?.[i] ?? [spec.rows[i]!.head, ...spec.rows[i]!.cells],
    pageSize: Math.max(1, spec.rows.length),
    pageLabel: () => '',
    ...(spec.footer ? { footer: spec.footer } : {}),
  };
}
