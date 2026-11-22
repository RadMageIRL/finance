// The Money Supply Tracker rules (src/lib/data/money.ts M1 to M17) against the independent
// Python oracle (tests/oracle/econ_money.py, written from the rules alone), and on the full
// appendix B fixture dataset written fresh by the fixture scenario (test data, never a
// publication).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { observations, revisionRows, seriesInfo, type EconDataset, type RevisionRow } from '../../../src/lib/data/econ';
import { loadEconDataset } from '../../../src/lib/data/econ-load';
import {
  H6_BREAKS,
  MONEY_SERIES,
  MONEY_SOURCES,
  breaksFor,
  comparisonRows,
  computeChange,
  currentMonth,
  definitionLines,
  dollarChange,
  dollarsCell,
  dollarsText,
  etDate,
  formatUtc,
  isMissing,
  levelCell,
  levelText,
  measureOf,
  measureView,
  missingText,
  monthsBefore,
  percentCell,
  percentChange,
  percentText,
  recentRows,
  registryCopy,
  registryNotes,
  releasedText,
  revisionDisplay,
  revisionWindow,
  sourceNumber,
  type ChangeResult,
  type Measure,
  type MonthRow,
} from '../../../src/lib/data/money';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
// The pipeline comes from finance-data (ECON_TOOLS) or this tree (tools/econ-tools.mjs; brief V item 3).
import { importEconTool } from '../../../tools/econ-tools.mjs';
const { runScenario } = (await importEconTool('pipeline/bin/fixture-scenario.mjs')) as Loose;

const ORACLE: Loose = JSON.parse(readFileSync('tests/oracle/fixtures/econ-money.json', 'utf8'));

interface OracleRow {
  period: string;
  value: string | null;
  missing_code: string | null;
  released: string | null;
  released_basis: string;
}

const toRow = (r: OracleRow): MonthRow => ({ period: r.period, value: r.value, missingCode: r.missing_code, released: r.released, releasedBasis: r.released_basis });

/** The oracle's snake_case change result in this module's shape. */
function expected(r: Loose): ChangeResult {
  if (r.ok) {
    return {
      ok: true,
      from: r.from,
      to: r.to,
      dollars: r.dollars,
      dollarsText: r.dollars_text,
      dollarsCell: r.dollars_cell,
      percent: r.percent,
      percentText: r.percent_text,
      percentCell: r.percent_cell,
      percentReason: r.percent_reason,
      percentReasonText: r.percent_reason_text,
      direction: r.direction,
      tag: r.tag,
      sentence: r.sentence,
    };
  }
  return { ok: false, from: r.from, to: r.to, reason: r.reason, reasonText: r.reason_text, cell: r.cell };
}

let work = '';
let ds: EconDataset;
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'rmf-money-'));
  await runScenario(work);
  const loaded = loadEconDataset(join(work, 'live'), undefined);
  if (!loaded) throw new Error('the fixture dataset did not load');
  ds = loaded;
}, 600_000);
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('the oracle file', () => {
  it('names its generator and holds every kind of case', () => {
    expect(ORACLE.generator).toBe('tests/oracle/econ_money.py');
    for (const key of ['months_before', 'diff', 'percent', 'et_date', 'series']) expect(ORACLE[key].length, key).toBeGreaterThan(5);
    for (const key of ['level', 'dollars', 'percent', 'missing', 'released']) expect(ORACLE.display[key].length, key).toBeGreaterThan(3);
    const names = ORACLE.series.map((s: Loose) => s.name);
    for (const id of ['m1-sa', 'm2-sa', 'm1-nsa', 'm2-nsa']) expect(names).toContain(`fixture-${id}`);
  });
});

describe('exact arithmetic and months (M2, M8, M9), against the oracle', () => {
  it('counts calendar months back', () => {
    for (const c of ORACLE.months_before) expect(monthsBefore(c.period, c.months), `${c.period} minus ${c.months}`).toBe(c.result);
  });
  it('subtracts exactly at the longer number of decimal places', () => {
    for (const c of ORACLE.diff) expect(dollarChange(c.later, c.earlier), `${c.later} minus ${c.earlier}`).toBe(c.dollars);
  });
  it('rounds the percent change half away from zero, and gives none for an earlier value not above zero', () => {
    for (const c of ORACLE.percent) expect(percentChange(c.later, c.earlier), `${c.later} against ${c.earlier}`).toBe(c.percent);
  });
});

describe('display (M4, M10, M13, M16), against the oracle', () => {
  it('formats levels, changes and percents with their signs', () => {
    for (const c of ORACLE.display.level) {
      expect(levelText(c.value)).toBe(c.text);
      expect(levelCell(c.value)).toBe(c.cell);
    }
    for (const c of ORACLE.display.dollars) {
      expect(dollarsText(c.dollars)).toBe(c.text);
      expect(dollarsCell(c.dollars)).toBe(c.cell);
    }
    for (const c of ORACLE.display.percent) {
      expect(percentText(c.percent)).toBe(c.text);
      expect(percentCell(c.percent)).toBe(c.cell);
    }
  });
  it('words missing values with their codes, never as zero', () => {
    for (const c of ORACLE.display.missing) {
      expect(isMissing({ value: c.value, missingCode: c.missing_code })).toBe(true);
      expect(missingText(c.missing_code), JSON.stringify(c)).toBe(c.text);
    }
  });
  it('words release dates by their basis', () => {
    for (const c of ORACLE.display.released) expect(releasedText(c.released, c.released_basis), JSON.stringify(c)).toBe(c.text);
  });
  it('dates detections in Eastern time across both daylight saving changes', () => {
    for (const c of ORACLE.et_date) expect(etDate(c.utc), c.utc).toBe(c.date);
  });
});

describe('series rules (M5 to M7, M11, M12, M14, M15), against the oracle', () => {
  for (const s of ORACLE.series as Loose[]) {
    it(`${s.name}: current month, revision window, changes and both tables`, () => {
      const rows = (s.rows as OracleRow[]).map(toRow);
      const measure = s.measure as Measure;
      expect(measureOf(s.series_id)).toBe(measure);
      expect(breaksFor(s.series_id)).toEqual(s.breaks);
      const current = currentMonth(rows);
      expect(current === null ? null : { period: current.period, value: current.value, missing_code: current.missingCode, text: current.text }).toEqual(s.current);
      expect(revisionWindow(rows)).toEqual(s.revision_window);
      for (const c of s.changes as Loose[]) expect(computeChange(rows, c.to, c.months, measure, s.breaks), `${c.to} minus ${c.months}`).toEqual(expected(c.result));
      expect(recentRows(rows, measure, s.breaks)).toEqual(s.recent);
      expect(comparisonRows(rows, measure, s.breaks)).toEqual(s.comparisons);
    });
  }
});

describe('the oracle copies the fixture rows exactly', () => {
  it('every embedded fixture row equals the dataset row of that month', () => {
    for (const id of ['m1-sa', 'm2-sa', 'm1-nsa', 'm2-nsa']) {
      const s = (ORACLE.series as Loose[]).find((x) => x.name === `fixture-${id}`)!;
      const live = new Map(observations(ds, id).map((o) => [o.period, o]));
      expect(s.rows.length).toBeGreaterThan(100);
      for (const r of s.rows as OracleRow[]) {
        const o = live.get(r.period);
        expect(o, `${id} ${r.period}`).toBeDefined();
        expect({ period: o!.period, value: o!.value, missing_code: o!.missingCode, released: o!.released, released_basis: o!.releasedBasis }).toEqual(r);
      }
      expect(s.rows.at(-1).period).toBe(seriesInfo(ds, id).last_period);
    }
  });
});

describe('specific rules', () => {
  const row = (period: string, value: string | null, missingCode: string | null = null): MonthRow => ({ period, value, missingCode });

  it('checks the reasons in order: later month first, then the earlier month, then the break', () => {
    const rows = [row('2020-04', null, 'NA'), row('2020-05', '16000.0')];
    expect(computeChange(rows, '2020-05', 1, 'M1', ['2020-05'])).toMatchObject({ ok: false, reason: 'earlier-missing', reasonText: 'April 2020 has no published value: Not available (NA).' });
    expect(computeChange([row('2020-05', '16000.0', 'NC')], '2020-05', 1, 'M1', ['2020-05'])).toMatchObject({ ok: false, reason: 'later-missing', cell: 'Not computed (missing month)' });
    expect(computeChange([row('2020-04', '4800.0'), row('2020-05', '16000.0')], '2020-05', 1, 'M1', ['2020-05'])).toMatchObject({
      ok: false,
      reason: 'break',
      reasonText: 'The H.6 definition of M1 changed in May 2020, so April 2020 and May 2020 are not comparable.',
      cell: 'Not computed (definition change)',
    });
    expect(computeChange([row('2020-05', '16000.0')], '2020-05', 1, 'M1', [])).toMatchObject({ ok: false, reason: 'earlier-absent', reasonText: 'There is no observation for April 2020. The data start in May 2020.' });
    expect(computeChange([row('2020-01', '1.0'), row('2020-05', '16000.0')], '2020-05', 1, 'M1', [])).toMatchObject({ ok: false, reason: 'earlier-absent', reasonText: 'There is no observation for April 2020.' });
    expect(computeChange([row('2020-04', '1.0')], '2020-05', 1, 'M1', [])).toMatchObject({ ok: false, reason: 'later-absent', cell: 'Not computed (no observation)' });
  });

  it('treats the break month itself as the first month of the new definition', () => {
    const rows = [row('2020-04', '4800.0'), row('2020-05', '16000.0'), row('2020-06', '16100.0'), row('2021-04', '18000.0'), row('2021-05', '18100.0')];
    expect(computeChange(rows, '2020-06', 1, 'M1', ['2020-05'])).toMatchObject({ ok: true, dollars: '100.0', direction: 'grew' });
    expect(computeChange(rows, '2021-04', 12, 'M1', ['2020-05'])).toMatchObject({ ok: false, reason: 'break' });
    expect(computeChange(rows, '2021-05', 12, 'M1', ['2020-05'])).toMatchObject({ ok: true, dollars: '2100.0', percent: '13.13' });
  });

  it('takes the direction from the exact change, not the rounded percent', () => {
    const c = computeChange([row('2026-01', '2000000.0'), row('2026-02', '1999999.9')], '2026-02', 1, 'M2', []);
    expect(c).toMatchObject({ ok: true, dollars: '-0.1', percent: '0.00', percentCell: '0.00', direction: 'shrank', tag: 'Shrank', sentence: 'The M2 money stock shrank from January 2026 to February 2026.' });
    expect(computeChange([row('2026-01', '5.0'), row('2026-02', '5.0')], '2026-02', 1, 'M2', [])).toMatchObject({ dollars: '0.0', dollarsText: '$0.0 billion', direction: 'unchanged', sentence: 'The M2 money stock was unchanged from January 2026 to February 2026.' });
  });

  it('shows the dollars but no percent when the earlier value is zero', () => {
    expect(computeChange([row('2026-01', '0.0'), row('2026-02', '5.0')], '2026-02', 1, 'M2', [])).toMatchObject({
      ok: true,
      dollarsText: '+$5.0 billion',
      percent: null,
      percentText: null,
      percentCell: 'Not computed (earlier value not above zero)',
      percentReason: 'earlier-not-positive',
      percentReasonText: 'The earlier value is not above zero, so no percent change is computed.',
    });
  });

  it('rounds exact ties at the second decimal away from zero in both directions', () => {
    expect(percentChange('801.0', '800.0')).toBe('0.13');
    expect(percentChange('799.0', '800.0')).toBe('-0.13');
    expect(percentChange('800.9', '800.0')).toBe('0.11');
    expect(percentChange('1000.1', '1000.0')).toBe('0.01');
    expect(percentChange('999.9', '1000.0')).toBe('-0.01');
    expect(percentChange('5.0', '-1.0')).toBeNull();
  });

  it('keeps the trailing zeros of the published decimals and never writes negative zero', () => {
    expect(dollarChange('18000.0', '17900.0')).toBe('100.0');
    expect(dollarChange('100', '99.95')).toBe('0.05');
    expect(dollarChange('7.5', '7.5')).toBe('0.0');
    expect(dollarsCell('-0.0')).toBe('0.0');
    expect(dollarsText('-1191.3')).toBe('-$1,191.3 billion');
  });

  it('marks the latest two rows and the first month of a new definition in the recent table', () => {
    const rows = [row('2020-03', '4300.0'), row('2020-04', '4800.0'), row('2020-05', '16000.0')];
    const recent = recentRows(rows, 'M1', ['2020-05']);
    expect(recent.map((r) => r.month)).toEqual(['May 2020 (subject to revision) (first month of a new definition)', 'April 2020 (subject to revision)', 'March 2020']);
    expect(recent[0]).toMatchObject({ change: 'Not computed (definition change)', percent: 'Not computed (definition change)', released: 'Release date not recorded' });
    expect(recentRows(rows, 'M1', ['2020-05'], 2)).toHaveLength(2);
  });

  it('words a UTC time and refuses anything else', () => {
    expect(formatUtc('2026-11-25T15:17:00Z')).toBe('November 25, 2026, 15:17 UTC');
    expect(() => formatUtc('2026-11-25')).toThrow(/UTC/);
    expect(() => etDate('2026-11-25 15:17')).toThrow(/UTC/);
    expect(() => monthsBefore('2026-13', 1)).toThrow(/monthsBefore/);
    expect(() => dollarChange('1,000.0', '1.0')).toThrow(/decimal/);
  });

  it('numbers its sources from 1 and states the May 2020 break for M1 only', () => {
    expect(sourceNumber(MONEY_SOURCES[0]!.id)).toBe(1);
    expect(sourceNumber('h6-qa')).toBe(3);
    expect(() => sourceNumber('nope')).toThrow(/unknown source/);
    expect(H6_BREAKS.map((b) => [b.measure, b.period, [...b.series]])).toEqual([['M1', '2020-05', ['m1-sa', 'm1-nsa']]]);
    expect(breaksFor('m2-sa')).toEqual([]);
    expect(() => measureOf('effr')).toThrow(/H\.6/);
  });

  it('words revision rows: removed months, kinds and Eastern dates', () => {
    const rows: RevisionRow[] = [
      { detectedAt: '2026-11-24T03:30:00Z', snapshot: 's', period: '2026-09', field: 'value', before: '20061.2', after: '21264.9', kind: 'expected', basis: 'H.6 release 2026-11-24', releaseDate: '2026-11-24' },
      { detectedAt: '2026-11-24T20:00:00Z', snapshot: 's', period: '2026-10', field: 'period', before: '{"flags":[],"period":"2026-10","value":"20073.6"}', after: '', kind: 'rollback', basis: 'b', releaseDate: null },
      { detectedAt: '2026-11-24T20:00:00Z', snapshot: 's', period: '2026-10', field: 'flags', before: '[]', after: '["r"]', kind: 'approved-hold', basis: 'b', releaseDate: null },
      { detectedAt: '2026-11-24T20:00:00Z', snapshot: 's', period: '2026-10', field: 'period', before: 'not json', after: '', kind: 'other', basis: 'b', releaseDate: null },
    ];
    expect(revisionDisplay(rows)).toEqual([
      { detected: 'November 23, 2026', month: 'September 2026', field: 'Value', before: '20,061.2', after: '21,264.9', kind: 'Expected', basis: 'H.6 release 2026-11-24', releaseDate: 'November 24, 2026' },
      { detected: 'November 24, 2026', month: 'October 2026', field: 'Whole month', before: 'Month with value 20,073.6', after: 'None', kind: 'Rollback', basis: 'b', releaseDate: 'None' },
      { detected: 'November 24, 2026', month: 'October 2026', field: 'flags', before: '[]', after: '["r"]', kind: 'Approved after review', basis: 'b', releaseDate: 'None' },
      { detected: 'November 24, 2026', month: 'October 2026', field: 'Whole month', before: 'not json', after: 'None', kind: 'other', basis: 'b', releaseDate: 'None' },
    ]);
  });
});

describe('the full fixture dataset', () => {
  const ids = [MONEY_SERIES.sa.m1, MONEY_SERIES.sa.m2, MONEY_SERIES.nsa.m1, MONEY_SERIES.nsa.m2];

  it('computes every series view from the published strings', () => {
    for (const id of ids) {
      const v = measureView(ds, id);
      const info = seriesInfo(ds, id);
      expect(v.rows[0]?.period).toBe('1959-01');
      expect(v.current?.period).toBe(info.last_period);
      expect(v.current?.value).toBe(info.last_value);
      expect(v.current?.text).toBe(levelText(info.last_value!));
      expect(v.recent).toHaveLength(24);
      expect(v.recent[0]?.period).toBe(info.last_period);
      expect(v.recent.map((r) => r.period)).toEqual(v.rows.slice(-24).map((r) => r.period).reverse());
      expect(v.revisionWindow).toEqual(v.rows.slice(-2).map((r) => r.period));
      expect(v.recent.slice(0, 2).every((r) => r.month.endsWith('(subject to revision)'))).toBe(true);
      expect(v.recent.slice(2).some((r) => r.month.includes('subject to revision'))).toBe(false);
      // Every displayed value is the published string, grouped.
      for (const r of v.recent) expect(r.value).toBe(levelCell(v.rows.find((o) => o.period === r.period)!.value!));
      expect(v.comparisons.map((c) => c.months)).toEqual([12, 60, 120]);
      expect(v.retrievedAt).toBe(info.csvs.at(-1)?.retrieved_at);
      expect(v.checkedAt).toBe(info.checked_at);
    }
  });

  it('computes the latest changes of M1 seasonally adjusted from its last rows', () => {
    const v = measureView(ds, 'm1-sa');
    const last = v.rows.at(-1)!;
    const prior = v.rows.at(-2)!;
    const yearAgo = v.rows.find((r) => r.period === monthsBefore(last.period, 12))!;
    expect(v.monthOverMonth).toMatchObject({ ok: true, from: prior.period, to: last.period, dollars: dollarChange(last.value!, prior.value!), percent: percentChange(last.value!, prior.value!) });
    expect(v.yearOverYear).toMatchObject({ ok: true, from: yearAgo.period, dollars: dollarChange(last.value!, yearAgo.value!) });
    // Ten years back crosses the May 2020 break.
    expect(v.comparisons[2]).toMatchObject({ label: '10 years earlier', change: 'Not computed (definition change)', percent: 'Not computed (definition change)' });
  });

  it('does not compute M1 across May 2020 in either adjustment, and does compute M2', () => {
    for (const id of ['m1-sa', 'm1-nsa']) {
      const rows = observations(ds, id);
      expect(computeChange(rows, '2020-05', 1, 'M1', breaksFor(id))).toMatchObject({ ok: false, reason: 'break' });
      expect(computeChange(rows, '2021-04', 12, 'M1', breaksFor(id))).toMatchObject({ ok: false, reason: 'break' });
      expect(computeChange(rows, '2021-05', 12, 'M1', breaksFor(id))).toMatchObject({ ok: true });
    }
    for (const id of ['m2-sa', 'm2-nsa']) expect(computeChange(observations(ds, id), '2020-05', 1, 'M2', breaksFor(id))).toMatchObject({ ok: true });
  });

  it('draws M1 as two lines split at May 2020 and M2 as one, with every month once', () => {
    const m1 = observations(ds, 'm1-sa');
    const lines = definitionLines(m1, 'M1', breaksFor('m1-sa'));
    expect(lines.map((l) => [l.key, l.label])).toEqual([
      ['m1-start', 'M1, definition before May 2020'],
      ['m1-2020-05', 'M1, definition from May 2020'],
    ]);
    expect(lines[0]!.points.at(-1)?.x).toBe('2020-04');
    expect(lines[1]!.points[0]?.x).toBe('2020-05');
    expect(lines.flatMap((l) => l.points)).toEqual(m1.map((o) => ({ x: o.period, y: o.value })));
    const m2 = definitionLines(observations(ds, 'm2-sa'), 'M2', []);
    expect(m2.map((l) => l.key)).toEqual(['m2']);
    expect(definitionLines([{ period: '2020-01', value: '1.0', missingCode: 'NA' }], 'M2', [])[0]!.points).toEqual([{ x: '2020-01', y: null }]);
  });

  it('reads the registry copy: the H.6 calendar, the staleness rule and no known inconsistencies', () => {
    const registry = registryCopy(ds);
    for (const id of ids) {
      const notes = registryNotes(registry, id);
      expect(notes.calendarText).toMatch(/^Released on the fourth Tuesday of every month/);
      expect(notes.calendarValidFrom).toBe('2021-02-23');
      expect(notes.staleAfterDays).toBe(7);
      expect(notes.maxGap).toEqual({ gap: 1, unit: 'months' });
      expect(notes.inconsistencies).toEqual([]);
    }
    expect(registryNotes(null, 'm1-sa').calendarText).toBeNull();
    expect(registryNotes({ series: [{ id: 'm1-sa', known_inconsistencies: [{ period: '2020-05', text: 'kept as published' }, { period: 1 }] }] }, 'm1-sa').inconsistencies).toEqual([{ period: '2020-05', text: 'kept as published' }]);
  });

  it('words the fixture revision log of M1 seasonally adjusted in log order', () => {
    const shown = revisionDisplay(revisionRows(ds, 'm1-sa'));
    expect(shown.length).toBe(revisionRows(ds, 'm1-sa').length);
    expect(shown[0]).toMatchObject({ detected: 'November 24, 2026', month: 'September 2026', field: 'Value', before: '20,061.2', after: '21,264.9', kind: 'Expected', releaseDate: 'November 24, 2026' });
    expect(shown.some((r) => r.field === 'Whole month' && r.before === 'Month with value 20,073.6' && r.after === 'None' && r.kind === 'Rollback')).toBe(true);
  });
});
