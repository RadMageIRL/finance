// Chart and table specs built from a dataset's own values, for the design-system review of the
// shared components (brief Q, agent 4). The dashboards build their own specs in their modules;
// these only show the components with real fixture rows. Nothing is computed: every value is a
// decimal string from the dataset, and periods are clipped, never filled in.
import type { EconDataset } from './econ';
import { changePoints, observations, seriesInfo } from './econ';
import { periodText, releaseText, valueText } from './shell-text';
import type { ChartBand, ChartLine, ChartSpec, TableSpec } from './ui';

/** The EFFR from `from` (YYYY-MM-DD) with the FOMC target: a single-rate step, then a band. */
export function effrWithTarget(ds: EconDataset, from: string, id: string): ChartSpec {
  const effr = observations(ds, 'effr').filter((o) => o.period >= from);
  const points = changePoints(ds, 'fomc-target');
  // The change point in effect at `from` starts at `from`; later ones keep their dates.
  const inEffect = [...points].reverse().find((p) => p.effective <= from);
  const visible = [...(inEffect ? [{ ...inEffect, effective: from }] : []), ...points.filter((p) => p.effective > from)];
  const step: ChartLine = { key: 'target-rate', label: 'Policy target (single rate), derived', shape: 'step', kind: 'derived', points: [] };
  const band: ChartBand = { key: 'target-range', label: 'Policy target range, derived', kind: 'derived', points: [] };
  for (const p of visible) {
    if (p.kind === 'rate') step.points.push({ x: p.effective, y: p.value });
    else {
      if (step.points.length && step.points[step.points.length - 1]?.y !== null) step.points.push({ x: p.effective, y: null });
      if (p.lower && p.upper) band.points.push({ x: p.effective, lower: p.lower, upper: p.upper });
    }
  }
  const lines: ChartLine[] = [{ key: 'effr', label: 'Market rate (EFFR)', shape: 'line', kind: 'observed', points: effr.map((o) => ({ x: o.period, y: o.value })) }];
  if (step.points.some((p) => p.y !== null)) lines.push(step);
  return { id, title: 'Effective federal funds rate and the FOMC target', unitLabel: 'Percent', periodKind: 'day', lines, bands: band.points.length ? [band] : [], tableId: `${id}-table` };
}

/** Period series of one unit as lines from `from` (inclusive), by their manifest titles. */
export function seriesLines(ds: EconDataset, ids: readonly string[], from: string, id: string, title: string): ChartSpec {
  const first = seriesInfo(ds, ids[0] ?? '');
  const lines: ChartLine[] = ids.map((s) => ({
    key: s,
    label: seriesInfo(ds, s).title,
    shape: 'line',
    kind: 'observed',
    points: observations(ds, s).filter((o) => o.period >= from).map((o) => ({ x: o.period, y: o.value })),
  }));
  return { id, title, unitLabel: first.unit_label, periodKind: first.frequency === 'month' ? 'month' : 'day', lines, tableId: `${id}-table` };
}

/** The last `count` observations of a series as a table, newest first. */
export function recentTable(ds: EconDataset, seriesId: string, count: number, id: string): TableSpec {
  const s = seriesInfo(ds, seriesId);
  const rows = observations(ds, seriesId).slice(-count).reverse();
  const periodLabel = s.frequency === 'month' ? 'Month' : 'Business day';
  return {
    id,
    caption: `${s.title}: the latest ${rows.length} values, newest first`,
    columns: [
      { key: 'period', label: periodLabel },
      { key: 'value', label: s.unit_label, numeric: true },
      { key: 'released', label: 'Release' },
    ],
    rows: rows.map((o) => ({
      period: periodText(s.frequency, o.period),
      value: o.value === null ? '' : valueText(o.value, s.unit_label),
      released: releaseText(o.releasedBasis, o.released),
    })),
  };
}
