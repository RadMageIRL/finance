// The National Debt Tracker's calculations (src/lib/data/debt.ts, rules D1 to D14) against the
// independent Python oracle (tests/oracle/econ_debt.py, fixture econ-debt.json), then the page
// model on the whole appendix B fixture dataset, written fresh by the fixture scenario (test data,
// never a publication).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEBT_SERIES,
  type ChangeKind,
  type DebtPage,
  type DebtRecord,
  baseDate,
  buildDebtPage,
  chartPoints,
  computeChange,
  computeChanges,
  daysBetween,
  daysInMonth,
  debtRegistry,
  easternDate,
  formatUsd,
  formatUsdSigned,
  formatUtc,
  fromCents,
  latestCommonCheck,
  missingSummary,
  partsDisagreements,
  readRegistry,
  reasonText,
  recentRows,
  releasedDate,
  releasedText,
  revisionDisplay,
  roundedUsd,
  segmentFor,
  toCents,
  twelveMonthStart,
  changeValueText,
  formulaText,
} from '../../../src/lib/data/debt';
import { observations, seriesInfo, segmentsInOrder, type EconDataset } from '../../../src/lib/data/econ';
import { loadEconDataset } from '../../../src/lib/data/econ-load';
import { formatDay } from '../../../src/lib/data/format';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
// The pipeline comes from finance-data (ECON_TOOLS) or this tree (tools/econ-tools.mjs; brief V item 3).
import { econToolsPath, importEconTool } from '../../../tools/econ-tools.mjs';
const { runScenario } = (await importEconTool('pipeline/bin/fixture-scenario.mjs')) as Loose;

type Rec = [string, string | null];
const oracle = JSON.parse(readFileSync('tests/oracle/fixtures/econ-debt.json', 'utf8')) as Loose;
const recs = (rows: Rec[]): DebtRecord[] => rows.map(([period, value]) => ({ period, value }));
const anomalyMap = (rows: [string, string][]) => new Map(rows);
const KINDS: ChangeKind[] = ['daily', 'monthly', 'yearly'];
const asOracle = (r: ReturnType<typeof computeChange>) => ({ valid: r.valid, latest: r.latest, base: r.base, comparison: r.comparison, gap_days: r.gapDays, reason: r.reason, change: r.change });

describe('the oracle fixture', () => {
  it('was written by the debt oracle from rules D1 to D14 and covers every section', () => {
    expect(oracle.generator).toBe('tests/oracle/econ_debt.py');
    for (const key of ['base_dates', 'days_between', 'amounts', 'changes', 'parts', 'missing', 'recent', 'chart']) expect(oracle[key].length, key).toBeGreaterThan(0);
  });
});

describe('dates (D4, D5)', () => {
  it('gives every base date the oracle gives, clamping the 29th to the 31st', () => {
    for (const c of oracle.base_dates) expect(baseDate(c.date, c.months), `${c.date} ${c.months}`).toBe(c.base);
    expect(baseDate('2026-03-31', 1)).toBe('2026-02-28');
    expect(baseDate('2024-03-31', 1)).toBe('2024-02-29');
    expect(baseDate('2024-02-29', 12)).toBe('2023-02-28');
    expect(baseDate('2026-01-31', 1)).toBe('2025-12-31');
  });
  it('counts calendar days between dates as the oracle does', () => {
    for (const c of oracle.days_between) expect(daysBetween(c.from, c.to), `${c.from} ${c.to}`).toBe(c.days);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
  it('throws on a date that is not YYYY-MM-DD', () => {
    expect(() => baseDate('2026-1-31', 1)).toThrow(/not a date/);
  });
});

describe('exact amounts and display (D1, D8, D9, D10)', () => {
  it('formats every amount exactly, signed and rounded for display as the oracle does', () => {
    for (const a of oracle.amounts) {
      expect(formatUsd(a.value), a.value).toBe(a.exact);
      expect(formatUsdSigned(a.value), a.value).toBe(a.exact_signed);
      expect(roundedUsd(a.value), a.value).toBe(a.rounded);
      expect(roundedUsd(a.value, true), a.value).toBe(a.rounded_signed);
    }
  });
  it('keeps cents exact through BigInt and throws on a value without two decimals', () => {
    expect(fromCents(toCents('40626506856903.25') - toCents('40624506856903.25'))).toBe('2000000000.00');
    expect(fromCents(toCents('0.05') - toCents('0.08'))).toBe('-0.03');
    expect(fromCents(0n)).toBe('0.00');
    expect(() => toCents('12.5')).toThrow(/two decimals/);
    expect(() => toCents('1e3')).toThrow(/two decimals/);
    expect(() => toCents('')).toThrow(/two decimals/);
  });
});

describe('changes (D2 to D8)', () => {
  it('gives every daily, monthly and yearly result of every oracle case', () => {
    for (const c of oracle.changes) {
      for (const kind of KINDS) expect(asOracle(computeChange(recs(c.records), kind, anomalyMap(c.anomalies), c.max_gap_days)), `${c.id} ${kind}`).toEqual(c[kind]);
    }
  });
  it('covers every reason code at least once in the oracle cases', () => {
    const reasons = new Set(oracle.changes.flatMap((c: Loose) => KINDS.map((k) => c[k].reason)));
    for (const r of ['no-latest', 'no-comparison', 'not-published', 'gap', 'anomaly-latest', 'anomaly-comparison', null]) expect(reasons.has(r), String(r)).toBe(true);
  });
  it('words each reason, with the dates, the gap and the registry text', () => {
    const anomalies = new Map([['2025-08-04', 'The published parts exceed the published total by $10,000,000,000.00.']]);
    const at = (rows: Rec[], kind: ChangeKind, gap = 6) => computeChange(recs(rows), kind, anomalies, gap);
    expect(reasonText(at([['2026-01-02', null]], 'daily'), anomalies, 6)).toBe('The series has no published value.');
    expect(reasonText(at([['2026-01-02', '1.00']], 'daily'), anomalies, 6)).toBe('There is no earlier record.');
    expect(reasonText(at([['2026-01-02', '1.00']], 'monthly'), anomalies, 6)).toBe('There is no record on or before December 2, 2025.');
    expect(reasonText(at([['2026-01-01', null], ['2026-01-02', '1.00']], 'daily'), anomalies, 6)).toBe('The comparison record of January 1, 2026 has no published value.');
    expect(reasonText(at([['2025-12-01', '1.00'], ['2026-01-02', '1.00']], 'daily'), anomalies, 6)).toBe('The previous record, December 1, 2025, is 32 days before the latest, more than the 6-day limit.');
    expect(reasonText(at([['2025-11-20', '1.00'], ['2026-01-02', '1.00']], 'monthly'), anomalies, 6)).toBe('The latest record on or before December 2, 2025 is November 20, 2025, 12 days earlier, more than the 6-day limit.');
    expect(reasonText(at([['2025-08-01', '1.00'], ['2025-08-04', '2.00']], 'daily'), anomalies, 6)).toBe('The latest record, August 4, 2025, is a known inconsistency in the source: The published parts exceed the published total by $10,000,000,000.00.');
    expect(reasonText(at([['2025-08-04', '1.00'], ['2025-08-05', '2.00']], 'daily'), anomalies, 6)).toBe('The comparison record, August 4, 2025, is a known inconsistency in the source: The published parts exceed the published total by $10,000,000,000.00.');
    expect(reasonText(at([['2025-08-05', '1.00'], ['2025-08-06', '2.00']], 'daily'), anomalies, 6)).toBeNull();
  });
  it('labels a valid change with its formula, dates and values, and an invalid one with the rule', () => {
    const valid = computeChange(recs([['2026-11-20', '40624506856903.25'], ['2026-11-23', '40626506856903.25']]), 'daily', new Map(), 6);
    expect(changeValueText(valid)).toBe('+$2,000,000,000.00 (+$2.00 billion, rounded for display)');
    expect(formulaText(valid, 'debt-total')).toBe('The total on November 23, 2026 ($40,626,506,856,903.25) minus the total on November 20, 2026 ($40,624,506,856,903.25), the previous record date.');
    const monthly = computeChange(recs([['2026-10-23', '10.00'], ['2026-11-23', '10.50']]), 'monthly', new Map(), 6);
    expect(changeValueText(monthly)).toBe('+$0.50');
    expect(formulaText(monthly, 'debt-held-public')).toBe('Debt held by the public on November 23, 2026 ($10.50) minus debt held by the public on October 23, 2026 ($10.00), the latest record on or before October 23, 2026.');
    const invalid = computeChange(recs([['2026-11-23', '1.00']]), 'yearly', new Map(), 6);
    expect(changeValueText(invalid)).toBe('');
    expect(formulaText(invalid, 'debt-intragov')).toBe('Intragovernmental holdings on the latest record date minus intragovernmental holdings on the latest record on or before the same day one year earlier.');
  });
});

describe('parts against the total (D11)', () => {
  it('lists every disagreement of every oracle case, with the registry note or none', () => {
    for (const c of oracle.parts) expect(partsDisagreements(recs(c.total), recs(c.held), recs(c.intragov), anomalyMap(c.anomalies)), c.id).toEqual(c.expected);
  });
  it('checks the latest date with all three values without replacing the total', () => {
    const check = latestCommonCheck(recs([['2026-11-12', '10.00'], ['2026-11-13', '10.00'], ['2026-11-16', '11.00']]), recs([['2026-11-12', '6.00'], ['2026-11-13', '6.00'], ['2026-11-16', '7.00']]), recs([['2026-11-12', '4.00'], ['2026-11-13', '4.03']]));
    expect(check).toEqual({ period: '2026-11-13', total: '10.00', held: '6.00', intragov: '4.03', difference: '0.03' });
    expect(latestCommonCheck(recs([['2026-11-12', '10.00']]), recs([['2026-11-12', null]]), recs([['2026-11-12', '4.00']]))).toBeNull();
  });
});

describe('missing values, recent records and chart points (D12, D13, D14)', () => {
  it('summarizes missing values as the oracle does', () => {
    for (const c of oracle.missing) {
      const s = missingSummary(recs(c.records));
      expect({ first_published: s.firstPublished, not_published: s.notPublished, last_not_published: s.lastNotPublished, daily_from: s.dailyFrom }, c.id).toEqual(c.expected);
    }
  });
  it('gives the recent rows newest first with each part published, not published or without a record', () => {
    for (const c of oracle.recent) expect(recentRows(recs(c.total), recs(c.held), recs(c.intragov), c.n), c.id).toEqual(c.expected);
  });
  it('gives the chart points with gaps at documented gap dates and nothing else filled in', () => {
    for (const c of oracle.chart) {
      const records = recs(c.records);
      const start = c.window === 'twelve-months' ? twelveMonthStart(records) : null;
      expect(start, c.id).toBe(c.window_start);
      expect(chartPoints(records, c.known_gaps, start).map((p) => [p.x, p.y]), c.id).toEqual(c.expected);
    }
    expect(chartPoints(recs([['2026-01-02', null]]), [])).toEqual([]);
    expect(twelveMonthStart(recs([['2026-01-02', null]]))).toBeNull();
  });
});

describe('wording helpers', () => {
  it('words the release basis, UTC times and Eastern dates', () => {
    expect(releasedText({ released: '2026-11-24', releasedBasis: 'first-seen' })).toBe('First seen by RadMage Finance on November 24, 2026 (Eastern Time date)');
    expect(releasedText({ released: null, releasedBasis: 'not-recorded' })).toBe('Release date not recorded');
    expect(releasedText({ released: '2026-11-24', releasedBasis: 'calendar' })).toBe('Released November 24, 2026');
    expect(releasedDate({ released: '2026-11-24', releasedBasis: 'first-seen' })).toBe('November 24, 2026');
    expect(releasedDate({ released: null, releasedBasis: 'not-recorded' })).toBe('Not recorded');
    expect(formatUtc('2026-11-24T22:17:00Z')).toBe('November 24, 2026, 22:17 UTC');
    expect(() => formatUtc('2026-11-24 22:17')).toThrow(/UTC time/);
    expect(easternDate('2026-11-17T03:00:00Z')).toBe('2026-11-16');
    expect(easternDate('2026-11-17T05:00:00Z')).toBe('2026-11-17');
    expect(easternDate('2026-07-01T03:59:59Z')).toBe('2026-06-30');
    expect(easternDate('2026-07-01T04:00:00Z')).toBe('2026-07-01');
    expect(() => easternDate('2026-07-01')).toThrow(/UTC time/);
  });
  it('finds the segment of a record date and words a revision row', () => {
    const csvs = [{ path: 'a', segment: '2025', sha256: '', retrieved_at: '' }, { path: 'b', segment: '2026', sha256: '', retrieved_at: '' }];
    expect(segmentFor('2026-03-02', csvs)?.path).toBe('b');
    expect(segmentFor('2024-03-02', csvs)).toBeNull();
    expect(segmentFor('2024-03-02', [{ path: 'c', segment: 'all', sha256: '', retrieved_at: '' }])?.path).toBe('c');
    expect(revisionDisplay({ detectedAt: '2026-11-17T03:00:00Z', snapshot: 's', period: '2019-12-31', field: 'value', before: '23201380134806.73', after: '23201380134807.73', kind: 'approved-hold', basis: 'approved in review run r on 2026-11-16', releaseDate: null })).toEqual({
      detected: 'November 16, 2026',
      period: 'December 31, 2019',
      field: 'value',
      before: '$23,201,380,134,806.73',
      after: '$23,201,380,134,807.73',
      kind: 'Approved after review',
      basis: 'approved in review run r on 2026-11-16',
      release: 'Not recorded',
    });
    expect(revisionDisplay({ detectedAt: '2026-11-17T15:00:00Z', snapshot: 's', period: '2026-11-10', field: 'period', before: '{"period":"2026-11-10"}', after: '', kind: 'rollback', basis: 'b', releaseDate: '2026-11-11' })).toMatchObject({ before: '{"period":"2026-11-10"}', after: 'None', kind: 'Rollback', release: 'November 11, 2026' });
  });
  it('throws on a registry without a continuity limit in days, and joins anomaly texts across the three series', () => {
    const entry = (id: string, extra: Loose = {}) => ({ id, continuity: { max_gap: 6, unit: 'days' }, ...extra });
    expect(() => debtRegistry({ series: [entry('debt-total'), entry('debt-held-public')] })).toThrow(/no series debt-intragov/);
    expect(() => debtRegistry({ series: [entry('debt-total', { continuity: { max_gap: 6, unit: 'business-days' } }), entry('debt-held-public'), entry('debt-intragov')] })).toThrow(/continuity/);
    const reg = debtRegistry({
      series: [entry('debt-total', { known_inconsistencies: [{ period: '2011-02-01', text: 'A.' }] }), entry('debt-held-public', { known_inconsistencies: [{ period: '2011-02-01', text: 'A.' }, { period: '2012-01-03', text: 'B.' }] }), entry('debt-intragov', { known_inconsistencies: [{ period: '2011-02-01', text: 'C.' }] })],
    });
    expect([...reg.anomalies.entries()]).toEqual([['2011-02-01', 'A. C.'], ['2012-01-03', 'B.']]);
    expect(reg.series['debt-intragov'].maxGapDays).toBe(6);
  });
});

// The whole fixture dataset (appendix B): the page model the build renders.
let work = '';
let ds: EconDataset;
let page: DebtPage;
const link = (p: string) => `/finance/data/econ/${p}`;
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'rmf-debt-'));
  await runScenario(work);
  ds = loadEconDataset(join(work, 'live'), undefined) as EconDataset;
  page = buildDebtPage(ds, link) as DebtPage;
}, 600_000);
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('the page model on the fixture dataset', () => {
  it('reads the anomalies, gaps and limit from the registry copy, which agrees with pipeline/registry/econ.json', () => {
    const pipeline = JSON.parse(readFileSync(econToolsPath('pipeline', 'registry', 'econ.json'), 'utf8')) as Loose;
    const copy = JSON.parse(ds.readText((ds.manifest.rules as Loose).registry.path)) as Loose;
    for (const id of DEBT_SERIES) {
      const a = pipeline.series.find((s: Loose) => s.id === id);
      const b = copy.series.find((s: Loose) => s.id === id);
      for (const key of ['known_inconsistencies', 'known_gaps', 'continuity', 'title']) expect(b[key], `${id} ${key}`).toEqual(a[key]);
    }
    const reg = readRegistry(ds);
    expect([...reg.anomalies.keys()]).toEqual(pipeline.series.find((s: Loose) => s.id === 'debt-total').known_inconsistencies.map((n: Loose) => n.period));
    expect(page.maxGapDays).toBe(pipeline.series.find((s: Loose) => s.id === 'debt-total').continuity.max_gap);
  });

  it('shows the latest total exactly as the manifest gives it, with its record date and dates', () => {
    const s = seriesInfo(ds, 'debt-total');
    expect(page.headline.value).toBe(formatUsd(s.last_value as string));
    expect(page.headline.period).toBe(`Record date ${formatDay(s.last_period as string)}`);
    expect(page.headline.period).toBe(`Record date November 23, 2026`);
    expect(page.headline.details?.[0]).toBe(`${roundedUsd(s.last_value as string)}, rounded for display.`);
    expect(page.headline.details).toContain('First seen by RadMage Finance on November 24, 2026 (Eastern Time date).');
    expect(page.coverage).toEqual({ first: observations(ds, 'debt-total')[0]?.period, last: s.last_period });
  });

  it('gives the same latest changes on the whole series as the oracle on its copied rows', () => {
    const anomalies = readRegistry(ds).anomalies;
    for (const id of DEBT_SERIES) {
      const c = oracle.changes.find((x: Loose) => x.id === `fixture-latest-${id}`);
      expect(c, id).toBeDefined();
      const got = computeChanges(observations(ds, id), anomalies, 6);
      for (const kind of KINDS) expect(asOracle(got[kind]), `${id} ${kind}`).toEqual(c[kind]);
    }
    for (const kind of KINDS) expect(asOracle(page.totalChanges[kind])).toEqual(oracle.changes.find((x: Loose) => x.id === 'fixture-latest-debt-total')[kind]);
    expect(page.totalFigures.map((f) => f.label)).toEqual(['Daily change', 'Monthly change', 'Yearly change']);
    for (const f of page.totalFigures) expect(f.formula.startsWith('The total on November 23, 2026 ($40,626,506,856,903.25) minus the total on ')).toBe(true);
  });

  it('lists the dates where the published parts and total differ, registry dates with their note and others as found', () => {
    const fixtureCase = oracle.parts.find((x: Loose) => x.id.startsWith('fixture-'));
    expect(fixtureCase).toBeDefined();
    const inRanges = new Set(fixtureCase.total.map((r: Rec) => r[0]));
    expect(page.disagreements.filter((d) => inRanges.has(d.period))).toEqual(fixtureCase.expected);
    const registered = readRegistry(ds).anomalies;
    for (const [period, text] of registered) expect(page.disagreements.find((d) => d.period === period)?.note).toBe(text);
    expect(page.disagreements.filter((d) => d.note === null).length).toBeGreaterThan(0);
    expect(page.disagreementsTable.rows.length).toBe(page.disagreements.length);
    expect(page.disagreementsTable.rows.every((r) => /^[+-]?\$[\d,]+\.\d{2}$/.test(r.difference ?? ''))).toBe(true);
    // The headline never comes from the parts: it is the published total of its date.
    const total = observations(ds, 'debt-total');
    expect(page.headline.value).toBe(formatUsd(total[total.length - 1]?.value as string));
  });

  it('shows the last 30 record dates of all three series as the oracle does', () => {
    const c = oracle.recent.find((x: Loose) => x.id.startsWith('fixture-'));
    expect(c).toBeDefined();
    const expected = (c.expected as Loose[]).map((r) => [r.period, r.total, r.held.state, r.intragov.state]);
    const got = recentRows(observations(ds, 'debt-total'), observations(ds, 'debt-held-public'), observations(ds, 'debt-intragov'), 30).map((r) => [r.period, r.total, r.held.state, r.intragov.state]);
    expect(got).toEqual(expected);
    expect(page.recentTable.rows).toHaveLength(30);
    expect(page.recentTable.rows[0]?.period).toBe('November 23, 2026');
    expect(page.recentTable.rows.some((r) => r.intragov === 'No record')).toBe(true);
    expect(page.recentTable.rows.find((r) => r.period === 'November 10, 2026')?.notes).toMatch(/differ by -\$6,000,000\.00 .*changed between our collections/);
  });

  it('labels the first-seen and detection dates of the recent table as Eastern Time dates', () => {
    expect(page.recentTable.columns.find((c) => c.key === 'released')?.label).toBe('Total first seen by RadMage Finance (Eastern Time date)');
    expect(page.recentTable.rows.find((r) => r.period === 'November 10, 2026')?.notes).toMatch(/changed between our collections \(detected [A-Z][a-z]+ \d{1,2}, \d{4}, Eastern Time date\); see Changes we observed\./);
  });

  it('draws the total from its first record and the parts from their first published value, breaking at documented gaps, never at zero', () => {
    const reg = readRegistry(ds);
    const total = observations(ds, 'debt-total');
    const pts = page.charts.total.lines[0]?.points ?? [];
    const gapsInside = reg.series['debt-total'].knownGaps.filter((g) => g.period > (total[0]?.period ?? '') && g.period < (total.at(-1)?.period ?? ''));
    expect(pts.length).toBe(total.length + gapsInside.length);
    expect(pts.find((p) => p.x === '2019-04-03')).toEqual({ x: '2019-04-03', y: null });
    expect(pts.some((p) => p.y !== null && toCents(p.y) === 0n)).toBe(false);
    const [heldLine, intragovLine] = page.charts.parts.lines;
    expect(heldLine?.points[0]).toEqual({ x: '1997-09-30', y: '3789667546849.60' });
    expect(intragovLine?.points[0]?.x).toBe('1997-09-30');
    expect(page.charts.parts.lines.map((l) => l.kind)).toEqual(['observed', 'observed']);
    expect(page.charts.parts.notes?.[0]).toMatch(/not stacked/);
    expect(page.charts.total.notes?.some((n) => n.startsWith('August 4, 2025: The published parts exceed the published total by $10,000,000,000.00.'))).toBe(true);
    const year = page.charts.totalYear.lines[0]?.points ?? [];
    expect(year[0]?.x).toBe('2025-11-24');
    expect(year.at(-1)).toEqual({ x: '2026-11-23', y: '40626506856903.25' });
  });

  it('counts the record dates without published parts from the data', () => {
    expect(missingSummary(observations(ds, 'debt-held-public'))).toEqual({ firstPublished: '1997-09-30', notPublished: 2958, lastNotPublished: '2005-03-30', dailyFrom: '2005-03-31' });
    expect(page.missingText).toEqual(['Debt held by the public and intragovernmental holdings: no published value on 2,958 record dates, the last of them March 30, 2005. The first published value is for September 30, 1997, and every record from March 31, 2005 on has a value.']);
  });

  it('notes the part whose latest record date is earlier than the total and checks the parts on the latest common date', () => {
    expect(page.partLagNotes).toEqual(["The latest record of intragovernmental holdings is for November 13, 2026, earlier than the total's November 23, 2026. Its status line says why."]);
    expect(page.latestCheck?.label).toBe('Parts against the total on November 13, 2026, the latest record date with all three values');
    expect(page.latestCheck?.value).toBe('The published parts add up exactly to the published total.');
  });

  it('links every CSV segment newest first, and the revision log as CSV and JSON', () => {
    for (const d of page.downloads) {
      const segs = segmentsInOrder(seriesInfo(ds, d.id).csvs);
      expect(d.links.map((l) => l.href)).toEqual([...segs].reverse().map((s) => link(s.path)));
      expect(d.links[0]?.download).toBe(`${d.id}-2026.csv`);
      expect(d.links.at(-1)?.label).toBe('1993 (CSV)');
    }
    const totalRevisions = page.revisions.find((r) => r.id === 'debt-total');
    expect(totalRevisions?.table?.rows.map((r) => r.period)).toEqual(['December 31, 2019', 'November 10, 2026']);
    expect(totalRevisions?.links.map((l) => l.label)).toEqual(['2026 (CSV)', '2026 (JSON)']);
    expect(page.revisions.find((r) => r.id === 'debt-intragov')?.table).toBeNull();
  });

  it('gives the gap and inconsistency tables from the registry', () => {
    const reg = readRegistry(ds);
    expect(page.gapsTable.rows).toHaveLength(reg.series['debt-total'].knownGaps.length);
    expect(page.gapsTable.rows.every((r) => r.series === 'All three')).toBe(true);
    expect(page.inconsistenciesTable.rows.map((r) => r.period)).toEqual(['February 1, 2011', 'August 4, 2025']);
    expect(page.inconsistenciesTable.rows[1]?.total).toBe('$36,828,164,797,914.31');
  });

  it('has no page model for a dataset without a published total', () => {
    const empty: EconDataset = { source: 'fixture', manifest: { ...ds.manifest, series: Object.fromEntries(Object.entries(ds.manifest.series).map(([k, v]) => [k, { ...v, csvs: [] }])) }, readText: (p) => ds.readText(p) };
    expect(buildDebtPage(empty, link)).toBeNull();
  });
});
