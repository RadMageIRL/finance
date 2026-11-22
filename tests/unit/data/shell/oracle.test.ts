// The shell's display rules against the independent Python oracle (tests/oracle/econ_shell.py,
// fixture tests/oracle/fixtures/econ-shell.json): shell-text.ts T1 to T7, status.ts S1 to S5 and
// line-chart.ts C1 to C8, case by case.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { READ_COLUMNS, placeAnnotations, columnOf, dayNumber, dayString, decodeChartData, describeChart, keptRuns, monthNumber, monthString, periodLabels, readingPoints, readoutAt, renderChart, valueAxis } from '../../../../src/lib/data/line-chart';
import { compareDecimal, periodText, rangeText, releaseText, snapshotText, timeText, valueText } from '../../../../src/lib/data/shell-text';
import { pageState, refreshOutcome, refreshText, statusLabel, statusSentence, viewStatus } from '../../../../src/lib/data/status';
import type { SeriesStatusKind, StatusFields } from '../../../../src/lib/data/status';
import type { ChartSpec } from '../../../../src/lib/data/ui';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const O: Record<string, any> = JSON.parse(readFileSync('tests/oracle/fixtures/econ-shell.json', 'utf8'));

describe('text rules T1 to T7 match the oracle', () => {
  it('words values with their units (T1) and ranges (T2)', () => {
    expect(O.values.length).toBeGreaterThan(10);
    for (const [v, u, want] of O.values) expect(valueText(v, u), `${v} ${u}`).toBe(want);
    for (const [a, b, u, want] of O.ranges) expect(rangeText(a, b, u)).toBe(want);
  });
  it('words periods (T3), times (T4) and snapshots (T5)', () => {
    for (const [freq, p, want] of O.periods) expect(periodText(freq, p)).toBe(want);
    for (const [t, want] of O.times) expect(timeText(t)).toBe(want);
    for (const [s, want] of O.snapshots) expect(snapshotText(s)).toBe(want);
  });
  it('words release dates by basis (T6) and compares decimals exactly (T7)', () => {
    for (const [basis, day, want] of O.releases) expect(releaseText(basis, day)).toBe(want);
    for (const [a, b, want] of O.compares) {
      expect(Math.sign(compareDecimal(a, b)), `${a} vs ${b}`).toBe(want);
      expect(Math.sign(compareDecimal(b, a))).toBe(want === 0 ? 0 : -want);
    }
  });
});

describe('status rules S1 to S5 match the oracle', () => {
  it('gives each series status at each time, with its label and wording (S1, S3)', () => {
    expect(O.statuses.length).toBe(66);
    for (const c of O.statuses) {
      const s = c.series as StatusFields;
      const kind = viewStatus(s, c.now);
      expect(kind, `${s.status} at ${c.now}`).toBe(c.kind);
      expect(statusLabel(kind)).toBe(c.label);
      expect(statusSentence(kind, s)).toBe(c.sentence);
    }
  });
  it('gives the page state (S4) and the outcome and wording of the newer-data check (S5)', () => {
    for (const [source, kinds, want] of O.pages) expect(pageState(source, kinds as SeriesStatusKind[])).toBe(want);
    for (const c of O.refresh) {
      const outcome = refreshOutcome(c.build, c.status, c.body);
      expect(outcome, JSON.stringify(c.body)).toBe(c.outcome);
      expect(refreshText(outcome)).toBe(c.text);
    }
  });
});

describe('chart rules C1 to C8 match the oracle', () => {
  it('numbers days and months (C1)', () => {
    for (const [d, n] of O.days) {
      expect(dayNumber(d), d).toBe(n);
      expect(dayString(n)).toBe(d);
    }
    for (const [m, n] of O.months) {
      expect(monthNumber(m)).toBe(n);
      expect(monthString(n)).toBe(m);
    }
  });
  it('chooses the value axis ticks, labels and title (C2, C3)', () => {
    for (const c of O.axes) {
      const a = valueAxis(c.values, c.unit);
      expect({ ticks: a.ticks, labels: a.labels, title: a.title }, JSON.stringify(c.values)).toEqual({ ticks: c.ticks, labels: c.labels, title: c.title });
    }
  });
  it('chooses the period labels for wide and narrow plots (C4)', () => {
    for (const c of O.periodLabels) {
      const kind = c.kind as 'day' | 'month';
      const pos = (p: string) => (kind === 'day' ? dayNumber(p) : monthNumber(p));
      let first = pos(c.from);
      let last = pos(c.to);
      const ends: [number, number] = [first, last];
      if (first === last) [first, last] = [first - 1, last + 1];
      expect(periodLabels(kind, first, last, c.most, ends).map((l) => [l.at, l.text]), `${c.from} ${c.to} ${c.most}`).toEqual(c.labels);
    }
  });
  it('keeps the lowest and highest point of each of the 500 drawing columns and each run\'s ends, split at gaps (C5)', () => {
    const d = O.decimation;
    const pts = (d.points as { x: string; y: string | null }[]).map((p) => ({ at: dayNumber(p.x), y: p.y }));
    const runs = keptRuns(pts, d.first, d.last);
    expect(runs.map((r) => r.map((p) => dayString(p.at)))).toEqual(d.runs);
    // At most two points per drawing column besides the run's ends, and never across a gap;
    // every run starts and ends at its own first and last points.
    const all = pts.filter((p) => p.y !== null);
    for (const r of runs) {
      const perColumn = new Map<number, number>();
      for (const p of r.slice(1, -1)) perColumn.set(columnOf(p.at, d.first, d.last), (perColumn.get(columnOf(p.at, d.first, d.last)) ?? 0) + 1);
      if (perColumn.size) expect(Math.max(...perColumn.values())).toBeLessThanOrEqual(2);
      const i = all.findIndex((p) => p.at === r[0]!.at);
      const j = all.findIndex((p) => p.at === r.at(-1)!.at);
      expect(pts.findIndex((p) => p.at === r[0]!.at) === 0 || pts[pts.findIndex((p) => p.at === r[0]!.at) - 1]!.y === null, dayString(r[0]!.at)).toBe(true);
      expect(j - i + 1).toBeGreaterThanOrEqual(r.length);
    }
    expect(runs[0]![0]!.at).toBe(all[0]!.at);
    expect(runs.at(-1)!.at(-1)!.at).toBe(all.at(-1)!.at);
    // C6: the reading points, at most two per reading column, each one a drawn point.
    const reading = [...new Set(readingPoints(pts, d.first, d.last))].sort((a, b) => a - b);
    expect(reading.map(dayString)).toEqual(d.reading);
    expect(reading.length).toBeLessThanOrEqual(2 * READ_COLUMNS + 2);
    expect(reading[0]).toBe(all[0]!.at);
    expect(reading.at(-1)).toBe(all.at(-1)!.at);
    const drawn = new Set(runs.flat().map((p) => p.at));
    for (const at of reading) expect(drawn.has(at), dayString(at)).toBe(true);
  });
  it('reads every reading position with each series value in effect (C6, C7) and describes the chart (C8)', () => {
    for (const c of O.charts) {
      const spec = c.spec as ChartSpec;
      const r = renderChart(spec);
      const labels = [...spec.lines.map((l) => l.label), ...(spec.bands ?? []).map((b) => b.label)];
      const data = decodeChartData(r.data, labels, spec.unitLabel);
      expect([data.first, data.last]).toEqual([c.first, c.last]);
      expect(data.nav).toEqual(c.nav);
      expect(c.nav.map((_n: number, i: number) => readoutAt(data, i))).toEqual(c.readouts.map((x: { period: string; rows: string[][] }) => ({ period: x.period, rows: x.rows.map(([label, value]) => ({ label, value })) })));
      expect(describeChart(spec)).toBe(c.description);
      expect(r.description).toBe(c.description);
    }
  });
  it('numbers the annotations in period order and marks those inside the range (C10)', () => {
    for (const c of O.annotations) {
      const kind = c.kind as 'day' | 'month';
      const pos = (p: string) => (kind === 'day' ? dayNumber(p) : monthNumber(p));
      const placed = placeAnnotations(kind, pos(c.from), pos(c.to), c.annotations);
      expect(placed.map((a) => [a.n, a.at, a.period, a.label, a.inRange])).toEqual(c.placed);
    }
  });
});
