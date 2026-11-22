// The National Debt Tracker's own calculations (brief Q, docs/P36_V020_PARALLEL_DASHBOARDS.md,
// Agent 3), for the Treasury Debt to the Penny series `debt-total`, `debt-held-public` and
// `debt-intragov`. Pure: no file system, no network, no clock. Values stay decimal strings and are
// computed with BigInt cents, never floating point. Every number this module computes is shown on
// the page as "Computed by RadMage Finance" with its formula (design P28 8.1 and DATA_CONVENTIONS
// 16); the independent oracle is tests/oracle/econ_debt.py, written from these rules alone.
//
// RULES (written before the code; the oracle implements them separately)
//
// D1. Records. A record is one row of a series' CSV segments: a record date (YYYY-MM-DD) and
//     either a published value (a decimal string of U.S. dollars with exactly two decimals, for
//     example "40626506856903.25") or no value (the missing code `not-published`). The records of
//     a series are in ascending date order, one per date. A day without a row (a weekend, a
//     holiday, a documented gap in the source) has no record. Nothing is ever filled in: no record
//     is created for a day without one, and a record without a value is never read as zero. A
//     value that is not a decimal with exactly two decimals is an error (the function throws).
//
// D2. Latest record. The latest record of a series is its last record that has a published value.
//     A series with no such record has no latest record.
//
// D3. Daily change. The comparison record is the record immediately before the latest record in
//     the series (the previous record date), whether or not it has a value. There is no base date.
//
// D4. Monthly and yearly changes. The base date is the same day of the month one month (monthly)
//     or twelve months (yearly) before the latest record date. When that day does not exist in the
//     earlier month (the 29th to the 31st), the base date is the last day of that month: March 31
//     gives February 28 (or February 29 in a leap year), and a yearly change from February 29
//     gives February 28 of the year before. The comparison record is the latest record dated on or
//     before the base date, whether or not it has a value. Months and leap years follow the
//     Gregorian calendar.
//
// D5. Gap. The gap of a change is a whole number of calendar days: for a daily change, from the
//     comparison record date to the latest record date; for a monthly or yearly change, from the
//     comparison record date to the base date (zero when the comparison record is on the base date).
//     The limit is the series' registry `continuity.max_gap` in days (6 for the three debt series;
//     the longest gap between Debt to the Penny records in the source is 5 days).
//
// D6. Anomaly dates. The anomaly dates are the periods listed under `known_inconsistencies` in the
//     registry entry of any of the three debt series (2011-02-01 and 2025-08-04 in the v0.8
//     registry), each with its registry text. They apply to all three series, because the registry
//     text is about the three published fields together and does not say which field is off.
//
// D7. Validity. A change is valid only when every check below passes. The checks run in this
//     order and the first one that fails is the reason given instead of a number:
//       1. `no-latest`: the series has no latest record (D2);
//       2. `no-comparison`: there is no comparison record (D3, D4);
//       3. `not-published`: the comparison record has no published value;
//       4. `gap`: the gap (D5) is greater than the limit;
//       5. `anomaly-latest`: the latest record date is an anomaly date (D6);
//       6. `anomaly-comparison`: the comparison record date is an anomaly date.
//     The result always reports the latest record date, the base date (monthly and yearly) and the
//     comparison record date and gap whenever they exist, valid or not.
//
// D8. Change value. A valid change is the latest value minus the comparison value, exact to the
//     cent, with two decimals ("2000000000.00", "-0.03", "0.00").
//
// D9. Exact display. An amount is "$" and its digits grouped by commas in threes, with its two
//     decimals, for example "$40,626,506,856,903.25"; a negative amount starts with "-$". A signed
//     amount (a change) starts with "+$" when it is above zero and "-$" when below; zero is
//     "$0.00" without a sign.
//
// D10. Rounded display ("rounded for display"). From the absolute value of the exact amount: at
//     least 1,000,000,000,000.00 is shown in trillions (the decimal point moved 12 places left), at
//     least 1,000,000,000.00 in billions (9 places), at least 1,000,000.00 in millions (6 places);
//     a smaller amount has no rounded form. The moved value is rounded half up to two decimals (a
//     tie goes away from zero), grouped as D9, then the word: "$40.63 trillion", "$7.79 trillion",
//     "$2.00 billion". The scale is chosen before rounding, so 999,999,999,999.99 gives
//     "$1,000.00 billion". The sign follows D9: an unsigned amount has "-" only when negative; a
//     signed amount has "+" above zero and "-" below.
//
// D11. Parts against the total. For every record date on which all three series have a record
//     with a published value, the difference is debt held by the public plus intragovernmental
//     holdings minus total public debt outstanding, exact to the cent. Every date whose
//     difference is not zero is listed, oldest first, with the three published values, the
//     difference and the registry text when the date is an anomaly date (D6), or none. Nothing is
//     adjusted, and the total is never replaced by, or computed from, the parts.
//
// D12. Missing values of a series. `first_published`: the earliest record date with a published
//     value (none when there is none). `not_published`: the number of records without a value.
//     `last_not_published`: the latest record date without a value (none when there is none).
//     `daily_from`: the earliest record date D such that every record dated D or later has a
//     published value (none when the last record has no value; the first record's date when every
//     record has a value).
//
// D13. Recent records. The last N records of the total (N = 30, decision D12: the last 30 business
//     days with a record), newest first. For each of those record dates, each part is one of:
//     `published` with its value, `not-published` (a record without a value), or `no-record` (the
//     part has no record on that date, for example after its own latest record).
//
// D14. Chart points. A chart of one series starts at its first record with a published value;
//     records before it are left out. An optional window start date W also leaves out every record
//     dated before W. Each record kept gives one point: its date and its value, or a gap (no
//     value) when it has none. Each documented gap date (the registry's `known_gaps`) after the
//     first point's date and before the last point's date, on which the series has no record,
//     adds a gap point at that date, so the line is broken there. Points are in date order. Days
//     without a record that are not documented gaps (weekends and holidays) add nothing. The
//     twelve-month chart uses W = the yearly base date (D4) of the latest record date.

import type { EconDataset, ManifestSeries, Observation, RevisionRow, SegmentRef } from './econ';
import { observations, revisionRows, segmentsInOrder, seriesInfo } from './econ';
import { DETECTED_LABEL, formatDay, groupDigits, roundHalfUp, shiftLeft } from './format';
import type { ChartLine, ChartSpec, ComputedFigure, Headline, TableSpec } from './ui';

/** The three series of this page, in registry order. */
export const DEBT_SERIES = ['debt-total', 'debt-held-public', 'debt-intragov'] as const;
export type DebtSeriesId = (typeof DEBT_SERIES)[number];

/** A record (D1): a record date and its published value, or null when it has none. Observations fit. */
export interface DebtRecord {
  period: string;
  value: string | null;
}

export type ChangeKind = 'daily' | 'monthly' | 'yearly';
export type ChangeReason = 'no-latest' | 'no-comparison' | 'not-published' | 'gap' | 'anomaly-latest' | 'anomaly-comparison';

/** One change of D3 to D8. */
export interface ChangeResult {
  kind: ChangeKind;
  valid: boolean;
  latest: string | null;
  base: string | null;
  comparison: string | null;
  gapDays: number | null;
  reason: ChangeReason | null;
  /** The change (D8) when valid. */
  change: string | null;
  /** The two values compared, when they exist. */
  latestValue: string | null;
  comparisonValue: string | null;
}

// ---------------------------------------------------------------------------------------------
// Exact decimals (D1, D8): two-decimal strings as BigInt cents.

const TWO_DECIMALS = /^-?\d+\.\d{2}$/;

/** The cents of a two-decimal string; throws on anything else (D1). */
export function toCents(value: string): bigint {
  if (!TWO_DECIMALS.test(value)) throw new Error(`not a dollar amount with two decimals: ${value}`);
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).replace('.', '');
  const cents = BigInt(digits);
  return negative ? -cents : cents;
}

/** A two-decimal string from cents. */
export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// ---------------------------------------------------------------------------------------------
// Dates (D4, D5): Gregorian calendar arithmetic on YYYY-MM-DD strings.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateParts(date: string): { y: number; m: number; d: number } {
  const match = DAY.exec(date);
  if (!match) throw new Error(`not a date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The number of days in a month (1 to 12) of a year. */
export function daysInMonth(y: number, m: number): number {
  return m === 2 && isLeap(y) ? 29 : (MONTH_LENGTHS[m - 1] ?? 0);
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** D4: the same day `months` months before `date`, clamped to the last day of that month. */
export function baseDate(date: string, months: number): string {
  const { y, m, d } = dateParts(date);
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

/** The day number of a date (days since 1970-01-01), from the Gregorian calendar. */
function dayNumber(date: string): number {
  const { y, m, d } = dateParts(date);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** D5: whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

// ---------------------------------------------------------------------------------------------
// Changes (D2 to D8).

/** D2: the index of the latest record with a published value, or -1. */
export function latestIndex(records: readonly DebtRecord[]): number {
  for (let i = records.length - 1; i >= 0; i -= 1) if (records[i]?.value !== null) return i;
  return -1;
}

/** The index of the latest record dated on or before `date`, or -1 (D4). */
function onOrBefore(records: readonly DebtRecord[], date: string, below: number): number {
  for (let i = below; i >= 0; i -= 1) if ((records[i]?.period ?? '') <= date) return i;
  return -1;
}

const MONTHS: Record<Exclude<ChangeKind, 'daily'>, number> = { monthly: 1, yearly: 12 };

/** One change of a series under D3 to D8. `anomalies` maps an anomaly date to its registry text (D6). */
export function computeChange(records: readonly DebtRecord[], kind: ChangeKind, anomalies: ReadonlyMap<string, string>, maxGapDays: number): ChangeResult {
  const out: ChangeResult = { kind, valid: false, latest: null, base: null, comparison: null, gapDays: null, reason: null, change: null, latestValue: null, comparisonValue: null };
  const li = latestIndex(records);
  const latest = records[li];
  if (!latest || latest.value === null) return { ...out, reason: 'no-latest' };
  out.latest = latest.period;
  out.latestValue = latest.value;
  let ci: number;
  if (kind === 'daily') {
    ci = li - 1;
  } else {
    out.base = baseDate(latest.period, MONTHS[kind]);
    ci = onOrBefore(records, out.base, li - 1);
  }
  const comparison = ci >= 0 ? records[ci] : undefined;
  if (!comparison) return { ...out, reason: 'no-comparison' };
  out.comparison = comparison.period;
  out.comparisonValue = comparison.value;
  out.gapDays = daysBetween(comparison.period, out.base ?? latest.period);
  if (comparison.value === null) return { ...out, reason: 'not-published' };
  if (out.gapDays > maxGapDays) return { ...out, reason: 'gap' };
  if (anomalies.has(latest.period)) return { ...out, reason: 'anomaly-latest' };
  if (anomalies.has(comparison.period)) return { ...out, reason: 'anomaly-comparison' };
  return { ...out, valid: true, change: fromCents(toCents(latest.value) - toCents(comparison.value)) };
}

/** The daily, monthly and yearly changes of a series. */
export function computeChanges(records: readonly DebtRecord[], anomalies: ReadonlyMap<string, string>, maxGapDays: number): Record<ChangeKind, ChangeResult> {
  return {
    daily: computeChange(records, 'daily', anomalies, maxGapDays),
    monthly: computeChange(records, 'monthly', anomalies, maxGapDays),
    yearly: computeChange(records, 'yearly', anomalies, maxGapDays),
  };
}

// ---------------------------------------------------------------------------------------------
// Display (D9, D10).

/** D9: "$40,626,506,856,903.25"; "-$0.03" when negative. */
export function formatUsd(value: string): string {
  const cents = toCents(value);
  const magnitude = groupDigits(fromCents(cents < 0n ? -cents : cents));
  return `${cents < 0n ? '-' : ''}$${magnitude}`;
}

/** D9 signed: "+$2,000.00", "-$2,000.00", "$0.00". */
export function formatUsdSigned(value: string): string {
  const cents = toCents(value);
  return cents > 0n ? `+${formatUsd(value)}` : formatUsd(value);
}

const SCALES: readonly { min: bigint; places: number; word: string }[] = [
  { min: 100_000_000_000_000n, places: 12, word: 'trillion' },
  { min: 100_000_000_000n, places: 9, word: 'billion' },
  { min: 100_000_000n, places: 6, word: 'million' },
];

/** D10: the amount in trillions, billions or millions to two decimals, or null below a million. */
export function roundedUsd(value: string, signed = false): string | null {
  const cents = toCents(value);
  const magnitude = cents < 0n ? -cents : cents;
  const scale = SCALES.find((s) => magnitude >= s.min);
  if (!scale) return null;
  const shown = groupDigits(roundHalfUp(shiftLeft(fromCents(magnitude), scale.places), 2));
  const sign = cents < 0n ? '-' : signed && cents > 0n ? '+' : '';
  return `${sign}$${shown} ${scale.word}`;
}

// ---------------------------------------------------------------------------------------------
// Parts against the total (D11).

export interface PartsDisagreement {
  period: string;
  total: string;
  held: string;
  intragov: string;
  /** Held plus intragovernmental minus total, exact. */
  difference: string;
  /** The registry text when the date is an anomaly date, else null. */
  note: string | null;
}

const publishedByDate = (records: readonly DebtRecord[]) => {
  const map = new Map<string, string>();
  for (const r of records) if (r.value !== null) map.set(r.period, r.value);
  return map;
};

/** D11: every record date with all three values whose parts do not add up to the total, oldest first. */
export function partsDisagreements(total: readonly DebtRecord[], held: readonly DebtRecord[], intragov: readonly DebtRecord[], anomalies: ReadonlyMap<string, string>): PartsDisagreement[] {
  const h = publishedByDate(held);
  const g = publishedByDate(intragov);
  const out: PartsDisagreement[] = [];
  for (const t of [...total].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))) {
    const hv = h.get(t.period);
    const gv = g.get(t.period);
    if (t.value === null || hv === undefined || gv === undefined) continue;
    const difference = toCents(hv) + toCents(gv) - toCents(t.value);
    if (difference !== 0n) out.push({ period: t.period, total: t.value, held: hv, intragov: gv, difference: fromCents(difference), note: anomalies.get(t.period) ?? null });
  }
  return out;
}

/** The latest record date with all three values, and whether the parts add up there (D11 on one date). */
export function latestCommonCheck(total: readonly DebtRecord[], held: readonly DebtRecord[], intragov: readonly DebtRecord[]): { period: string; total: string; held: string; intragov: string; difference: string } | null {
  const h = publishedByDate(held);
  const g = publishedByDate(intragov);
  for (let i = total.length - 1; i >= 0; i -= 1) {
    const t = total[i];
    if (!t || t.value === null) continue;
    const hv = h.get(t.period);
    const gv = g.get(t.period);
    if (hv !== undefined && gv !== undefined) return { period: t.period, total: t.value, held: hv, intragov: gv, difference: fromCents(toCents(hv) + toCents(gv) - toCents(t.value)) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Missing values (D12), recent records (D13) and chart points (D14).

export interface MissingSummary {
  firstPublished: string | null;
  notPublished: number;
  lastNotPublished: string | null;
  dailyFrom: string | null;
}

/** D12. */
export function missingSummary(records: readonly DebtRecord[]): MissingSummary {
  let firstPublished: string | null = null;
  let lastNotPublished: string | null = null;
  let notPublished = 0;
  for (const r of records) {
    if (r.value === null) {
      notPublished += 1;
      lastNotPublished = r.period;
    } else if (firstPublished === null) firstPublished = r.period;
  }
  let dailyFrom: string | null = null;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i];
    if (!r || r.value === null) break;
    dailyFrom = r.period;
  }
  return { firstPublished, notPublished, lastNotPublished, dailyFrom };
}

export type PartState = { state: 'published'; value: string } | { state: 'not-published'; value: null } | { state: 'no-record'; value: null };

export interface RecentRow {
  period: string;
  total: string | null;
  held: PartState;
  intragov: PartState;
}

function partAt(byDate: ReadonlyMap<string, DebtRecord>, period: string): PartState {
  const r = byDate.get(period);
  if (!r) return { state: 'no-record', value: null };
  return r.value === null ? { state: 'not-published', value: null } : { state: 'published', value: r.value };
}

/** D13: the last `n` records of the total, newest first, with each part's state on those dates. */
export function recentRows(total: readonly DebtRecord[], held: readonly DebtRecord[], intragov: readonly DebtRecord[], n = 30): RecentRow[] {
  const h = new Map(held.map((r) => [r.period, r]));
  const g = new Map(intragov.map((r) => [r.period, r]));
  return total
    .slice(Math.max(0, total.length - n))
    .reverse()
    .map((t) => ({ period: t.period, total: t.value, held: partAt(h, t.period), intragov: partAt(g, t.period) }));
}

/** D14: the points of one series' line, with gaps at documented gap dates inside it. */
export function chartPoints(records: readonly DebtRecord[], knownGaps: readonly string[], windowStart: string | null = null): { x: string; y: string | null }[] {
  const first = records.find((r) => r.value !== null);
  if (!first) return [];
  const kept = records.filter((r) => r.period >= first.period && (windowStart === null || r.period >= windowStart));
  const head = kept[0];
  const tail = kept[kept.length - 1];
  if (!head || !tail) return [];
  const have = new Set(kept.map((r) => r.period));
  const points = kept.map((r) => ({ x: r.period, y: r.value }));
  for (const g of knownGaps) if (g > head.period && g < tail.period && !have.has(g)) points.push({ x: g, y: null });
  return points.sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
}

/** D14: the start of the twelve-month chart, the yearly base date of the latest record date. */
export function twelveMonthStart(records: readonly DebtRecord[]): string | null {
  const latest = records[latestIndex(records)];
  return latest ? baseDate(latest.period, 12) : null;
}

// ---------------------------------------------------------------------------------------------
// The registry copy the dataset carries (DATA_CONVENTIONS 22.9): anomalies, gaps and the limit.

export interface RegistryNote {
  period: string;
  text: string;
}

export interface DebtRegistry {
  /** D6: anomaly dates of the three series together, with their registry text. */
  anomalies: Map<string, string>;
  /** Per series: its known inconsistencies, documented gaps and continuity limit in days. */
  series: Record<DebtSeriesId, { knownInconsistencies: RegistryNote[]; knownGaps: RegistryNote[]; maxGapDays: number; title: string; earliest: string | null }>;
  /** The Fiscal Data release calendar text, for the page's timing note. */
  calendarText: string | null;
  /** The source's publisher, for the page's structured data. */
  publisher: string | null;
}

interface RegistrySeriesEntry {
  id: string;
  title?: string;
  earliest?: string;
  known_inconsistencies?: RegistryNote[];
  known_gaps?: RegistryNote[];
  continuity?: { max_gap?: number; unit?: string };
  release?: { calendar?: string };
  source?: string;
}

/** Reads the debt entries of a registry (the parsed JSON of the copy the manifest names). */
export function debtRegistry(registry: unknown): DebtRegistry {
  const entries = (registry as { series?: RegistrySeriesEntry[] }).series ?? [];
  const calendars = (registry as { calendars?: Record<string, { text?: string }> }).calendars ?? {};
  const sources = (registry as { sources?: Record<string, { publisher?: string }> }).sources ?? {};
  let publisher: string | null = null;
  const anomalies = new Map<string, string>();
  const series = {} as DebtRegistry['series'];
  let calendarText: string | null = null;
  for (const id of DEBT_SERIES) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error(`the registry has no series ${id}`);
    const continuity = entry.continuity;
    if (!continuity || continuity.unit !== 'days' || !Number.isInteger(continuity.max_gap)) throw new Error(`the registry gives ${id} no continuity limit in days`);
    const knownInconsistencies = [...(entry.known_inconsistencies ?? [])];
    for (const note of knownInconsistencies) {
      const before = anomalies.get(note.period);
      if (before === undefined) anomalies.set(note.period, note.text);
      else if (!before.includes(note.text)) anomalies.set(note.period, `${before} ${note.text}`);
    }
    series[id] = { knownInconsistencies, knownGaps: [...(entry.known_gaps ?? [])], maxGapDays: continuity.max_gap as number, title: entry.title ?? id, earliest: entry.earliest ?? null };
    const calendar = entry.release?.calendar;
    if (calendarText === null && calendar) calendarText = calendars[calendar]?.text ?? null;
    if (publisher === null && entry.source) publisher = sources[entry.source]?.publisher ?? null;
  }
  return { anomalies, series, calendarText, publisher };
}

/** The registry copy named by the dataset's manifest (`rules.registry`), parsed. */
export function readRegistry(ds: EconDataset): DebtRegistry {
  const ref = (ds.manifest.rules as { registry?: { path?: unknown } } | null)?.registry;
  if (!ref || typeof ref.path !== 'string') throw new Error('the manifest names no registry copy');
  return debtRegistry(JSON.parse(ds.readText(ref.path)));
}

// ---------------------------------------------------------------------------------------------
// Wording for the page.

const NAMES: Record<DebtSeriesId, string> = {
  'debt-total': 'the total',
  'debt-held-public': 'debt held by the public',
  'debt-intragov': 'intragovernmental holdings',
};

/** Why a change is not shown, in words (D7). */
export function reasonText(result: ChangeResult, anomalies: ReadonlyMap<string, string>, maxGapDays: number): string | null {
  const day = (d: string | null) => (d ? formatDay(d) : '');
  switch (result.reason) {
    case null:
      return null;
    case 'no-latest':
      return 'The series has no published value.';
    case 'no-comparison':
      return result.kind === 'daily' ? 'There is no earlier record.' : `There is no record on or before ${day(result.base)}.`;
    case 'not-published':
      return `The comparison record of ${day(result.comparison)} has no published value.`;
    case 'gap':
      return result.kind === 'daily'
        ? `The previous record, ${day(result.comparison)}, is ${result.gapDays} days before the latest, more than the ${maxGapDays}-day limit.`
        : `The latest record on or before ${day(result.base)} is ${day(result.comparison)}, ${result.gapDays} days earlier, more than the ${maxGapDays}-day limit.`;
    case 'anomaly-latest':
      return `The latest record, ${day(result.latest)}, is a known inconsistency in the source: ${anomalies.get(result.latest ?? '') ?? ''}`.trim();
    case 'anomaly-comparison':
      return `The comparison record, ${day(result.comparison)}, is a known inconsistency in the source: ${anomalies.get(result.comparison ?? '') ?? ''}`.trim();
  }
}

/** The formula of a change, with its dates and values when it is valid (design 8.1: labeled with the formula). */
export function formulaText(result: ChangeResult, series: DebtSeriesId): string {
  const name = NAMES[series];
  const which: Record<ChangeKind, string> = {
    daily: 'the previous record date',
    monthly: 'the latest record on or before the same day one month earlier',
    yearly: 'the latest record on or before the same day one year earlier',
  };
  if (!result.valid || !result.latest || !result.comparison || !result.latestValue || !result.comparisonValue) {
    return `${capitalize(name)} on the latest record date minus ${name} on ${which[result.kind]}.`;
  }
  const where = result.kind === 'daily' ? 'the previous record date' : `the latest record on or before ${formatDay(result.base ?? '')}`;
  return `${capitalize(name)} on ${formatDay(result.latest)} (${formatUsd(result.latestValue)}) minus ${name} on ${formatDay(result.comparison)} (${formatUsd(result.comparisonValue)}), ${where}.`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A change for display: the exact signed amount, with its rounded form when it has one (D9, D10). */
export function changeValueText(result: ChangeResult): string {
  if (!result.valid || result.change === null) return '';
  const rounded = roundedUsd(result.change, true);
  return rounded ? `${formatUsdSigned(result.change)} (${rounded}, rounded for display)` : formatUsdSigned(result.change);
}

/** A record's release wording by its basis (design 6.1). */
export function releasedText(o: Pick<Observation, 'released' | 'releasedBasis'>): string {
  if (o.releasedBasis === 'first-seen' && o.released) return `First seen by RadMage Finance on ${formatDay(o.released)} (Eastern Time date)`;
  if (o.released) return `Released ${formatDay(o.released)}`;
  return 'Release date not recorded';
}

/** The release date alone, for a table column whose header names the basis (design 6.1). */
export function releasedDate(o: Pick<Observation, 'released' | 'releasedBasis'>): string {
  return o.released ? formatDay(o.released) : 'Not recorded';
}

/** "2026-11-24T22:17:00Z" gives "November 24, 2026, 22:17 UTC". */
export function formatUtc(timestamp: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):\d{2}Z$/.exec(timestamp);
  if (!m || !m[1]) throw new Error(`not a UTC time: ${timestamp}`);
  return `${formatDay(m[1])}, ${m[2]}:${m[3]} UTC`;
}

const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The Eastern date of a UTC time (DATA_CONVENTIONS 1: dates derived from times are ET dates). */
export function easternDate(timestamp: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)) throw new Error(`not a UTC time: ${timestamp}`);
  return ET.format(new Date(timestamp));
}

/** The CSV segment that holds a record date (its year, or the single `all` segment). */
export function segmentFor(period: string, csvs: readonly SegmentRef[]): SegmentRef | null {
  return csvs.find((c) => c.segment === period.slice(0, 4)) ?? csvs.find((c) => c.segment === 'all') ?? null;
}

const KINDS: Record<string, string> = { expected: 'Expected', 'approved-hold': 'Approved after review', rollback: 'Rollback' };

/** One revision row for the table of design 6.4. */
export function revisionDisplay(r: RevisionRow): Record<string, string> {
  const amount = (v: string) => (r.field === 'value' && TWO_DECIMALS.test(v) ? formatUsd(v) : v || 'None');
  return {
    detected: formatDay(easternDate(r.detectedAt)),
    period: /^\d{4}-\d{2}-\d{2}$/.test(r.period) ? formatDay(r.period) : r.period,
    field: r.field,
    before: amount(r.before),
    after: amount(r.after),
    kind: KINDS[r.kind] ?? r.kind,
    basis: r.basis,
    release: r.releaseDate ? formatDay(r.releaseDate) : 'Not recorded',
  };
}

/** A download name for a segment, for example "debt-total-2026.csv". */
export function downloadName(series: string, segment: string): string {
  return `${series}-${segment}.csv`;
}

// ---------------------------------------------------------------------------------------------
// The page model: everything src/data-pages/public-debt.astro shows, from one dataset.

export interface DownloadLink {
  href: string;
  /** The visible link text, for example "2026 (CSV)". */
  label: string;
  /** Words before the label for screen readers, for example "Total public debt outstanding, ". */
  context: string;
  download: string;
}

export interface DebtPart {
  id: DebtSeriesId;
  title: string;
  headline: Headline | null;
}

export interface DebtPage {
  coverage: { first: string; last: string };
  maxGapDays: number;
  calendarText: string | null;
  publisher: string | null;
  headline: Headline;
  totalChanges: Record<ChangeKind, ChangeResult>;
  totalFigures: ComputedFigure[];
  parts: DebtPart[];
  /** A sentence for each part whose latest record date differs from the total's. */
  partLagNotes: string[];
  latestCheck: ComputedFigure | null;
  partChangesTable: TableSpec;
  charts: { total: ChartSpec; totalYear: ChartSpec; parts: ChartSpec };
  recentTable: TableSpec;
  missingText: string[];
  gapsTable: TableSpec;
  inconsistenciesTable: TableSpec;
  disagreements: PartsDisagreement[];
  disagreementsTable: TableSpec;
  revisions: { id: DebtSeriesId; title: string; table: TableSpec | null; links: DownloadLink[] }[];
  downloads: { id: DebtSeriesId; title: string; links: DownloadLink[] }[];
}

const CHANGE_LABELS: Record<ChangeKind, string> = { daily: 'Daily change', monthly: 'Monthly change', yearly: 'Yearly change' };

/** One computed figure for the shared ComputedFigure component (design 8.1). */
export function changeFigure(result: ChangeResult, series: DebtSeriesId, anomalies: ReadonlyMap<string, string>, maxGapDays: number): ComputedFigure {
  return {
    label: CHANGE_LABELS[result.kind],
    value: changeValueText(result),
    formula: formulaText(result, series),
    unavailableReason: result.valid ? null : reasonText(result, anomalies, maxGapDays),
  };
}

function partText(p: PartState): string {
  if (p.state === 'published') return formatUsd(p.value);
  return p.state === 'not-published' ? 'Not published' : 'No record';
}

const byDate = <T extends { period: string }>(rows: readonly T[]): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const r of rows) map.set(r.period, [...(map.get(r.period) ?? []), r]);
  return map;
};

const ascending = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The year of a content-addressed revision path, `revisions/<series>/<YYYY>/<hex>.<ext>`. */
const revisionYear = (path: string) => path.split('/')[2] ?? '';

/**
 * The page model, or null when the dataset has no published total. `link` turns a path inside the
 * econ root into a site address (the page passes `href('data/econ/' + path)`).
 */
export function buildDebtPage(ds: EconDataset, link: (path: string) => string): DebtPage | null {
  const info = Object.fromEntries(DEBT_SERIES.map((id) => [id, seriesInfo(ds, id)])) as Record<DebtSeriesId, ManifestSeries>;
  const obs = Object.fromEntries(DEBT_SERIES.map((id) => [id, observations(ds, id)])) as Record<DebtSeriesId, Observation[]>;
  const total = obs['debt-total'];
  const held = obs['debt-held-public'];
  const intragov = obs['debt-intragov'];
  const latest = total[latestIndex(total)];
  const first = total.find((r) => r.value !== null);
  if (!latest || latest.value === null || !first) return null;
  const registry = readRegistry(ds);
  const { anomalies } = registry;
  const maxGapDays = registry.series['debt-total'].maxGapDays;

  const retrieval = (id: DebtSeriesId, period: string) => {
    const seg = segmentFor(period, info[id].csvs);
    const checked = info[id].checked_at;
    const words = [seg ? `Retrieved ${formatUtc(seg.retrieved_at)}` : null, checked ? `last confirmed unchanged ${formatUtc(checked)}` : null].filter((w): w is string => w !== null);
    return words.length ? `${words.join('; ')}.` : '';
  };
  const headlineFor = (id: DebtSeriesId): Headline | null => {
    const r = obs[id][latestIndex(obs[id])];
    if (!r || r.value === null) return null;
    const rounded = roundedUsd(r.value);
    return {
      label: info[id].title,
      value: formatUsd(r.value),
      period: `Record date ${formatDay(r.period)}`,
      kind: 'observed',
      details: [rounded ? `${rounded}, rounded for display.` : '', `${releasedText(r)}.`, retrieval(id, r.period)].filter((d) => d !== ''),
    };
  };
  const headline = headlineFor('debt-total');
  if (!headline) return null;

  const totalChanges = computeChanges(total, anomalies, maxGapDays);
  const totalFigures = (['daily', 'monthly', 'yearly'] as const).map((k) => changeFigure(totalChanges[k], 'debt-total', anomalies, maxGapDays));

  const partIds = ['debt-held-public', 'debt-intragov'] as const;
  const parts: DebtPart[] = partIds.map((id) => ({ id, title: info[id].title, headline: headlineFor(id) }));
  const partLagNotes: string[] = [];
  for (const id of partIds) {
    const r = obs[id][latestIndex(obs[id])];
    if (r && r.period !== latest.period) partLagNotes.push(`The latest record of ${NAMES[id]} is for ${formatDay(r.period)}, earlier than the total's ${formatDay(latest.period)}. Its status line says why.`);
  }

  const common = latestCommonCheck(total, held, intragov);
  const latestCheck: ComputedFigure | null = common
    ? {
        label: `Parts against the total on ${formatDay(common.period)}, the latest record date with all three values`,
        value: toCents(common.difference) === 0n ? 'The published parts add up exactly to the published total.' : `The published parts differ from the published total by ${formatUsdSigned(common.difference)} (parts minus total).`,
        formula: `debt held by the public (${formatUsd(common.held)}) plus intragovernmental holdings (${formatUsd(common.intragov)}) minus total public debt outstanding (${formatUsd(common.total)}) on ${formatDay(common.period)}. A check only: the total shown is always the published total.`,
        unavailableReason: null,
      }
    : null;

  const cell = (r: ChangeResult) => (r.valid && r.change !== null && r.comparison ? `${formatUsdSigned(r.change)} (since ${formatDay(r.comparison)})` : `Not shown: ${reasonText(r, anomalies, maxGapDays) ?? ''}`);
  const partChangesTable: TableSpec = {
    id: 'debt-part-changes',
    caption: 'Changes in the two parts, computed by RadMage Finance: the latest value minus the value on the comparison record date given in each cell, by the same rules as the total',
    columns: [
      { key: 'series', label: 'Series' },
      { key: 'latest', label: 'Latest record date' },
      { key: 'daily', label: 'Daily change (U.S. dollars)', numeric: true },
      { key: 'monthly', label: 'Monthly change (U.S. dollars)', numeric: true },
      { key: 'yearly', label: 'Yearly change (U.S. dollars)', numeric: true },
    ],
    rows: partIds.map((id) => {
      const c = computeChanges(obs[id], anomalies, registry.series[id].maxGapDays);
      return { series: info[id].title, latest: c.daily.latest ? formatDay(c.daily.latest) : '', daily: cell(c.daily), monthly: cell(c.monthly), yearly: cell(c.yearly) };
    }),
  };

  const disagreements = partsDisagreements(total, held, intragov, anomalies);
  const gapDates = registry.series['debt-total'].knownGaps.map((g) => g.period);
  const anomalyDates = [...anomalies.keys()].sort(ascending);
  const anomalyNote = (d: string) => `${formatDay(d)}: ${anomalies.get(d) ?? ''} Shown as published, not corrected.`;
  const gapNote = gapDates.length ? [`The line is broken at each of the ${gapDates.length} documented gaps in the source (business days with no record).`] : [];
  const totalLine = (points: { x: string; y: string | null }[]): ChartLine => ({ key: 'debt-total', label: info['debt-total'].title, shape: 'line', kind: 'observed', points });
  const yearStart = twelveMonthStart(total) ?? first.period;
  const heldSummary = missingSummary(held);
  const intragovSummary = missingSummary(intragov);
  const partsStart = [heldSummary.firstPublished, intragovSummary.firstPublished].filter((d): d is string => d !== null).sort(ascending)[0] ?? first.period;
  const sparseUntil = [heldSummary.dailyFrom, intragovSummary.dailyFrom].filter((d): d is string => d !== null).sort(ascending).at(-1) ?? null;
  const charts = {
    total: {
      id: 'debt-chart-total',
      title: `Total public debt outstanding, every record date from ${formatDay(first.period)} to ${formatDay(latest.period)}`,
      unitLabel: 'U.S. dollars',
      periodKind: 'day' as const,
      lines: [totalLine(chartPoints(total, gapDates))],
      notes: [...anomalyDates.map(anomalyNote), ...gapNote, 'Every value to the cent is in the CSV files under Downloads; the last 30 record dates are in the Recent records table.'],
      tableId: 'debt-recent',
    },
    totalYear: {
      id: 'debt-chart-total-year',
      title: `Total public debt outstanding, the last twelve months: record dates from ${formatDay(yearStart)} to ${formatDay(latest.period)}`,
      unitLabel: 'U.S. dollars',
      periodKind: 'day' as const,
      lines: [totalLine(chartPoints(total, gapDates, yearStart))],
      notes: [...anomalyDates.filter((d) => d >= yearStart).map(anomalyNote), 'The last 30 record dates are in the Recent records table.'],
      tableId: 'debt-recent',
    },
    parts: {
      id: 'debt-chart-parts',
      title: `Debt held by the public and intragovernmental holdings, from ${formatDay(partsStart)}`,
      unitLabel: 'U.S. dollars',
      periodKind: 'day' as const,
      lines: partIds.map((id): ChartLine => ({ key: id, label: info[id].title, shape: 'line', kind: 'observed', points: chartPoints(obs[id], registry.series[id].knownGaps.map((g) => g.period)) })),
      notes: [
        'Two separate lines, not stacked. The page never builds the total from its parts, and the published parts do not always add up to the published total.',
        ...(sparseUntil && sparseUntil > partsStart ? [`Before ${formatDay(sparseUntil)} the source published the parts on some record dates only; those values stand alone and are not joined to each other.`] : []),
        ...anomalyDates.map(anomalyNote),
      ],
      tableId: 'debt-recent',
    },
  };

  const revisionsByDate = byDate(revisionRows(ds, 'debt-total'));
  const disagreementByDate = new Map(disagreements.map((d) => [d.period, d]));
  const totalByDate = new Map(total.map((r) => [r.period, r]));
  const recent = recentRows(total, held, intragov, 30);
  const recentTable: TableSpec = {
    id: 'debt-recent',
    caption: `The last ${recent.length} record dates (business days with a record), newest first, as published`,
    columns: [
      { key: 'period', label: 'Record date' },
      { key: 'total', label: 'Total public debt outstanding (U.S. dollars)', numeric: true },
      { key: 'held', label: 'Debt held by the public (U.S. dollars)', numeric: true },
      { key: 'intragov', label: 'Intragovernmental holdings (U.S. dollars)', numeric: true },
      { key: 'released', label: 'Total first seen by RadMage Finance (Eastern Time date)' },
      { key: 'notes', label: 'Notes' },
    ],
    rows: recent.map((r) => {
      const notes: string[] = [];
      const anomaly = anomalies.get(r.period);
      if (anomaly) notes.push(`Known inconsistency in the source: ${anomaly}`);
      const d = disagreementByDate.get(r.period);
      if (d && !anomaly) notes.push(`The published parts and total differ by ${formatUsdSigned(d.difference)} (parts minus total, computed by RadMage Finance). Not listed in the registry; shown as published.`);
      for (const rev of revisionsByDate.get(r.period) ?? []) notes.push(`The total changed between our collections (detected ${formatDay(easternDate(rev.detectedAt))}, Eastern Time date); see Changes we observed.`);
      const t = totalByDate.get(r.period);
      return {
        period: formatDay(r.period),
        total: r.total === null ? 'Not published' : formatUsd(r.total),
        held: partText(r.held),
        intragov: partText(r.intragov),
        released: t ? releasedDate(t) : '',
        notes: notes.join(' ') || 'None',
      };
    }),
  };

  const describe = (name: string, s: MissingSummary) =>
    s.notPublished === 0
      ? `${capitalize(name)}: every record has a published value.`
      : `${capitalize(name)}: no published value on ${groupDigits(String(s.notPublished))} record dates, the last of them ${s.lastNotPublished ? formatDay(s.lastNotPublished) : 'none'}. The first published value is for ${s.firstPublished ? formatDay(s.firstPublished) : 'no date'}${s.dailyFrom ? `, and every record from ${formatDay(s.dailyFrom)} on has a value` : ''}.`;
  const missingText =
    JSON.stringify(heldSummary) === JSON.stringify(intragovSummary)
      ? [describe('debt held by the public and intragovernmental holdings', heldSummary)]
      : [describe(NAMES['debt-held-public'], heldSummary), describe(NAMES['debt-intragov'], intragovSummary)];

  const gapRows = new Map<string, { text: string; series: string[] }>();
  for (const id of DEBT_SERIES) {
    for (const g of registry.series[id].knownGaps) {
      const row = gapRows.get(g.period) ?? { text: g.text, series: [] };
      row.series.push(info[id].title);
      gapRows.set(g.period, row);
    }
  }
  const gapsTable: TableSpec = {
    id: 'debt-gaps',
    caption: 'Documented gaps in the source: business days with no Debt to the Penny record, as the registry lists them',
    columns: [
      { key: 'period', label: 'Business day' },
      { key: 'series', label: 'Series' },
      { key: 'text', label: 'Registry note' },
    ],
    rows: [...gapRows.entries()].sort(([a], [b]) => ascending(a, b)).map(([period, row]) => ({ period: formatDay(period), series: row.series.length === DEBT_SERIES.length ? 'All three' : row.series.join(', '), text: row.text })),
  };

  const inconsistenciesTable: TableSpec = {
    id: 'debt-inconsistencies',
    caption: 'Known inconsistencies in the source, as the registry lists them, with the total published for that date',
    columns: [
      { key: 'period', label: 'Record date' },
      { key: 'total', label: 'Total public debt outstanding as published (U.S. dollars)', numeric: true },
      { key: 'text', label: 'Registry note' },
    ],
    rows: anomalyDates.map((period) => {
      const t = totalByDate.get(period);
      return { period: formatDay(period), total: t && t.value !== null ? formatUsd(t.value) : 'No record', text: anomalies.get(period) ?? '' };
    }),
  };

  const disagreementsTable: TableSpec = {
    id: 'debt-disagreements',
    caption: `Every record date on which the published parts do not add up to the published total (${disagreements.length}), oldest first. The difference is computed by RadMage Finance: debt held by the public plus intragovernmental holdings minus total public debt outstanding`,
    columns: [
      { key: 'period', label: 'Record date' },
      { key: 'total', label: 'Total (U.S. dollars)', numeric: true },
      { key: 'held', label: 'Held by the public (U.S. dollars)', numeric: true },
      { key: 'intragov', label: 'Intragovernmental (U.S. dollars)', numeric: true },
      { key: 'difference', label: 'Parts minus total (U.S. dollars)', numeric: true },
      { key: 'note', label: 'Registry note' },
    ],
    rows: disagreements.map((d) => ({ period: formatDay(d.period), total: formatUsd(d.total), held: formatUsd(d.held), intragov: formatUsd(d.intragov), difference: formatUsdSigned(d.difference), note: d.note ?? 'Not listed in the registry. Shown as published.' })),
  };

  const revisions = DEBT_SERIES.map((id) => {
    const rows = revisionRows(ds, id);
    const context = `${info[id].title}, changes observed in `;
    const links: DownloadLink[] = [
      ...[...(info[id].revision_csvs ?? [])].reverse().map((r) => ({ href: link(r.path), label: `${revisionYear(r.path)} (CSV)`, context, download: `${id}-revisions-${revisionYear(r.path)}.csv` })),
      ...[...(info[id].revisions ?? [])].reverse().map((r) => ({ href: link(r.path), label: `${revisionYear(r.path)} (JSON)`, context, download: `${id}-revisions-${revisionYear(r.path)}.json` })),
    ];
    const table: TableSpec | null = rows.length
      ? {
          id: `debt-revisions-${id}`,
          caption: `${info[id].title}: changes we observed between our collections. Detection dates, and the dates in the basis, are Eastern Time dates; snapshot ids are UTC times.`,
          columns: [
            { key: 'detected', label: DETECTED_LABEL },
            { key: 'period', label: 'Record date' },
            { key: 'field', label: 'Field' },
            { key: 'before', label: 'Before', numeric: true },
            { key: 'after', label: 'After', numeric: true },
            { key: 'kind', label: 'Kind' },
            { key: 'basis', label: 'Basis' },
            { key: 'release', label: 'Release date' },
          ],
          rows: rows.map(revisionDisplay),
        }
      : null;
    return { id, title: info[id].title, table, links };
  });

  const downloads = DEBT_SERIES.map((id) => ({
    id,
    title: info[id].title,
    links: [...segmentsInOrder(info[id].csvs)].reverse().map((s) => ({ href: link(s.path), label: `${s.segment} (CSV)`, context: `${info[id].title}, `, download: downloadName(id, s.segment) })),
  }));

  return {
    coverage: { first: first.period, last: latest.period },
    maxGapDays,
    calendarText: registry.calendarText,
    publisher: registry.publisher,
    headline,
    totalChanges,
    totalFigures,
    parts,
    partLagNotes,
    latestCheck,
    partChangesTable,
    charts,
    recentTable,
    missingText,
    gapsTable,
    inconsistenciesTable,
    disagreements,
    disagreementsTable,
    revisions,
    downloads,
  };
}
