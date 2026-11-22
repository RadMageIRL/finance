// The Interest Rate Tracker's calculations (src/lib/data/rates.ts, rules R1 to R13) against the
// independent Python oracle (tests/oracle/econ_rates.py, written from the rules alone) and on the
// appendix B fixture dataset (test data, never a publication), written fresh by the scenario.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangePoint, EconDataset, Observation } from '../../../src/lib/data/econ';
import { changePoints, observations, seriesInfo } from '../../../src/lib/data/econ';
import { loadEconDataset } from '../../../src/lib/data/econ-load';
import type { RatePoint, TargetPoint } from '../../../src/lib/data/rates';
import {
  COMPARE_WINDOW_DAYS,
  DEFAULT_RANGE,
  EFFR_LABEL,
  RANGES,
  RECENT_ROWS,
  TARGET_RANGE_LABEL,
  TARGET_RATE_LABEL,
  bpChange,
  bpWithUnit,
  bpWords,
  changePointRows,
  chartWindow,
  comparisonTable,
  daysFrom,
  downloads,
  effrComparisons,
  effrOnOrBefore,
  formatUtc,
  latestEffr,
  missingText,
  monthsBack,
  previousEffr,
  rateChartSpec,
  recentRows,
  releaseCell,
  releaseText,
  segmentOf,
  signedBp,
  signedTargetChange,
  targetAt,
  targetBounds,
  targetChange,
  targetChangeWithUnit,
  targetChangeWords,
  targetText,
} from '../../../src/lib/data/rates';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
// The pipeline comes from finance-data (ECON_TOOLS) or this tree (tools/econ-tools.mjs; brief V item 3).
import { importEconTool } from '../../../tools/econ-tools.mjs';
const { runScenario } = (await importEconTool('pipeline/bin/fixture-scenario.mjs')) as Loose;

const ORACLE = JSON.parse(readFileSync(join('tests', 'oracle', 'fixtures', 'econ-rates.json'), 'utf8')) as Loose;

/** Everything the oracle states about one case, computed here in the contract's shape. */
function contract(obs: readonly RatePoint[], cps: readonly TargetPoint[], targetDates: readonly string[], complete: boolean): Loose {
  const latest = latestEffr(obs);
  const target = (c: TargetPoint | null) => (c ? { effective: c.effective, ...targetBounds(c) } : null);
  return {
    latest: latest ? { period: latest.period, value: latest.value } : null,
    comparisons: effrComparisons(obs).map((c) => ({ id: c.id, date: c.date, period: c.found?.period ?? null, value: c.found?.value ?? null, bp: c.bp, reason: c.reason })),
    target_at: targetDates.map((date) => ({ date, effective: targetAt(cps, date)?.effective ?? null })),
    change_points: changePointRows(cps).map((r) => ({ effective: r.cp.effective, lower: r.bounds.lower, upper: r.bounds.upper, change: r.change })),
    comparison_table: comparisonTable(obs, cps).map((r) => ({ id: r.id, period: r.found?.period ?? null, effr: r.found?.value ?? null, target: target(r.target), target_change: r.targetChange })),
    recent: recentRows(obs).map((r) => ({ period: r.obs.period, value: r.obs.value, previous: r.previous?.period ?? null, bp: r.bp })),
    windows: Object.fromEntries(
      RANGES.map((r) => {
        const w = chartWindow(obs, cps, r.id);
        if (!w) return [r.id, null];
        const effr = complete ? { effr: w.effr.map((o) => [o.period, o.value]) } : {};
        return [r.id, { start: w.start, end: w.end, x0: w.x0, effr_first: w.effr[0]?.period ?? null, effr_last: w.effr.at(-1)?.period ?? null, ...effr, segments: w.segments }];
      }),
    ),
  };
}

const casePoints = (c: Loose): RatePoint[] => (c.observations as [string, string | null][]).map(([period, value]) => ({ period, value }));

describe('the independent oracle (tests/oracle/econ_rates.py)', () => {
  it('names its generator and the rules it was written from', () => {
    expect(ORACLE.generator).toBe('tests/oracle/econ_rates.py');
    expect(ORACLE.rules).toMatch(/R1 to R13/);
    expect(ORACLE.bp.length).toBeGreaterThanOrEqual(10);
    expect(ORACLE.cases.length).toBeGreaterThanOrEqual(8);
  });

  it('agrees on every basis point change, its signed form and its words (R1, R2)', () => {
    for (const e of ORACLE.bp as Loose[]) {
      const bp = bpChange(e.earlier, e.later);
      expect(bp, `${e.earlier} to ${e.later}`).toBe(e.bp);
      expect(signedBp(bp)).toBe(e.signed);
      expect(bpWords(bp)).toBe(e.words);
    }
  });

  it('agrees on every date minus a number of months (R3)', () => {
    for (const e of ORACLE.months_back as Loose[]) expect(monthsBack(e.date, e.months), `${e.date} minus ${e.months}`).toBe(e.result);
  });

  it('agrees on every target change, signed and in words (R8, R9)', () => {
    for (const e of ORACLE.target_change as Loose[]) {
      const c = targetChange(e.earlier, e.later);
      expect(c, `${e.earlier.effective} to ${e.later.effective}`).toEqual({ lower: e.lower, upper: e.upper });
      expect(signedTargetChange(c)).toBe(e.signed);
      expect(targetChangeWords(c)).toBe(e.words);
    }
  });

  it('agrees on every case: latest, comparisons, targets, change points, the tables and the chart windows (R4 to R13)', () => {
    for (const c of ORACLE.cases as Loose[]) {
      expect(contract(casePoints(c), c.change_points, c.target_dates, c.complete), c.id).toEqual(c.expected);
    }
  });
});

describe('the rules on edge cases', () => {
  it('writes basis points exactly and canonically (R2)', () => {
    expect(bpChange('3.64', '3.88')).toBe('24');
    expect(bpChange('3.88', '3.875')).toBe('-0.5');
    expect(bpChange('1.00', '1.000')).toBe('0');
    expect(bpChange('-0.10', '0.15')).toBe('25');
    expect(bpChange('0', '5.25')).toBe('525');
    expect(bpChange('5.25', '5.2')).toBe('-5');
    expect(signedBp('25')).toBe('+25');
    expect(signedBp('-0.5')).toBe('-0.5');
    expect(signedBp('0')).toBe('0');
    expect(bpWords('1')).toBe('up 1 basis point');
    expect(bpWords('-1')).toBe('down 1 basis point');
    expect(bpWords('-0.5')).toBe('down 0.5 basis points');
    expect(bpWithUnit('1')).toBe('+1 basis point');
    expect(bpWithUnit('-25')).toBe('-25 basis points');
    expect(bpWithUnit('0')).toBe('0 basis points');
  });

  it('throws on a value that is not a decimal string, and on a bad date or month count', () => {
    expect(() => bpChange('3.88', '3,87')).toThrow(/decimal/);
    expect(() => bpChange('1e2', '1')).toThrow(/decimal/);
    expect(() => monthsBack('2026-11', 1)).toThrow(/date/);
    expect(() => monthsBack('2026-11-18', -1)).toThrow(/months/);
    expect(() => targetBounds({ effective: '2001-01-03', kind: 'rate', value: null, lower: null, upper: null })).toThrow(/no value/);
    expect(() => targetBounds({ effective: '2009-01-02', kind: 'range', value: null, lower: '0.00', upper: null })).toThrow(/no bounds/);
    expect(() => formatUtc('2026-11-19 22:17')).toThrow(/UTC/);
  });

  it('clamps months back to the end of a shorter month, across years and leap days (R3)', () => {
    expect(monthsBack('2026-03-31', 1)).toBe('2026-02-28');
    expect(monthsBack('2024-03-31', 1)).toBe('2024-02-29');
    expect(monthsBack('2024-02-29', 12)).toBe('2023-02-28');
    expect(monthsBack('2024-02-29', 48)).toBe('2020-02-29');
    expect(monthsBack('2100-03-31', 1)).toBe('2100-02-28');
    expect(monthsBack('2000-03-31', 1)).toBe('2000-02-29');
    expect(monthsBack('2026-01-15', 1)).toBe('2025-12-15');
    expect(monthsBack('2026-11-18', 0)).toBe('2026-11-18');
    expect(monthsBack('2026-11-18', 120)).toBe('2016-11-18');
    expect(daysFrom('2026-11-11', '2026-11-18')).toBe(7);
  });

  it('skips missing values and uses an observation at most 7 days before the comparison date (R4 to R6)', () => {
    const obs: RatePoint[] = [
      { period: '2026-01-02', value: '3.64' },
      { period: '2026-01-05', value: null },
      { period: '2026-01-06', value: '3.63' },
      { period: '2026-01-20', value: '3.62' },
      { period: '2026-01-21', value: null },
    ];
    expect(latestEffr(obs)?.period).toBe('2026-01-20');
    expect(previousEffr(obs, '2026-01-06')?.period).toBe('2026-01-02');
    expect(COMPARE_WINDOW_DAYS).toBe(7);
    expect(effrOnOrBefore(obs, '2026-01-13')).toEqual({ found: obs[2], reason: null });
    expect(effrOnOrBefore(obs, '2026-01-14')).toEqual({ found: null, reason: 'outside-window' });
    expect(effrOnOrBefore(obs, '2026-01-01')).toEqual({ found: null, reason: 'before-data' });
    expect(latestEffr([{ period: '2026-01-02', value: null }])).toBeNull();
    expect(effrComparisons([{ period: '2026-01-02', value: null }])).toEqual([]);
    const one = effrComparisons([{ period: '2026-01-02', value: '3.64' }]);
    expect(one.map((c) => c.reason)).toEqual(['no-earlier', 'before-data', 'before-data', 'before-data']);
  });

  it('measures the move from a single rate to a range on each bound (R9)', () => {
    const rate: TargetPoint = { effective: '2008-10-29', kind: 'rate', value: '1.00', lower: null, upper: null };
    const range: TargetPoint = { effective: '2008-12-16', kind: 'range', value: null, lower: '0.00', upper: '0.25' };
    const c = targetChange(rate, range);
    expect(c).toEqual({ lower: '-100', upper: '-75' });
    expect(signedTargetChange(c)).toBe('lower -100, upper -75');
    expect(targetChangeWords(c)).toBe('lower bound down 100 basis points, upper bound down 75 basis points');
    expect(targetChangeWithUnit(c)).toBe('lower -100, upper -75 basis points');
    expect(targetChangeWithUnit({ lower: '25', upper: '25' })).toBe('+25 basis points');
    expect(targetText(rate)).toBe('1.00 percent');
    expect(targetText(range)).toBe('0.00 to 0.25 percent');
    expect(changePointRows([rate, range]).map((r) => r.change)).toEqual([null, { lower: '-100', upper: '-75' }]);
  });

  it('builds no window without data, and closes each target segment where the next begins (R13)', () => {
    expect(chartWindow([], [], '5y')).toBeNull();
    expect(DEFAULT_RANGE).toBe('5y');
    const cps: TargetPoint[] = [
      { effective: '2008-10-29', kind: 'rate', value: '1.00', lower: null, upper: null },
      { effective: '2008-12-16', kind: 'range', value: null, lower: '0.00', upper: '0.25' },
    ];
    const w = chartWindow([{ period: '2009-06-30', value: '0.21' }], cps, 'all');
    expect(w?.start).toBe('2008-10-29');
    expect(w?.segments).toEqual([
      { kind: 'rate', points: [['2008-10-29', '1.00'], ['2008-12-16', '1.00']] },
      { kind: 'range', points: [['2008-12-16', '0.00', '0.25'], ['2009-06-30', '0.00', '0.25']] },
    ]);
    // A window that starts inside a segment begins with the target in effect on its first day.
    const later = chartWindow([{ period: '2010-06-30', value: '0.18' }], cps, '1y');
    expect(later?.x0).toBe('2009-06-30');
    expect(later?.segments).toEqual([{ kind: 'range', points: [['2009-06-30', '0.00', '0.25'], ['2010-06-30', '0.00', '0.25']] }]);
  });
});

describe('display helpers', () => {
  it('words release dates by their basis (design 6.1) and times in UTC', () => {
    expect(releaseText('2026-11-19', 'rule')).toBe("Publication day by the New York Fed's schedule: November 19, 2026");
    expect(releaseText(null, 'not-recorded')).toBe('Release date not recorded');
    expect(releaseText('2026-11-19', 'first-seen')).toBe('First seen by RadMage Finance on November 19, 2026 (Eastern Time date)');
    expect(releaseText('2026-11-19', 'calendar')).toBe('Released on November 19, 2026');
    expect(releaseCell('2026-11-19', 'rule')).toBe('November 19, 2026');
    expect(releaseCell(null, 'not-recorded')).toBe('Not recorded');
    expect(releaseCell('2026-11-19', 'first-seen')).toBe('First seen by RadMage Finance on November 19, 2026 (Eastern Time date)');
    expect(formatUtc('2026-11-19T22:17:00Z')).toBe('November 19, 2026, 22:17 UTC');
  });

  it('says why a comparison is not shown', () => {
    expect(missingText('no-earlier', null, null)).toBe('there is no earlier EFFR observation');
    expect(missingText('before-data', '1999-11-18', '2000-07-03')).toBe('there is no EFFR observation on or before November 18, 1999 (the data begins July 3, 2000)');
    expect(missingText('outside-window', '2026-01-14', '2026-01-02')).toBe('there is no EFFR observation in the 7 days up to January 14, 2026');
  });

  it('lists CSV segments newest first with readable names (design 8.5)', () => {
    const refs = [
      { path: 'series/effr/2025/a.csv', segment: '2025', sha256: 'a', retrieved_at: 't' },
      { path: 'series/effr/2026/b.csv', segment: '2026', sha256: 'b', retrieved_at: 't' },
      { path: 'series/effr/2000/c.csv', segment: '2000', sha256: 'c', retrieved_at: 't' },
    ];
    expect(downloads('effr', refs).map((d) => d.name)).toEqual(['effr-2026.csv', 'effr-2025.csv', 'effr-2000.csv']);
    expect(segmentOf(refs, '2026-11-18')?.path).toBe('series/effr/2026/b.csv');
    expect(segmentOf([{ path: 'x.csv', segment: 'all', sha256: 'x', retrieved_at: 't' }], '2026-09-17')?.path).toBe('x.csv');
  });
});

describe('the appendix B fixture dataset (test data)', () => {
  let work = '';
  let ds: EconDataset;
  let effr: Observation[];
  let target: ChangePoint[];
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'rmf-rates-'));
    await runScenario(work);
    ds = loadEconDataset(join(work, 'live'), undefined)!;
    effr = observations(ds, 'effr');
    target = changePoints(ds);
  }, 600_000);
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('agrees with the oracle case copied from the fixture CSVs, on the whole series', () => {
    const c = (ORACLE.cases as Loose[]).find((x) => x.id === 'nyfed-fixture');
    expect(c?.complete).toBe(false);
    expect(contract(effr, target, c?.target_dates ?? [], false)).toEqual(c?.expected);
  });

  it('takes the latest EFFR and the current target from the dataset, as the manifest states them', () => {
    const s = seriesInfo(ds, 'effr');
    const latest = latestEffr(effr);
    expect(latest?.period).toBe(s.last_period);
    expect(latest?.value).toBe(s.last_value);
    const now = target.at(-1)!;
    expect(now.effective).toBe(seriesInfo(ds, 'fomc-target').last_period);
    expect(targetBounds(now)).toEqual(seriesInfo(ds, 'fomc-target').last_range);
    expect(targetAt(target, latest!.period)).toBe(now);
  });

  it('draws the EFFR as observed and the target as derived: a step line before 2008-12-16, a band from then on (decision D9)', () => {
    const all = rateChartSpec(effr, target, 'all')!;
    expect(all.lines.map((l) => [l.key, l.kind, l.shape, l.label])).toEqual([
      ['effr', 'observed', 'line', EFFR_LABEL],
      ['target-rate-1', 'derived', 'step', TARGET_RATE_LABEL],
    ]);
    expect(all.bands?.map((b) => [b.key, b.kind, b.label])).toEqual([['target-range-2', 'derived', TARGET_RANGE_LABEL]]);
    expect(all.lines[0]?.points).toHaveLength(effr.length);
    expect(all.lines[1]?.points.at(-1)).toEqual({ x: '2008-12-16', y: '1.00' });
    expect(all.bands?.[0]?.points[0]).toEqual({ x: '2008-12-16', lower: '0.00', upper: '0.25' });
    const five = rateChartSpec(effr, target, DEFAULT_RANGE)!;
    expect(five.id).toBe('rates-chart-5y');
    expect(five.lines).toHaveLength(1);
    expect(five.lines[0]?.points[0]?.x).toBe('2021-11-18');
    expect(five.bands?.[0]?.points.at(-1)).toEqual({ x: '2026-11-18', lower: '3.75', upper: '4.00' });
    for (const r of RANGES) {
      const spec = rateChartSpec(effr, target, r.id, 'rates-recent')!;
      expect(spec.tableId).toBe('rates-recent');
      expect(spec.unitLabel).toBe('Percent');
      for (const l of spec.lines) for (const p of l.points) expect(p.y === null || /^\d+\.\d{2}$/.test(p.y)).toBe(true);
    }
  });

  it('lists the last 30 business days newest first, and every change point with its change', () => {
    const recent = recentRows(effr);
    expect(recent).toHaveLength(RECENT_ROWS);
    expect(recent[0]?.obs.period).toBe('2026-11-18');
    expect(recent.map((r) => r.obs.period)).toEqual(effr.slice(-30).map((o) => o.period).reverse());
    expect(recent.find((r) => r.obs.period === '2026-11-16')?.bp).toBe('-1');
    const rows = changePointRows(target);
    expect(rows).toHaveLength(73);
    expect(rows[0]?.change).toBeNull();
    expect(rows.find((r) => r.cp.effective === '2008-12-16')?.change).toEqual({ lower: '-100', upper: '-75' });
    expect(rows.at(-1)?.change).toEqual({ lower: '25', upper: '25' });
  });

  it('finds the comparison observations on or before the same calendar date', () => {
    const cmp = effrComparisons(effr);
    expect(cmp.map((c) => [c.id, c.date, c.found?.period, c.bp])).toEqual([
      ['previous', null, '2026-11-17', '0'],
      ['month', '2026-10-18', '2026-10-16', '0'],
      ['year', '2025-11-18', '2025-11-18', cmp[2]?.bp],
      ['five-years', '2021-11-18', '2021-11-18', cmp[3]?.bp],
    ]);
    for (const c of cmp.slice(2)) expect(c.bp).toBe(bpChange(c.found!.value!, '3.88'));
    const table = comparisonTable(effr, target);
    expect(table.find((r) => r.id === 'five-years')?.targetChange).toEqual({ lower: '375', upper: '375' });
  });

  it('downloads every CSV segment of both series, newest first', () => {
    const d = downloads('effr', seriesInfo(ds, 'effr').csvs);
    expect(d).toHaveLength(seriesInfo(ds, 'effr').csvs.length);
    expect(d[0]?.name).toBe('effr-2026.csv');
    expect(d.at(-1)?.name).toBe('effr-2000.csv');
    expect(downloads('fomc-target', seriesInfo(ds, 'fomc-target').csvs).map((x) => x.name)).toEqual(['fomc-target-all.csv']);
  });
});
