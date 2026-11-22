// Money Supply Tracker (/finance/data/money-stock/): the rules for every number and text the
// page computes from the Federal Reserve Board's H.6 series m1-sa, m2-sa, m1-nsa and m2-nsa.
// Owner brief Q (docs/P36_V020_PARALLEL_DASHBOARDS.md), Agent 2. Design P28 rule 8.1 said "no
// derived numbers in the first version"; brief Q asks for changes, so every computed number here
// is labeled "Computed by RadMage Finance" with its formula, as 8.1 requires for later versions.
//
// RULES (written before the code; the Python oracle tests/oracle/econ_money.py is written from
// these rules alone and its output tests/oracle/fixtures/econ-money.json checks this module).
//
// M1. Values. A value is the decimal string the CSV holds (H.6: billions of dollars, monthly
//     average, one decimal place). No displayed number ever goes through floating point.
//
// M2. Months. A month is written YYYY-MM. "N months before" a month counts calendar months back:
//     1 month before 2026-01 is 2025-12, 12 months before 2026-10 is 2025-10, 120 months before
//     2026-10 is 2016-10. A month is written in words as "October 2026".
//
// M3. A series is its rows in period order. A month is "absent" when no row has that period. A
//     row is "missing" when it carries a missing code or has an empty value; a missing row is
//     never treated as zero and never filled from a neighbor.
//
// M4. Missing codes (H.6 OBS_STATUS, design 7.6): NA is "Not available", ND is "No data", NC is
//     "Not calculable"; any other code is "Missing". A missing value is shown as "<text>
//     (<code>)": "Not available (NA)", or "Missing (XX)" for an unknown code XX. An empty value
//     without a code (an empty code counts as none) is shown as "Missing" alone.
//
// M5. The current month of a series is its last row. If that row is missing, the page says so
//     (M4) and shows no change ending in that month; it never falls back silently to an earlier
//     month.
//
// M6. A change compares a later month L with the earlier month E = L minus N months: N = 1 for
//     month over month, N = 12 for year over year, and N = 12, 60 and 120 for the comparison
//     table (a year, five and ten years earlier). E is always that calendar month, never the
//     nearest available one.
//
// M7. A change is not computed, and neither its dollars nor its percent is shown, when the first
//     of these applies, checked in this order (the reason code is in brackets):
//       a. L is absent [later-absent];
//       b. L is missing [later-missing];
//       c. E is absent [earlier-absent];
//       d. E is missing [earlier-missing];
//       e. a definition break of the series lies between them: a break month B with E < B <= L
//          [break] (M11).
//     The reason is shown in its place (M10).
//
// M8. The dollar change is L minus E, exactly, as a decimal string with as many decimal places
//     as the longer fractional part of the two values: 20073.6 minus 21264.9 is -1191.3; 100
//     minus 99.95 is 0.05; equal values give 0.0 (never -0.0).
//
// M9. The percent change is 100 times (L minus E) divided by E, computed exactly as a fraction,
//     then rounded to exactly two decimal places, half away from zero: an exact tie rounds away
//     from zero, so 0.125 becomes 0.13 and -0.125 becomes -0.13. A result that rounds to zero is
//     0.00 with no sign. It is computed only when E is above zero; otherwise the dollar change is
//     still shown and the percent is not, with the reason "earlier-not-positive".
//
// M10. Wording and display.
//     - A level: "$20,073.6 billion" (digits grouped with commas). In a table cell, where the
//       unit is in the column header: "20,073.6".
//     - A dollar change: "+$106.3 billion", "-$1,191.3 billion", or "$0.0 billion" for zero (no
//       sign). In a table cell: "+106.3", "-1,191.3", "0.0".
//     - A percent change: "+0.53 percent", "-5.60 percent", "0.00 percent", with the digits
//       grouped like a level ("+1,234.50 percent"). In a table cell: "+0.53", "-5.60", "0.00",
//       "+1,234.50".
//     - Direction, from the sign of the exact dollar change (never from the rounded percent):
//       above zero "grew", below zero "shrank", zero "was unchanged", in the sentence "The M1
//       money stock grew from September 2026 to October 2026." The short tag is "Grew",
//       "Shrank" or "Unchanged". It is always words, never color alone.
//     - The reason a change is not computed, as a sentence (from and to are months in words):
//         later-absent:    "There is no observation for <to>."
//         later-missing:   "<to> has no published value: <missing text>."
//         earlier-absent:  "There is no observation for <from>." When <from> is before the
//                          series' first row, add " The data start in <first month>." with the
//                          first month in words.
//         earlier-missing: "<from> has no published value: <missing text>."
//         break:           "The H.6 definition of <measure> changed in <break month>, so <from>
//                          and <to> are not comparable."
//         earlier-not-positive (percent only): "The earlier value is not above zero, so no
//                          percent change is computed."
//       In a table cell: "Not computed (no observation)" for later-absent and earlier-absent,
//       "Not computed (missing month)" for later-missing and earlier-missing, "Not computed
//       (definition change)" for break, "Not computed (earlier value not above zero)" for
//       earlier-not-positive.
//     <missing text> is the M4 display, for example "Not available (NA)".
//
// M11. Definition breaks. The H.6 registry has no field for definition changes, so this module
//     lists them (H6_BREAKS), each quoted from the Board: from May 2020 (break month 2020-05)
//     savings deposits count in M1 (m1-sa and m1-nsa); M2 is unchanged. Values on both sides are
//     shown as published. The chart draws M1 as one line up to the month before the break and a
//     separate line from the break month on, each labeled with its definition. A change across
//     a break is not computed (M7e). Any known_inconsistencies the registry copy holds for a
//     series are shown as published notes.
//
// M12. Subject to revision (design 8.3, P22 2.4). The last two rows of each series are marked
//     "subject to revision", without claiming which values the Board estimated.
//
// M13. Release wording (design 6.1), by released_basis: calendar "H.6 release of November 24,
//     2026"; rule "Publication day by the New York Fed's schedule: <date>"; first-seen "First seen
//     by RadMage Finance on <date> (Eastern Time date)" (the ET date of the snapshot that first
//     held the value, conventions 6.3); not-recorded, or any row without a date, "Release date not
//     recorded"; any other basis with a date, the date in words. Dates in words: "November 24,
//     2026".
//
// M14. The recent table (decision D12: 24 months without JavaScript) holds the last 24 rows of a
//     series (all of them when there are fewer), newest first. Each row: the month in words,
//     followed by " (subject to revision)" for the M12 months and " (first month of a new
//     definition)" for a break month, in that order when both apply; the value cell (M10, or the
//     M4 display for a missing row); the month over month dollar and percent cells (M7 to M10);
//     the release wording (M13).
//
// M15. The comparison table compares the current month with 12, 60 and 120 months earlier,
//     labeled "1 year earlier", "5 years earlier" and "10 years earlier". Each row: the label, the
//     earlier month in words, its value cell ("No observation" when absent, the M4 display when
//     missing), and the dollar and percent cells of the change to the current month (M7 to M10).
//
// M16. Dates of detection in the revision log (design 6.4) are the America/New_York date of the
//     UTC time detected_at: Eastern daylight time (UTC minus 4 hours) from 2:00 a.m. local time on
//     the second Sunday in March to 2:00 a.m. local time on the first Sunday in November, Eastern
//     standard time (UTC minus 5 hours) otherwise.
//
// M17. Revision rows are shown in log order with: the detection date (M16), the month in words,
//     the field ("Value" for value, "Whole month" for period, else the field name as given), the
//     before and after texts (a value grouped as in M10; for a whole month, "Month with value
//     <grouped value>" when the text is an observation with a value; an empty text "None";
//     anything else as given), the kind ("Expected", "Approved after review" for approved-hold,
//     "Rollback", else as given), the basis as given, and the release date in words or "None".
//
// The module is pure: no file system and no network. Inputs are the shared readers' types.

import type { EconDataset, Observation, RevisionRow } from './econ';
import { observations, seriesInfo } from './econ';
import { formatDay, formatMonth, groupDigits } from './format';

/** The four H.6 series of the page, by measure and adjustment. */
export const MONEY_SERIES = {
  sa: { m1: 'm1-sa', m2: 'm2-sa' },
  nsa: { m1: 'm1-nsa', m2: 'm2-nsa' },
} as const;
export type Adjustment = keyof typeof MONEY_SERIES;
export type Measure = 'M1' | 'M2';

/** A definition change of a measure (M11). */
export interface DefinitionBreak {
  measure: Measure;
  /** The first month under the new definition. */
  period: string;
  series: readonly string[];
  /** Plain statement for the page. */
  summary: string;
  /** The Board's own words, quoted exactly. */
  quote: string;
  source: { publisher: string; title: string; date: string; url: string; checked: string };
}

/** The H.6 definition changes the page states (M11), quoted from the Board, checked 2026-11-21. */
export const H6_BREAKS: readonly DefinitionBreak[] = [
  {
    measure: 'M1',
    period: '2020-05',
    series: ['m1-sa', 'm1-nsa'],
    summary:
      'From May 2020, the Board counts savings deposits in M1, as part of "other liquid deposits". A change to Regulation D announced on April 24, 2020 deleted the six-per-month limit on transfers from savings deposits, so the Board now treats them as transaction accounts. The change was announced on December 17, 2020 and applied in the first monthly H.6 release on February 23, 2021, back to the May 2020 figures. It raised M1 by the whole amount of savings deposits and left M2 unchanged: savings deposits were already counted in M2.',
    quote:
      'Recognizing savings deposits as a transaction account as of May 2020 will cause a series break in the M1 monetary aggregate. Beginning with the May 2020 observation, M1 will increase by the size of the industry total of savings deposits, which amounted to approximately $11.2 trillion. M2 will remain unchanged.',
    source: {
      publisher: 'Board of Governors of the Federal Reserve System',
      title: 'H.6 Release Technical Q&As (question posted December 17, 2020)',
      date: 'last updated July 28, 2026',
      url: 'https://www.federalreserve.gov/releases/h6/h6_technical_qa.htm',
      checked: '2026-11-21',
    },
  },
];

/** A source the page cites, checked on SOURCES_CHECKED. */
export interface PageSource {
  id: string;
  publisher: string;
  title: string;
  date: string;
  url: string;
}

/** The date (ET) on which every source below was read and its quotations checked (owner brief R item 5). */
export const SOURCES_CHECKED = '2026-11-21';

/** The sources of the page's written explanation, in citation order (numbered from 1). */
export const MONEY_SOURCES: readonly PageSource[] = [
  { id: 'h6-release', publisher: 'Board of Governors of the Federal Reserve System', title: 'H.6 Money Stock Measures', date: 'the release of October 27, 2026', url: 'https://www.federalreserve.gov/releases/h6/20261027/' },
  { id: 'h6-about', publisher: 'Board of Governors of the Federal Reserve System', title: 'About the H.6 release, Money Stock Measures', date: 'last updated March 23, 2021', url: 'https://www.federalreserve.gov/releases/h6/about.htm' },
  { id: 'h6-qa', publisher: 'Board of Governors of the Federal Reserve System', title: 'H.6 Release Technical Q&As', date: 'last updated July 28, 2026', url: 'https://www.federalreserve.gov/releases/h6/h6_technical_qa.htm' },
  { id: 'fed-money-supply', publisher: 'Board of Governors of the Federal Reserve System', title: 'What is the money supply? Is it important?', date: 'last updated July 19, 2024', url: 'https://www.federalreserve.gov/faqs/money_12845.htm' },
  { id: 'fed-faq-inflation', publisher: 'Board of Governors of the Federal Reserve System', title: 'What is inflation, and how does the Federal Reserve evaluate changes in the rate of inflation?', date: 'last updated August 22, 2025', url: 'https://www.federalreserve.gov/faqs/economy_14419.htm' },
];

/** The citation number of a source. */
export function sourceNumber(id: string): number {
  const n = MONEY_SOURCES.findIndex((s) => s.id === id);
  if (n < 0) throw new Error(`money: unknown source ${id}`);
  return n + 1;
}

// ---------------------------------------------------------------------------------------------
// Exact decimal arithmetic (M1, M8, M9)

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A decimal string as an integer and its number of decimal places. */
function scaled(s: string): { n: bigint; places: number } {
  if (!DECIMAL.test(s)) throw new Error(`not a decimal string: ${s}`);
  const neg = s.startsWith('-');
  const [int = '0', frac = ''] = (neg ? s.slice(1) : s).split('.');
  const n = BigInt(int + frac);
  return { n: neg ? -n : n, places: frac.length };
}

/** Writes an integer count of 10^-places as a decimal string; zero never carries a sign. */
function unscale(n: bigint, places: number): string {
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(places + 1, '0');
  const out = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
  return neg ? `-${out}` : out;
}

/** Both values on a common scale: the longer fractional part of the two (M8). */
function common(a: string, b: string): { a: bigint; b: bigint; places: number } {
  const x = scaled(a);
  const y = scaled(b);
  const places = Math.max(x.places, y.places);
  return { a: x.n * 10n ** BigInt(places - x.places), b: y.n * 10n ** BigInt(places - y.places), places };
}

/** M8: later minus earlier, exactly. */
export function dollarChange(later: string, earlier: string): string {
  const { a, b, places } = common(later, earlier);
  return unscale(a - b, places);
}

/** M9: 100 (later - earlier) / earlier, rounded half away from zero to two places; null when earlier is not above zero. */
export function percentChange(later: string, earlier: string): string | null {
  const { a, b } = common(later, earlier);
  if (b <= 0n) return null;
  const diff = a - b;
  const magnitude = (diff < 0n ? -diff : diff) * 10_000n;
  const hundredths = (2n * magnitude + b) / (2n * b);
  return unscale(diff < 0n ? -hundredths : hundredths, 2);
}

/** The sign of a decimal string: -1, 0 or 1. */
function signOf(s: string): -1 | 0 | 1 {
  const { n } = scaled(s);
  return n > 0n ? 1 : n < 0n ? -1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Months (M2)

const MONTH = /^(\d{4})-(\d{2})$/;

/** M2: the month `months` calendar months before `period`. */
export function monthsBefore(period: string, months: number): string {
  const m = MONTH.exec(period);
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12 || !Number.isInteger(months) || months < 0) throw new Error(`monthsBefore(${period}, ${months})`);
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) - months;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------
// Missing values (M3, M4)

const CODE_TEXT: Record<string, string> = { NA: 'Not available', ND: 'No data', NC: 'Not calculable' };

/** M4: an empty code counts as none. */
const hasCode = (code: string | null): code is string => code !== null && code !== '';

/** M3: a row is missing when it carries a code or has no value. */
export function isMissing(row: { value: string | null; missingCode: string | null }): boolean {
  return hasCode(row.missingCode) || row.value === null;
}

/** M4: the display of a missing value, for example "Not available (NA)". */
export function missingText(code: string | null): string {
  if (!hasCode(code)) return 'Missing';
  const text = CODE_TEXT[code];
  return text ? `${text} (${code})` : `Missing (${code})`;
}

// ---------------------------------------------------------------------------------------------
// Display (M10, M13)

/** M10: "$20,073.6 billion". */
export function levelText(value: string): string {
  return `$${groupDigits(value)} billion`;
}

/** M10: "20,073.6" (the unit is in the column header). */
export function levelCell(value: string): string {
  return groupDigits(value);
}

function signed(s: string): { sign: string; abs: string } {
  const sg = signOf(s);
  return { sign: sg > 0 ? '+' : sg < 0 ? '-' : '', abs: groupDigits(s.startsWith('-') ? s.slice(1) : s) };
}

/** M10: "+$106.3 billion", "-$1,191.3 billion", "$0.0 billion". */
export function dollarsText(dollars: string): string {
  const { sign, abs } = signed(dollars);
  return `${sign}$${abs} billion`;
}

/** M10: "+106.3", "-1,191.3", "0.0". */
export function dollarsCell(dollars: string): string {
  const { sign, abs } = signed(dollars);
  return `${sign}${abs}`;
}

/** M10: "+0.53 percent", "-5.60 percent", "0.00 percent". */
export function percentText(percent: string): string {
  return `${percentCell(percent)} percent`;
}

/** M10: "+0.53", "-5.60", "0.00". */
export function percentCell(percent: string): string {
  const { sign, abs } = signed(percent);
  return `${sign}${abs}`;
}

/** M13: the release wording of a row, by its basis. */
export function releasedText(released: string | null, basis: string): string {
  if (released === null || basis === 'not-recorded') return 'Release date not recorded';
  const day = formatDay(released);
  if (basis === 'calendar') return `H.6 release of ${day}`;
  if (basis === 'rule') return `Publication day by the New York Fed's schedule: ${day}`;
  if (basis === 'first-seen') return `First seen by RadMage Finance on ${day} (Eastern Time date)`;
  return day;
}

/** A UTC time in words: "2026-11-25T15:17:00Z" gives "November 25, 2026, 15:17 UTC". */
export function formatUtc(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):\d{2}Z$/.exec(iso);
  if (!m || !m[1]) throw new Error(`not a UTC time: ${iso}`);
  return `${formatDay(m[1])}, ${m[2]}:${m[3]} UTC`;
}

// ---------------------------------------------------------------------------------------------
// Changes (M5 to M10)

export type NotComputedReason = 'later-absent' | 'later-missing' | 'earlier-absent' | 'earlier-missing' | 'break';
export type Direction = 'grew' | 'shrank' | 'unchanged';

export interface Computed {
  ok: true;
  from: string;
  to: string;
  dollars: string;
  dollarsText: string;
  dollarsCell: string;
  percent: string | null;
  percentText: string | null;
  percentCell: string;
  percentReason: 'earlier-not-positive' | null;
  percentReasonText: string | null;
  direction: Direction;
  tag: 'Grew' | 'Shrank' | 'Unchanged';
  sentence: string;
}

export interface NotComputed {
  ok: false;
  from: string;
  to: string;
  reason: NotComputedReason;
  reasonText: string;
  cell: string;
}

export type ChangeResult = Computed | NotComputed;

/** The fields of a row that the rules read. */
export interface MonthRow {
  period: string;
  value: string | null;
  missingCode: string | null;
  released?: string | null;
  releasedBasis?: string;
}

const CELL: Record<NotComputedReason | 'earlier-not-positive', string> = {
  'later-absent': 'Not computed (no observation)',
  'earlier-absent': 'Not computed (no observation)',
  'later-missing': 'Not computed (missing month)',
  'earlier-missing': 'Not computed (missing month)',
  break: 'Not computed (definition change)',
  'earlier-not-positive': 'Not computed (earlier value not above zero)',
};
const NOT_POSITIVE = 'The earlier value is not above zero, so no percent change is computed.';
const TAG = { grew: 'Grew', shrank: 'Shrank', unchanged: 'Unchanged' } as const;

/** Rows by period, for the lookups of M7. */
export function byPeriod<T extends MonthRow>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.period, r]));
}

/** M7 to M10: the change of a series from `months` months before `to` to `to`. */
export function computeChange(rows: readonly MonthRow[], to: string, months: number, measure: Measure, breaks: readonly string[], index: Map<string, MonthRow> = byPeriod(rows)): ChangeResult {
  const from = monthsBefore(to, months);
  const later = index.get(to);
  const earlier = index.get(from);
  const no = (reason: NotComputedReason, reasonText: string): NotComputed => ({ ok: false, from, to, reason, reasonText, cell: CELL[reason] });
  if (!later) return no('later-absent', `There is no observation for ${formatMonth(to)}.`);
  if (isMissing(later)) return no('later-missing', `${formatMonth(to)} has no published value: ${missingText(later.missingCode)}.`);
  if (!earlier) {
    const first = rows[0]?.period;
    const start = first !== undefined && from < first ? ` The data start in ${formatMonth(first)}.` : '';
    return no('earlier-absent', `There is no observation for ${formatMonth(from)}.${start}`);
  }
  if (isMissing(earlier)) return no('earlier-missing', `${formatMonth(from)} has no published value: ${missingText(earlier.missingCode)}.`);
  const broken = breaks.find((b) => from < b && b <= to);
  if (broken !== undefined) return no('break', `The H.6 definition of ${measure} changed in ${formatMonth(broken)}, so ${formatMonth(from)} and ${formatMonth(to)} are not comparable.`);
  const dollars = dollarChange(later.value as string, earlier.value as string);
  const percent = percentChange(later.value as string, earlier.value as string);
  const sg = signOf(dollars);
  const direction: Direction = sg > 0 ? 'grew' : sg < 0 ? 'shrank' : 'unchanged';
  return {
    ok: true,
    from,
    to,
    dollars,
    dollarsText: dollarsText(dollars),
    dollarsCell: dollarsCell(dollars),
    percent,
    percentText: percent === null ? null : percentText(percent),
    percentCell: percent === null ? CELL['earlier-not-positive'] : percentCell(percent),
    percentReason: percent === null ? 'earlier-not-positive' : null,
    percentReasonText: percent === null ? NOT_POSITIVE : null,
    direction,
    tag: TAG[direction],
    sentence: `The ${measure} money stock ${direction === 'unchanged' ? 'was unchanged' : direction} from ${formatMonth(from)} to ${formatMonth(to)}.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Current month, revision window, tables (M5, M12, M14, M15)

export interface Current {
  period: string;
  value: string | null;
  missingCode: string | null;
  text: string;
}

/** M5: the last row of the series, or null when it has none. */
export function currentMonth(rows: readonly MonthRow[]): Current | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  return { period: last.period, value: last.value, missingCode: last.missingCode, text: isMissing(last) ? missingText(last.missingCode) : levelText(last.value as string) };
}

/** M12: the periods of the last two rows. */
export function revisionWindow(rows: readonly MonthRow[]): string[] {
  return rows.slice(-2).map((r) => r.period);
}

export interface RecentRow {
  period: string;
  month: string;
  value: string;
  change: string;
  percent: string;
  released: string;
}

/** M14: the last `count` rows, newest first, with their month over month change. */
export function recentRows(rows: readonly MonthRow[], measure: Measure, breaks: readonly string[], count = 24): RecentRow[] {
  const index = byPeriod(rows);
  const window = new Set(revisionWindow(rows));
  return rows
    .slice(-count)
    .reverse()
    .map((r) => {
      const c = computeChange(rows, r.period, 1, measure, breaks, index);
      const month = formatMonth(r.period) + (window.has(r.period) ? ' (subject to revision)' : '') + (breaks.includes(r.period) ? ' (first month of a new definition)' : '');
      return {
        period: r.period,
        month,
        value: isMissing(r) ? missingText(r.missingCode) : levelCell(r.value as string),
        change: c.ok ? c.dollarsCell : c.cell,
        percent: c.ok ? c.percentCell : c.cell,
        released: releasedText(r.released ?? null, r.releasedBasis ?? 'not-recorded'),
      };
    });
}

export interface ComparisonRow {
  label: string;
  months: number;
  period: string;
  month: string;
  value: string;
  change: string;
  percent: string;
}

export const COMPARISONS = [
  { months: 12, label: '1 year earlier' },
  { months: 60, label: '5 years earlier' },
  { months: 120, label: '10 years earlier' },
] as const;

/** M15: the current month against 1, 5 and 10 years earlier. */
export function comparisonRows(rows: readonly MonthRow[], measure: Measure, breaks: readonly string[]): ComparisonRow[] {
  const current = currentMonth(rows);
  if (!current) return [];
  const index = byPeriod(rows);
  return COMPARISONS.map(({ months, label }) => {
    const period = monthsBefore(current.period, months);
    const row = index.get(period);
    const c = computeChange(rows, current.period, months, measure, breaks, index);
    return {
      label,
      months,
      period,
      month: formatMonth(period),
      value: !row ? 'No observation' : isMissing(row) ? missingText(row.missingCode) : levelCell(row.value as string),
      change: c.ok ? c.dollarsCell : c.cell,
      percent: c.ok ? c.percentCell : c.cell,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Breaks and charts (M11)

/** The break months of a series (M11). */
export function breaksFor(seriesId: string): string[] {
  return H6_BREAKS.filter((b) => b.series.includes(seriesId)).map((b) => b.period);
}

/** The measure of a series id. */
export function measureOf(seriesId: string): Measure {
  if (seriesId.startsWith('m1-')) return 'M1';
  if (seriesId.startsWith('m2-')) return 'M2';
  throw new Error(`not an H.6 money series: ${seriesId}`);
}

export interface LineDraft {
  key: string;
  label: string;
  points: { x: string; y: string | null }[];
}

/** M11: the chart lines of a measure, one per definition, with gaps for missing rows. */
export function definitionLines(rows: readonly MonthRow[], measure: Measure, breaks: readonly string[]): LineDraft[] {
  const key = measure.toLowerCase();
  const point = (r: MonthRow) => ({ x: r.period, y: isMissing(r) ? null : r.value });
  if (breaks.length === 0) return [{ key, label: measure, points: rows.map(point) }];
  const edges = [...breaks].sort();
  const lines: LineDraft[] = [];
  for (let i = 0; i <= edges.length; i += 1) {
    const start = i === 0 ? null : (edges[i - 1] ?? null);
    const end = i === edges.length ? null : (edges[i] ?? null);
    const part = rows.filter((r) => (start === null || r.period >= start) && (end === null || r.period < end));
    if (part.length === 0) continue;
    const label = start === null && end !== null ? `${measure}, definition before ${formatMonth(end)}` : `${measure}, definition from ${formatMonth(start ?? '')}`;
    lines.push({ key: `${key}-${start ?? 'start'}`, label, points: part.map(point) });
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The revision log (M16, M17)

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/** M16: the America/New_York date of a UTC time. */
export function etDate(utc: string): string {
  if (!UTC.test(utc)) throw new Error(`not a UTC time: ${utc}`);
  return ET_DATE.format(new Date(utc));
}

export interface RevisionDisplay {
  detected: string;
  month: string;
  field: string;
  before: string;
  after: string;
  kind: string;
  basis: string;
  releaseDate: string;
}

const KIND: Record<string, string> = { expected: 'Expected', 'approved-hold': 'Approved after review', rollback: 'Rollback' };

function revisionText(field: string, text: string): string {
  if (text === '') return 'None';
  if (field === 'value' && DECIMAL.test(text)) return groupDigits(text);
  if (field === 'period') {
    try {
      const parsed: unknown = JSON.parse(text);
      const value = parsed !== null && typeof parsed === 'object' ? (parsed as { value?: unknown }).value : undefined;
      if (typeof value === 'string' && DECIMAL.test(value)) return `Month with value ${groupDigits(value)}`;
    } catch {
      // Not JSON: shown as given.
    }
  }
  return text;
}

/** M17: the revision rows of a series as display strings, in log order. */
export function revisionDisplay(rows: readonly RevisionRow[]): RevisionDisplay[] {
  return rows.map((r) => ({
    detected: formatDay(etDate(r.detectedAt)),
    month: MONTH.test(r.period) ? formatMonth(r.period) : r.period,
    field: r.field === 'value' ? 'Value' : r.field === 'period' ? 'Whole month' : r.field,
    before: revisionText(r.field, r.before),
    after: revisionText(r.field, r.after),
    kind: KIND[r.kind] ?? r.kind,
    basis: r.basis,
    releaseDate: r.releaseDate ? formatDay(r.releaseDate) : 'None',
  }));
}

// ---------------------------------------------------------------------------------------------
// Reading the dataset (build time and tests; only through the shared readers)

export interface RegistryNotes {
  /** Publisher data kept as published that would otherwise fail a rule (registry known_inconsistencies). */
  inconsistencies: { period: string; text: string }[];
  /** The release calendar's text (the provider's statement) and the date its dates are valid from. */
  calendarText: string | null;
  calendarValidFrom: string | null;
  /** Days after the deadline of the next value (the expected release plus the grace hours) when the series counts as stale. */
  staleAfterDays: number | null;
  /** The hours after the expected release time before the next value counts as late (the calendar's grace_hours). */
  graceHours: number | null;
  /** The longest gap the registry accepts, for example 1 month. */
  maxGap: { gap: number; unit: string } | null;
}

/** The registry copy that the manifest names (rules.registry), parsed; null when it names none. */
export function registryCopy(ds: EconDataset): Record<string, unknown> | null {
  const ref = ds.manifest.rules?.registry as { path?: unknown } | undefined;
  // The dataset of amendment 1 (a manifest/3, no rule files): the registry the build supplies (22.8).
  if (!ref || typeof ref.path !== 'string') return ds.compat ? (JSON.parse(ds.compat.registryText) as Record<string, unknown>) : null;
  return JSON.parse(ds.readText(ref.path)) as Record<string, unknown>;
}

/** M11: the notes of one series in the registry copy. */
export function registryNotes(registry: Record<string, unknown> | null, seriesId: string): RegistryNotes {
  const none: RegistryNotes = { inconsistencies: [], calendarText: null, calendarValidFrom: null, staleAfterDays: null, graceHours: null, maxGap: null };
  if (!registry || !Array.isArray(registry.series)) return none;
  const s = (registry.series as Record<string, unknown>[]).find((x) => x.id === seriesId);
  if (!s) return none;
  const ki = Array.isArray(s.known_inconsistencies) ? (s.known_inconsistencies as { period?: unknown; text?: unknown }[]) : [];
  const release = s.release as { calendar?: unknown } | undefined;
  const calendars = (registry.calendars ?? {}) as Record<string, { text?: unknown; calendar_valid_from?: unknown; grace_hours?: unknown } | undefined>;
  const cal = typeof release?.calendar === 'string' ? calendars[release.calendar] : undefined;
  const staleness = s.staleness as { after_days_past_expected_release?: unknown } | undefined;
  const continuity = s.continuity as { max_gap?: unknown; unit?: unknown } | undefined;
  return {
    inconsistencies: ki.flatMap((k) => (typeof k.period === 'string' && typeof k.text === 'string' ? [{ period: k.period, text: k.text }] : [])),
    calendarText: typeof cal?.text === 'string' ? cal.text : null,
    calendarValidFrom: typeof cal?.calendar_valid_from === 'string' ? cal.calendar_valid_from : null,
    staleAfterDays: typeof staleness?.after_days_past_expected_release === 'number' ? staleness.after_days_past_expected_release : null,
    graceHours: typeof cal?.grace_hours === 'number' ? cal.grace_hours : null,
    maxGap: typeof continuity?.max_gap === 'number' && typeof continuity.unit === 'string' ? { gap: continuity.max_gap, unit: continuity.unit } : null,
  };
}

export interface MeasureView {
  seriesId: string;
  measure: Measure;
  title: string;
  rows: Observation[];
  breaks: string[];
  current: Current | null;
  monthOverMonth: ChangeResult | null;
  yearOverYear: ChangeResult | null;
  revisionWindow: string[];
  recent: RecentRow[];
  comparisons: ComparisonRow[];
  /** The newest segment's retrieval time, and when the series was last confirmed unchanged. */
  retrievedAt: string | null;
  checkedAt: string | null;
}

/** Everything the page shows for one series, computed from the dataset by the rules above. */
export function measureView(ds: EconDataset, seriesId: string): MeasureView {
  const info = seriesInfo(ds, seriesId);
  const rows = observations(ds, seriesId);
  const measure = measureOf(seriesId);
  const breaks = breaksFor(seriesId);
  const current = currentMonth(rows);
  const index = byPeriod(rows);
  const segments = [...info.csvs].sort((a, b) => (a.segment < b.segment ? -1 : a.segment > b.segment ? 1 : 0));
  return {
    seriesId,
    measure,
    title: info.title,
    rows,
    breaks,
    current,
    monthOverMonth: current ? computeChange(rows, current.period, 1, measure, breaks, index) : null,
    yearOverYear: current ? computeChange(rows, current.period, 12, measure, breaks, index) : null,
    revisionWindow: revisionWindow(rows),
    recent: recentRows(rows, measure, breaks),
    comparisons: comparisonRows(rows, measure, breaks),
    retrievedAt: segments[segments.length - 1]?.retrieved_at ?? info.retrieved_at,
    checkedAt: info.checked_at,
  };
}
