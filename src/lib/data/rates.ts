// The Interest Rate Tracker's calculations (owner brief Q, Agent 1; the page is
// src/data-pages/federal-funds-rate.astro). Pure: no file system, no network, no clock.
//
// THE RULES (written before the code; the independent Python oracle tests/oracle/econ_rates.py
// was written from this text alone, and tests/unit/data/rates.test.ts compares the two)
//
// Every number these rules produce is a decimal string; nothing goes through floating point.
// Every figure they compute is shown on the page as "Computed by RadMage Finance" with its
// formula. (Design rule 8.1 said "no derived numbers in the first version"; owner brief Q asks
// for changes in basis points and comparison periods, so 8.1's rule for later versions applies.)
//
// Inputs
//   EFFR observations: { period: 'YYYY-MM-DD', value: a decimal string or null }, in ascending
//   period order with unique periods (the dataset's order). A null value is a missing value; it
//   is never treated as zero and never interpolated.
//   Target change points: { effective: 'YYYY-MM-DD', kind: 'rate' or 'range', value, lower,
//   upper }, in ascending effective order with unique effective dates. A 'rate' has value (lower
//   and upper null); a 'range' has lower and upper (value null).
//
// R1  Decimal strings. A value matches -?D+(.D+)? (D a digit). Arithmetic is exact.
//
// R2  Basis points. The change from an earlier value a to a later value b, in basis points, is
//     (b - a) x 100, exactly. It is written canonically: no exponent, no plus sign, no leading
//     zeros (a single 0 before the point), trailing zeros after the point removed (and the point
//     with them), and zero as "0", never "-0". Examples: from 3.64 to 3.88 is "24"; from 3.88 to
//     3.875 is "-0.5"; from 1.00 to 1.000 is "0". Nothing is rounded.
//     The signed form puts "+" before a positive change; a negative one keeps its "-"; zero is
//     "0". The words form is "up N basis points", "down N basis points" or "unchanged", where N
//     is the change without its sign, with "basis point" (singular) when N is exactly "1".
//
// R3  Months back. A date d minus m months (m >= 0): move the year and month back by m months
//     and keep the day of the month, or take the last day of the resulting month when that
//     month is shorter. 2026-03-31 minus 1 is 2026-02-28; 2024-02-29 minus 12 is 2023-02-28;
//     2024-02-29 minus 48 is 2020-02-29.
//
// R4  The latest EFFR: the last observation whose value is not null. Its period is the
//     reference date D of every comparison. Without one there is no latest EFFR and no
//     comparison.
//
// R5  The previous observation of a period p: the last observation before p (in period order)
//     whose value is not null. EFFR records are business days, so for the latest EFFR this is
//     the previous business day with a published rate (a listed weekend record, such as the
//     Sunday 2003-07-20 in the New York Fed's records, counts as a record).
//
// R6  The observation for a comparison date T: the last observation whose value is not null
//     and whose period P is on or before T. It is used only when P is at most 7 calendar days
//     before T (T - P <= 7 days). Otherwise the comparison is not shown, with the reason
//       'before-data'     when T is before the first observation that has a value;
//       'outside-window'  when that latest P is more than 7 days before T.
//
// R7  EFFR comparisons, in this order, each against the latest EFFR (value b on D):
//       'previous'    the previous observation of D (R5); reason 'no-earlier' when there is none;
//       'month'       T = D minus 1 month (R3), the observation by R6;
//       'year'        T = D minus 12 months, by R6;
//       'five-years'  T = D minus 60 months, by R6.
//     Each comparison that is shown gives its period P, its value a and the change from a to b
//     in basis points (R2).
//
// R8  The target in effect on a date T: the change point with the latest effective date on or
//     before T; none when T is before the first change point. Its bounds: a rate's lower and
//     upper bounds are both its value; a range's are its lower and upper. The strings are kept
//     as given ("4.00" stays "4.00").
//
// R9  A target change from an earlier target o to a later target n: the lower-bound change
//     from o.lower to n.lower and the upper-bound change from o.upper to n.upper, each in basis
//     points by R2. From the single rate 1.00 to the range 0.00 to 0.25, that is lower "-100"
//     and upper "-75". Written signed: one signed number (R2) when the two are equal ("+25");
//     otherwise "lower <signed lower>, upper <signed upper>". In words: R2's words when the two
//     are equal; otherwise "lower bound <words of lower>, upper bound <words of upper>".
//
// R10 Change point rows: every change point, oldest first, with its change from the change
//     point before it (R9). The first change point has no change: its target was in effect
//     before the data begins, so its effective date is not a decision date.
//
// R11 The comparison table: one row for the latest EFFR (D), then one per comparison of R7 in
//     R7's order. Each row gives the period, the EFFR on it, the target in effect on that same
//     period (R8) and, except for the latest row, the target change from that target to the
//     target in effect on D (R9). A comparison that is not shown has no period, EFFR, target or
//     target change. A missing target on either date means no target change.
//
// R12 The recent table: the last 30 observations (null values included; all of them when there
//     are fewer), newest first, each with its previous observation (R5) and the change from it
//     in basis points (R2). A row whose value is null, or that has no previous observation, has
//     no change.
//
// R13 Chart windows '1y', '5y' (the default), '10y' and 'all'. There is no window when there
//     are neither observations nor change points.
//     End E: the latest of the latest EFFR's period (R4) and the last change point's effective
//     date (whichever exist).
//     Start S: E minus 12, 60 or 120 months (R3); for 'all', the earliest of the first
//     observation's period and the first change point's effective date (whichever exist).
//     EFFR line: every observation with S <= period <= E, null values kept (drawn as gaps).
//     Target: X0 is the later of S and the first change point's effective date (none without
//     change points). The target's points are the target in effect on X0 (R8) at x = X0, then
//     every change point with X0 < effective <= E at its effective date. Consecutive points of
//     the same kind form one segment ('rate' points a step line, 'range' points a band). A
//     segment followed by another ends with a closing point at the next segment's first x,
//     holding its own last level; the last segment ends with a closing point at E holding its
//     last level, unless its last point is already at E. Rate points are (x, value); range
//     points are (x, lower, upper).
//
// Display helpers below the rules (wording of release dates, UTC times, segment links) format
// strings only and compute no number.

import type { SegmentRef } from './econ';
import { formatDay } from './format';
import type { ChartBand, ChartLine, ChartSpec } from './ui';

/** An EFFR observation as the rules read it (econ.ts Observation satisfies it). */
export interface RatePoint {
  period: string;
  value: string | null;
}

/** A target change point as the rules read it (econ.ts ChangePoint satisfies it). */
export interface TargetPoint {
  effective: string;
  kind: 'rate' | 'range';
  value: string | null;
  lower: string | null;
  upper: string | null;
}

export interface Bounds {
  lower: string;
  upper: string;
}

// R1, R2 -----------------------------------------------------------------------------------

const DECIMAL = /^-?\d+(\.\d+)?$/;

function scaled(s: string): { n: bigint; scale: number } {
  if (!DECIMAL.test(s)) throw new Error(`not a decimal string: ${s}`);
  const neg = s.startsWith('-');
  const [int = '0', frac = ''] = (neg ? s.slice(1) : s).split('.');
  const n = BigInt(int + frac);
  return { n: neg ? -n : n, scale: frac.length };
}

/** n / 10^scale written canonically (R2): no exponent, no plus sign, no trailing zeros, never "-0". */
function canonical(n: bigint, scale: number): string {
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, '');
  const frac = digits.slice(digits.length - scale).replace(/0+$/, '');
  const out = frac ? `${int}.${frac}` : int;
  return neg && out !== '0' ? `-${out}` : out;
}

/** R2: the change from `earlier` to `later` in basis points, (later - earlier) x 100, exactly. */
export function bpChange(earlier: string, later: string): string {
  const a = scaled(earlier);
  const b = scaled(later);
  const scale = Math.max(a.scale, b.scale);
  const diff = b.n * 10n ** BigInt(scale - b.scale) - a.n * 10n ** BigInt(scale - a.scale);
  // Times 100 moves the point two places right.
  return scale >= 2 ? canonical(diff, scale - 2) : canonical(diff * 10n ** BigInt(2 - scale), 0);
}

/** R2: "+25", "-25" or "0". */
export function signedBp(bp: string): string {
  return bp === '0' || bp.startsWith('-') ? bp : `+${bp}`;
}

/** R2: "up 25 basis points", "down 1 basis point" or "unchanged". */
export function bpWords(bp: string): string {
  if (bp === '0') return 'unchanged';
  const n = bp.startsWith('-') ? bp.slice(1) : bp;
  return `${bp.startsWith('-') ? 'down' : 'up'} ${n} ${n === '1' ? 'basis point' : 'basis points'}`;
}

/** "+25 basis points", "-1 basis point", "0 basis points": the signed form with its unit. */
export function bpWithUnit(bp: string): string {
  const n = bp.startsWith('-') ? bp.slice(1) : bp;
  return `${signedBp(bp)} ${n === '1' ? 'basis point' : 'basis points'}`;
}

// R3 ---------------------------------------------------------------------------------------

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function ymd(date: string): [number, number, number] {
  const m = ISO_DAY.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** R3: `date` minus `months` months, the day kept or clamped to the end of a shorter month. */
export function monthsBack(date: string, months: number): string {
  if (!Number.isInteger(months) || months < 0) throw new Error('months must be a whole number, zero or more');
  const [y, m, d] = ymd(date);
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(Math.min(d, daysInMonth(year, month)), 2)}`;
}

/** Calendar days from `from` to `to` (dates only; whole numbers, never displayed). */
export function daysFrom(from: string, to: string): number {
  const [y1, m1, d1] = ymd(from);
  const [y2, m2, d2] = ymd(to);
  return (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000;
}

// R4, R5, R6, R7 ---------------------------------------------------------------------------

/** R4: the last observation with a value, or null. */
export function latestEffr<T extends RatePoint>(obs: readonly T[]): T | null {
  for (let i = obs.length - 1; i >= 0; i -= 1) {
    const o = obs[i];
    if (o && o.value !== null) return o;
  }
  return null;
}

/** R5: the last observation with a value whose period is before `period`, or null. */
export function previousEffr<T extends RatePoint>(obs: readonly T[], period: string): T | null {
  for (let i = obs.length - 1; i >= 0; i -= 1) {
    const o = obs[i];
    if (o && o.period < period && o.value !== null) return o;
  }
  return null;
}

/** The longest gap, in calendar days, between a comparison date and the observation used for it (R6). */
export const COMPARE_WINDOW_DAYS = 7;

export type MissingReason = 'no-earlier' | 'before-data' | 'outside-window';

/** R6: the observation for comparison date `date`, or the reason there is none. */
export function effrOnOrBefore<T extends RatePoint>(obs: readonly T[], date: string): { found: T | null; reason: MissingReason | null } {
  let found: T | null = null;
  for (let i = obs.length - 1; i >= 0 && !found; i -= 1) {
    const o = obs[i];
    if (o && o.period <= date && o.value !== null) found = o;
  }
  if (!found) return { found: null, reason: 'before-data' };
  if (daysFrom(found.period, date) > COMPARE_WINDOW_DAYS) return { found: null, reason: 'outside-window' };
  return { found, reason: null };
}

export type ComparisonId = 'previous' | 'month' | 'year' | 'five-years';

/** R7: the comparisons and how many months back each one looks (null: the previous observation). */
export const COMPARISONS: readonly { id: ComparisonId; months: number | null; label: string }[] = [
  { id: 'previous', months: null, label: 'Previous business day' },
  { id: 'month', months: 1, label: 'About one month earlier' },
  { id: 'year', months: 12, label: 'One year earlier' },
  { id: 'five-years', months: 60, label: 'Five years earlier' },
];

export interface Comparison<T extends RatePoint = RatePoint> {
  id: ComparisonId;
  label: string;
  /** The comparison date T (null for 'previous'). */
  date: string | null;
  found: T | null;
  /** The change from the compared value to the latest, in basis points (R2). */
  bp: string | null;
  reason: MissingReason | null;
}

/** R7: every comparison against the latest EFFR; empty without one. */
export function effrComparisons<T extends RatePoint>(obs: readonly T[]): Comparison<T>[] {
  const latest = latestEffr(obs);
  if (!latest || latest.value === null) return [];
  const latestValue = latest.value;
  return COMPARISONS.map(({ id, months, label }) => {
    const date = months === null ? null : monthsBack(latest.period, months);
    const { found, reason } = date === null ? previousOrReason(obs, latest.period) : effrOnOrBefore(obs, date);
    const bp = found && found.value !== null ? bpChange(found.value, latestValue) : null;
    return { id, label, date, found, bp, reason };
  });
}

function previousOrReason<T extends RatePoint>(obs: readonly T[], period: string): { found: T | null; reason: MissingReason | null } {
  const found = previousEffr(obs, period);
  return found ? { found, reason: null } : { found: null, reason: 'no-earlier' };
}

// R8, R9, R10 ------------------------------------------------------------------------------

/** R8: the change point in effect on `date`, or null before the first one. */
export function targetAt<T extends TargetPoint>(cps: readonly T[], date: string): T | null {
  for (let i = cps.length - 1; i >= 0; i -= 1) {
    const c = cps[i];
    if (c && c.effective <= date) return c;
  }
  return null;
}

/** R8: a target's bounds; a single rate is both bounds. */
export function targetBounds(cp: TargetPoint): Bounds {
  if (cp.kind === 'rate') {
    if (cp.value === null) throw new Error(`the rate change point ${cp.effective} has no value`);
    return { lower: cp.value, upper: cp.value };
  }
  if (cp.lower === null || cp.upper === null) throw new Error(`the range change point ${cp.effective} has no bounds`);
  return { lower: cp.lower, upper: cp.upper };
}

/** R9: the change of each bound from `earlier` to `later`, in basis points. */
export function targetChange(earlier: TargetPoint, later: TargetPoint): Bounds {
  const o = targetBounds(earlier);
  const n = targetBounds(later);
  return { lower: bpChange(o.lower, n.lower), upper: bpChange(o.upper, n.upper) };
}

/** R9: "+25" when both bounds moved alike, else "lower -100, upper -75". */
export function signedTargetChange(c: Bounds): string {
  return c.lower === c.upper ? signedBp(c.lower) : `lower ${signedBp(c.lower)}, upper ${signedBp(c.upper)}`;
}

/** R9 in words. */
export function targetChangeWords(c: Bounds): string {
  return c.lower === c.upper ? bpWords(c.lower) : `lower bound ${bpWords(c.lower)}, upper bound ${bpWords(c.upper)}`;
}

/** R9 with its unit: "+25 basis points" or "lower -100, upper -75 basis points". */
export function targetChangeWithUnit(c: Bounds): string {
  return c.lower === c.upper ? bpWithUnit(c.lower) : `${signedTargetChange(c)} basis points`;
}

export interface ChangePointRow<T extends TargetPoint = TargetPoint> {
  cp: T;
  bounds: Bounds;
  /** The change from the previous change point (R9); null for the first, which starts before the data. */
  change: Bounds | null;
  previous: T | null;
}

/** R10: every change point, oldest first, with its change from the one before. */
export function changePointRows<T extends TargetPoint>(cps: readonly T[]): ChangePointRow<T>[] {
  return cps.map((cp, i) => {
    const previous = i > 0 ? (cps[i - 1] ?? null) : null;
    return { cp, bounds: targetBounds(cp), change: previous ? targetChange(previous, cp) : null, previous };
  });
}

// R11 --------------------------------------------------------------------------------------

export interface ComparisonRow<T extends RatePoint = RatePoint, C extends TargetPoint = TargetPoint> {
  id: 'latest' | ComparisonId;
  label: string;
  found: T | null;
  reason: MissingReason | null;
  /** The comparison date T, for the wording of a comparison that is not shown. */
  date: string | null;
  /** The EFFR change to the latest (R7); null for the latest row. */
  bp: string | null;
  target: C | null;
  targetChange: Bounds | null;
}

/** R11: the latest row, then one per comparison; empty without a latest EFFR. */
export function comparisonTable<T extends RatePoint, C extends TargetPoint>(obs: readonly T[], cps: readonly C[]): ComparisonRow<T, C>[] {
  const latest = latestEffr(obs);
  if (!latest) return [];
  const targetNow = targetAt(cps, latest.period);
  const rows: ComparisonRow<T, C>[] = [{ id: 'latest', label: 'Latest', found: latest, reason: null, date: null, bp: null, target: targetNow, targetChange: null }];
  for (const c of effrComparisons(obs)) {
    const target = c.found ? targetAt(cps, c.found.period) : null;
    const change = target && targetNow ? targetChange(target, targetNow) : null;
    rows.push({ id: c.id, label: c.label, found: c.found, reason: c.reason, date: c.date, bp: c.bp, target, targetChange: change });
  }
  return rows;
}

// R12 --------------------------------------------------------------------------------------

/** The rows of the recent table without JavaScript (decision D12: 30 business days). */
export const RECENT_ROWS = 30;

export interface RecentRow<T extends RatePoint = RatePoint> {
  obs: T;
  previous: T | null;
  bp: string | null;
}

/** R12: the last `count` observations, newest first, each with its change from the previous one. */
export function recentRows<T extends RatePoint>(obs: readonly T[], count = RECENT_ROWS): RecentRow<T>[] {
  const out: RecentRow<T>[] = [];
  for (let i = obs.length - 1; i >= 0 && out.length < count; i -= 1) {
    const o = obs[i];
    if (!o) continue;
    const previous = previousEffr(obs, o.period);
    out.push({ obs: o, previous, bp: o.value !== null && previous && previous.value !== null ? bpChange(previous.value, o.value) : null });
  }
  return out;
}

// R13 --------------------------------------------------------------------------------------

export type RangeId = '1y' | '5y' | '10y' | 'all';

/** R13: the chart ranges, their months back from the end (null: everything) and labels. */
export const RANGES: readonly { id: RangeId; months: number | null; label: string; words: string }[] = [
  { id: '1y', months: 12, label: '1Y', words: 'one year' },
  { id: '5y', months: 60, label: '5Y', words: 'five years' },
  { id: '10y', months: 120, label: '10Y', words: 'ten years' },
  { id: 'all', months: null, label: 'All', words: 'all years' },
];

export const DEFAULT_RANGE: RangeId = '5y';

export type Segment = { kind: 'rate'; points: [string, string][] } | { kind: 'range'; points: [string, string, string][] };

export interface ChartWindow<T extends RatePoint = RatePoint> {
  start: string;
  end: string;
  x0: string | null;
  effr: T[];
  segments: Segment[];
}

const earliest = (dates: (string | undefined)[]) => dates.filter((d): d is string => d !== undefined).sort()[0];
const latestOf = (dates: (string | undefined)[]) => dates.filter((d): d is string => d !== undefined).sort().at(-1);

/** R13: the window of one chart range; null when there are neither observations nor change points. */
export function chartWindow<T extends RatePoint>(obs: readonly T[], cps: readonly TargetPoint[], range: RangeId): ChartWindow<T> | null {
  const end = latestOf([latestEffr(obs)?.period, cps.at(-1)?.effective]);
  if (end === undefined) return null;
  const months = RANGES.find((r) => r.id === range)?.months;
  if (months === undefined) throw new Error(`unknown range ${range}`);
  const start = months === null ? earliest([obs[0]?.period, cps[0]?.effective]) ?? end : monthsBack(end, months);
  const effr = obs.filter((o) => o.period >= start && o.period <= end);
  const first = cps[0];
  if (!first) return { start, end, x0: null, effr, segments: [] };
  const x0 = first.effective > start ? first.effective : start;
  const points: { x: string; cp: TargetPoint }[] = [];
  const atX0 = targetAt(cps, x0);
  if (atX0) points.push({ x: x0, cp: atX0 });
  for (const cp of cps) if (cp.effective > x0 && cp.effective <= end) points.push({ x: cp.effective, cp });
  // Consecutive points of one kind form a segment; each segment is closed where the next begins, the last one at the end.
  const segments: Segment[] = [];
  let i = 0;
  while (i < points.length) {
    const kind = points[i]?.cp.kind;
    let j = i;
    while (j < points.length && points[j]?.cp.kind === kind) j += 1;
    const run = points.slice(i, j);
    const last = run[run.length - 1];
    const closeAt = j < points.length ? points[j]?.x : end;
    if (last && closeAt !== undefined && closeAt !== last.x) run.push({ x: closeAt, cp: last.cp });
    if (kind === 'rate') segments.push({ kind: 'rate', points: run.map((p) => [p.x, targetBounds(p.cp).lower]) });
    else segments.push({ kind: 'range', points: run.map((p) => [p.x, targetBounds(p.cp).lower, targetBounds(p.cp).upper]) });
    i = j;
  }
  return { start, end, x0, effr, segments };
}

// Chart specs (the props contract of src/lib/data/ui.ts) ------------------------------------

export const EFFR_LABEL = 'EFFR (market rate, observed)';
export const TARGET_RATE_LABEL = 'FOMC target rate (policy target, single rate, derived)';
export const TARGET_RANGE_LABEL = 'FOMC target range (policy target range, derived)';

/** The chart spec of one range (decision D9: the EFFR as a line, the target as a step line or band). */
export function rateChartSpec(obs: readonly RatePoint[], cps: readonly TargetPoint[], range: RangeId, tableId?: string): ChartSpec | null {
  const w = chartWindow(obs, cps, range);
  const r = RANGES.find((x) => x.id === range);
  if (!w || !r) return null;
  const lines: ChartLine[] = [{ key: 'effr', label: EFFR_LABEL, shape: 'line', kind: 'observed', points: w.effr.map((o) => ({ x: o.period, y: o.value })) }];
  const bands: ChartBand[] = [];
  w.segments.forEach((s, n) => {
    if (s.kind === 'rate') lines.push({ key: `target-rate-${n + 1}`, label: TARGET_RATE_LABEL, shape: 'step', kind: 'derived', points: s.points.map(([x, y]) => ({ x, y })) });
    else bands.push({ key: `target-range-${n + 1}`, label: TARGET_RANGE_LABEL, kind: 'derived', points: s.points.map(([x, lower, upper]) => ({ x, lower, upper })) });
  });
  const notes = [
    `From ${formatDay(w.start)} to ${formatDay(w.end)}.`,
    'The EFFR is the rate the New York Fed publishes for each business day (observed). The FOMC target is derived by RadMage Finance from the New York Fed\'s EFFR records: a step line while it was a single rate and a band while it was a range.',
  ];
  return { id: `rates-chart-${range}`, title: `Effective federal funds rate and FOMC target, ${r.id === 'all' ? 'all years' : `the last ${r.words.replace(/^one /, '')}`}`, unitLabel: 'Percent', periodKind: 'day', lines, bands, notes, ...(tableId ? { tableId } : {}) };
}

// Display helpers (strings only) ------------------------------------------------------------

/** "3.88 percent", or "3.75 to 4.00 percent" for a range. */
export function targetText(cp: TargetPoint): string {
  const b = targetBounds(cp);
  return cp.kind === 'rate' ? `${b.lower} percent` : `${b.lower} to ${b.upper} percent`;
}

/** The release date of a value, worded by its basis (design 6.1). */
export function releaseText(released: string | null, basis: string): string {
  if (basis === 'rule' && released) return `Publication day by the New York Fed's schedule: ${formatDay(released)}`;
  if (basis === 'calendar' && released) return `Released on ${formatDay(released)}`;
  if (basis === 'first-seen' && released) return `First seen by RadMage Finance on ${formatDay(released)} (Eastern Time date)`;
  return 'Release date not recorded';
}

/** A table cell for a release date: the date for the New York Fed's schedule, "Not recorded", else the worded basis. */
export function releaseCell(released: string | null, basis: string): string {
  if (basis === 'rule' && released) return formatDay(released);
  return basis === 'not-recorded' || !released ? 'Not recorded' : releaseText(released, basis);
}

const UTC_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):\d{2}Z$/;

/** "2026-11-19T22:17:00Z" gives "November 19, 2026, 22:17 UTC". */
export function formatUtc(ts: string): string {
  const m = UTC_TIME.exec(ts);
  if (!m || !m[1]) throw new Error(`not a UTC time: ${ts}`);
  return `${formatDay(m[1])}, ${m[2]}:${m[3]} UTC`;
}

/** The segment that holds a period: its year, or 'all'. */
export function segmentOf(refs: readonly SegmentRef[], period: string): SegmentRef | null {
  return refs.find((r) => r.segment === period.slice(0, 4)) ?? refs.find((r) => r.segment === 'all') ?? null;
}

/** CSV segments newest first (design 8.5), each with a readable download name. */
export function downloads(id: string, refs: readonly SegmentRef[]): { path: string; segment: string; name: string }[] {
  return [...refs].sort((a, b) => (a.segment < b.segment ? 1 : a.segment > b.segment ? -1 : 0)).map((r) => ({ path: r.path, segment: r.segment, name: `${id}-${r.segment}.csv` }));
}

/** Why a comparison is not shown, in words. */
export function missingText(reason: MissingReason, date: string | null, firstPeriod: string | null): string {
  if (reason === 'no-earlier') return 'there is no earlier EFFR observation';
  if (reason === 'before-data') return `there is no EFFR observation on or before ${date ? formatDay(date) : 'that date'}${firstPeriod ? ` (the data begins ${formatDay(firstPeriod)})` : ''}`;
  return `there is no EFFR observation in the ${COMPARE_WINDOW_DAYS} days up to ${date ? formatDay(date) : 'that date'}`;
}
