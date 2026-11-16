// How schedule tables are laid out on the page: the compact view shows the row header and the
// key columns (TableColumn.key, 1 to 3); the detailed view adds every other column, labeled,
// under its row. Shared by the build-time markup (ScheduleView.astro) and the browser script
// (src/scripts/calc/schedule.ts) so both mark cells the same way. The figures are the table
// source's, unchanged; the CSV and the report read the same source with every column.

import type { TableColumn } from '../report/table';

/** The number of key columns (the compact view's figures), at most 3. */
export function keyCount(columns: readonly TableColumn[]): number {
  return columns.filter((c, i) => i > 0 && c.key !== undefined).length;
}

/** The table's classes: a grid with one track for the row header and one per key column. */
export function gridClass(columns: readonly TableColumn[]): string {
  return `sched-grid sched-cols-${Math.min(3, Math.max(1, keyCount(columns)))}`;
}

/** The classes of the cells in column `index` (0 is the row header). */
export function cellClass(column: TableColumn | undefined, index: number): string {
  if (index === 0 || !column) return 'sched-period';
  const kind = column.key === undefined ? 'sched-x' : `sched-key sched-key--${column.key}`;
  return column.numeric ? `num ${kind}` : kind;
}

/**
 * Why a table's key columns cannot be laid out, or null when they can: keys must be 1 to n
 * with no gaps or repeats, in the order the columns appear, with at most three of them.
 */
export function keyProblem(columns: readonly TableColumn[]): string | null {
  const keys = columns.slice(1).flatMap((c) => (c.key === undefined ? [] : [c.key]));
  if (keys.length === 0) return 'no key columns';
  if (keys.length > 3) return `${keys.length} key columns (at most 3)`;
  if (keys.some((k, i) => k !== i + 1)) return `keys out of order: ${keys.join(', ')}`;
  return null;
}
