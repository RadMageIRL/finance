// Mutants of the Money Supply Tracker rules (src/lib/data/money.ts, rules M1 to M17; brief Q,
// Agent 2). Each is [id, file, find, replace]; `find` occurs exactly once in the file. The unit
// tests (tests/unit/data/money.test.ts, against tests/oracle/fixtures/econ-money.json and the
// fixture dataset) must fail for every one.
const F = 'src/lib/data/money.ts';

export const MUTANTS = [
  // M9: percent rounding, half away from zero at two places, and no percent for E <= 0.
  ['data-money-percent-truncates', F, 'const hundredths = (2n * magnitude + b) / (2n * b);', 'const hundredths = magnitude / b;'],
  ['data-money-percent-ties-toward-zero', F, 'const hundredths = (2n * magnitude + b) / (2n * b);', 'const hundredths = (2n * magnitude + b - 1n) / (2n * b);'],
  ['data-money-percent-zero-earlier', F, 'if (b <= 0n) return null;', 'if (b < 0n) return null;'],
  // M8: exact difference at the longer number of places, never negative zero.
  ['data-money-diff-shorter-places', F, 'const places = Math.max(x.places, y.places);', 'const places = Math.min(x.places, y.places);'],
  ['data-money-negative-zero', F, 'const neg = n < 0n;', 'const neg = n <= 0n;'],
  // M2: calendar months back across a year boundary.
  ['data-money-months-off-by-one', F, "String((index % 12) + 1).padStart(2, '0')", "String((index % 12) + 2).padStart(2, '0')"],
  // M3 and M4: a value with a code is missing; the codelist texts.
  ['data-money-code-ignored', F, 'return hasCode(row.missingCode) || row.value === null;', 'return row.value === null;'],
  ['data-money-codelist-swapped', F, "ND: 'No data', NC: 'Not calculable'", "ND: 'Not calculable', NC: 'No data'"],
  // M7e and M11: the break month is the first month of the new definition.
  ['data-money-break-exclusive', F, 'const broken = breaks.find((b) => from < b && b <= to);', 'const broken = breaks.find((b) => from < b && b < to);'],
  ['data-money-break-earlier-inclusive', F, 'const broken = breaks.find((b) => from < b && b <= to);', 'const broken = breaks.find((b) => from <= b && b <= to);'],
  ['data-money-chart-split-overlaps', F, '(end === null || r.period < end)', '(end === null || r.period <= end)'],
  // M10: direction from the exact dollar change, never the rounded percent.
  ['data-money-direction-from-percent', F, 'const sg = signOf(dollars);', 'const sg = percent === null ? signOf(dollars) : signOf(percent);'],
  // M12 and M14: the latest two months, 24 rows newest first.
  ['data-money-revision-window-one', F, 'return rows.slice(-2).map((r) => r.period);', 'return rows.slice(-1).map((r) => r.period);'],
  ['data-money-recent-30-rows', F, 'breaks: readonly string[], count = 24)', 'breaks: readonly string[], count = 30)'],
  ['data-money-recent-oldest-first', F, '.reverse()', '.slice()'],
  ['data-money-revision-mark-dropped', F, "(window.has(r.period) ? ' (subject to revision)' : '')", "''"],
  // M15: five years is 60 months.
  ['data-money-five-years-72', F, "{ months: 60, label: '5 years earlier' }", "{ months: 72, label: '5 years earlier' }"],
  // M13: a not-recorded basis never shows a date.
  ['data-money-not-recorded-dated', F, "if (released === null || basis === 'not-recorded')", 'if (released === null)'],
  // M16: detection dates are Eastern time dates.
  ['data-money-et-date-utc', F, "timeZone: 'America/New_York'", "timeZone: 'UTC'"],
  // M13: a first-seen date is an Eastern Time date, labeled so (owner briefs R and T).
  ['data-money-first-seen-unlabeled', F, 'return `First seen by RadMage Finance on ${day} (Eastern Time date)`;', 'return `First seen by RadMage Finance on ${day}`;'],
];
