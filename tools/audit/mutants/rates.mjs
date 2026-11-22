// Mutants of the Interest Rate Tracker's calculations (src/lib/data/rates.ts, rules R2 to R13),
// read by tools/audit/mutate.mjs. Each entry is [id, file, find, replace]; `find` occurs exactly
// once in the file. tests/unit/data/rates.test.ts must fail for every one.
const F = 'src/lib/data/rates.ts';

export const MUTANTS = [
  // R2: basis points are (later - earlier) x 100, exactly and canonically.
  ['data-rates-bp-reversed', F, 'const diff = b.n * 10n ** BigInt(scale - b.scale) - a.n * 10n ** BigInt(scale - a.scale);', 'const diff = a.n * 10n ** BigInt(scale - a.scale) - b.n * 10n ** BigInt(scale - b.scale);'],
  ['data-rates-bp-times-ten', F, 'return scale >= 2 ? canonical(diff, scale - 2) : canonical(diff * 10n ** BigInt(2 - scale), 0);', 'return scale >= 1 ? canonical(diff, scale - 1) : canonical(diff * 10n, 0);'],
  ['data-rates-bp-trailing-zeros-kept', F, "const frac = digits.slice(digits.length - scale).replace(/0+$/, '');", 'const frac = digits.slice(digits.length - scale);'],
  ['data-rates-signed-plus-zero', F, "return bp === '0' || bp.startsWith('-') ? bp : `+${bp}`;", "return bp.startsWith('-') ? bp : `+${bp}`;"],
  ['data-rates-words-never-singular', F, "return `${bp.startsWith('-') ? 'down' : 'up'} ${n} ${n === '1' ? 'basis point' : 'basis points'}`;", "return `${bp.startsWith('-') ? 'down' : 'up'} ${n} basis points`;"],
  // R3: months back keep the day or clamp it to the end of a shorter month.
  ['data-rates-months-no-clamp', F, 'Math.min(d, daysInMonth(year, month))', 'd'],
  ['data-rates-leap-every-fourth-year', F, 'if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;', 'if (month === 2) return year % 4 === 0 ? 29 : 28;'],
  // R4, R5: missing values are skipped, never used.
  ['data-rates-latest-takes-null', F, 'if (o && o.value !== null) return o;', 'if (o) return o;'],
  ['data-rates-previous-takes-null', F, 'if (o && o.period < period && o.value !== null) return o;', 'if (o && o.period < period) return o;'],
  // R6: on or before the comparison date, at most 7 days earlier.
  ['data-rates-window-eight-days', F, 'export const COMPARE_WINDOW_DAYS = 7;', 'export const COMPARE_WINDOW_DAYS = 8;'],
  ['data-rates-window-strict', F, 'if (daysFrom(found.period, date) > COMPARE_WINDOW_DAYS)', 'if (daysFrom(found.period, date) >= COMPARE_WINDOW_DAYS)'],
  ['data-rates-on-or-before-strict', F, 'if (o && o.period <= date && o.value !== null) found = o;', 'if (o && o.period < date && o.value !== null) found = o;'],
  // R7: the five-year comparison looks back 60 months.
  ['data-rates-five-years-59-months', F, "{ id: 'five-years', months: 60, label: 'Five years earlier' },", "{ id: 'five-years', months: 59, label: 'Five years earlier' },"],
  // R8: the target in effect on a date includes a change point effective that day.
  ['data-rates-target-strict', F, 'if (c && c.effective <= date) return c;', 'if (c && c.effective < date) return c;'],
  // R9: each bound separately; one number only when both moved alike.
  ['data-rates-upper-from-lower', F, 'return { lower: bpChange(o.lower, n.lower), upper: bpChange(o.upper, n.upper) };', 'return { lower: bpChange(o.lower, n.lower), upper: bpChange(o.lower, n.upper) };'],
  ['data-rates-signed-ignores-upper', F, 'return c.lower === c.upper ? signedBp(c.lower) :', 'return true ? signedBp(c.lower) :'],
  // R10: every change point but the first has its change from the one before.
  ['data-rates-second-change-lost', F, 'const previous = i > 0 ? (cps[i - 1] ?? null) : null;', 'const previous = i > 1 ? (cps[i - 1] ?? null) : null;'],
  // R11: the target change runs from the comparison day to the latest.
  ['data-rates-table-change-reversed', F, 'const change = target && targetNow ? targetChange(target, targetNow) : null;', 'const change = target && targetNow ? targetChange(targetNow, target) : null;'],
  // R12: 30 rows without JavaScript (decision D12).
  ['data-rates-recent-31-rows', F, 'export const RECENT_ROWS = 30;', 'export const RECENT_ROWS = 31;'],
  // R13: the chart window's end, the target's first point and the segments' closing points.
  ['data-rates-end-ignores-target', F, 'const end = latestOf([latestEffr(obs)?.period, cps.at(-1)?.effective]);', 'const end = latestOf([latestEffr(obs)?.period ?? cps.at(-1)?.effective]);'],
  ['data-rates-x0-is-start', F, 'const x0 = first.effective > start ? first.effective : start;', 'const x0 = start;'],
  ['data-rates-segments-not-closed', F, 'if (last && closeAt !== undefined && closeAt !== last.x) run.push({ x: closeAt, cp: last.cp });', 'if (false) run.push({ x: closeAt ?? end, cp: last?.cp ?? points[0]!.cp });'],
  ['data-rates-ten-years-119-months', F, "{ id: '10y', months: 120, label: '10Y', words: 'ten years' },", "{ id: '10y', months: 119, label: '10Y', words: 'ten years' },"],
  // A first-seen date is an Eastern Time date, labeled so (owner briefs R and T).
  ['data-rates-first-seen-unlabeled', F, 'on ${formatDay(released)} (Eastern Time date)`;', 'on ${formatDay(released)}`;'],
];
