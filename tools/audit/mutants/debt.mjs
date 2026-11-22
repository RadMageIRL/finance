// Mutants of the National Debt Tracker's rules (src/lib/data/debt.ts, D1 to D14), in the form
// tools/audit/mutate.mjs reads: [id, file, find, replace], each find occurring exactly once in its
// file. The unit tests (tests/unit/data/debt.test.ts against the econ-debt.json oracle) must fail
// for every one.
const F = 'src/lib/data/debt.ts';

export const MUTANTS = [
  // D1, D8: exact cents
  ['data-debt-cents-sign-dropped', F, 'return negative ? -cents : cents;', 'return cents;'],
  // D2: the latest record is the last one with a published value
  ['data-debt-latest-ignores-missing', F, 'for (let i = records.length - 1; i >= 0; i -= 1) if (records[i]?.value !== null) return i;', 'for (let i = records.length - 1; i >= 0; i -= 1) if (records[i] !== undefined) return i;'],
  // D3: the daily comparison is the previous record date
  ['data-debt-daily-two-back', F, 'ci = li - 1;', 'ci = li - 2;'],
  // D4: base dates clamp to the month end, with Gregorian leap years
  ['data-debt-base-no-clamp', F, 'pad(Math.min(d, daysInMonth(year, month)))', 'pad(d)'],
  ['data-debt-leap-every-fourth', F, 'const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;', 'const isLeap = (y: number) => y % 4 === 0;'],
  ['data-debt-comparison-strictly-before', F, "if ((records[i]?.period ?? '') <= date) return i;", "if ((records[i]?.period ?? '') < date) return i;"],
  // D5: the gap of a monthly or yearly change is measured to the base date
  ['data-debt-gap-to-latest', F, 'out.gapDays = daysBetween(comparison.period, out.base ?? latest.period);', 'out.gapDays = daysBetween(comparison.period, latest.period);'],
  // D7: validity checks and their order
  ['data-debt-gap-limit-exclusive', F, "if (out.gapDays > maxGapDays) return { ...out, reason: 'gap' };", "if (out.gapDays >= maxGapDays) return { ...out, reason: 'gap' };"],
  ['data-debt-gap-before-not-published', F, "if (comparison.value === null) return { ...out, reason: 'not-published' };\n  if (out.gapDays > maxGapDays) return { ...out, reason: 'gap' };", "if (out.gapDays > maxGapDays) return { ...out, reason: 'gap' };\n  if (comparison.value === null) return { ...out, reason: 'not-published' };"],
  ['data-debt-anomaly-latest-ignored', F, "if (anomalies.has(latest.period)) return { ...out, reason: 'anomaly-latest' };", "if (false) return { ...out, reason: 'anomaly-latest' };"],
  ['data-debt-anomaly-comparison-ignored', F, "if (anomalies.has(comparison.period)) return { ...out, reason: 'anomaly-comparison' };", "if (false) return { ...out, reason: 'anomaly-comparison' };"],
  // D6: anomaly dates of all three series apply together
  ['data-debt-anomalies-first-series-only', F, 'if (before === undefined) anomalies.set(note.period, note.text);', "if (before === undefined && id === 'debt-total') anomalies.set(note.period, note.text);"],
  // D9: signs
  ['data-debt-zero-signed', F, 'return cents > 0n ? `+${formatUsd(value)}` : formatUsd(value);', 'return cents >= 0n ? `+${formatUsd(value)}` : formatUsd(value);'],
  // D10: scale thresholds, rounding places and the sign of a negative amount
  ['data-debt-billion-threshold-low', F, "{ min: 100_000_000_000n, places: 9, word: 'billion' },", "{ min: 10_000_000_000n, places: 9, word: 'billion' },"],
  ['data-debt-rounded-three-places', F, 'groupDigits(roundHalfUp(shiftLeft(fromCents(magnitude), scale.places), 2))', 'groupDigits(roundHalfUp(shiftLeft(fromCents(magnitude), scale.places), 3))'],
  ['data-debt-rounded-negative-unsigned', F, "const sign = cents < 0n ? '-' : signed && cents > 0n ? '+' : '';", "const sign = signed && cents > 0n ? '+' : '';"],
  // D11: parts minus total, and only dates that differ
  ['data-debt-difference-reversed', F, 'const difference = toCents(hv) + toCents(gv) - toCents(t.value);', 'const difference = toCents(t.value) - toCents(hv) - toCents(gv);'],
  ['data-debt-difference-zero-listed', F, 'if (difference !== 0n) out.push(', 'if (difference !== 1n) out.push('],
  // D12: daily_from is the start of the final unbroken run of published values
  ['data-debt-daily-from-skips-gaps', F, "    if (!r || r.value === null) break;\n    dailyFrom = r.period;", "    if (!r || r.value === null) continue;\n    dailyFrom = r.period;"],
  // D13: newest first, and a part without a record is not a part without a value
  ['data-debt-recent-oldest-first', F, '    .reverse()\n    .map((t) => ({ period: t.period, total: t.value, held: partAt(h, t.period), intragov: partAt(g, t.period) }));', '    .map((t) => ({ period: t.period, total: t.value, held: partAt(h, t.period), intragov: partAt(g, t.period) }));'],
  ['data-debt-no-record-as-not-published', F, "if (!r) return { state: 'no-record', value: null };", "if (!r) return { state: 'not-published', value: null };"],
  // D14: chart points start at the first published value and add gaps only where no record exists
  ['data-debt-chart-keeps-leading-missing', F, 'const kept = records.filter((r) => r.period >= first.period && (windowStart === null || r.period >= windowStart));', 'const kept = records.filter((r) => windowStart === null || r.period >= windowStart);'],
  ['data-debt-chart-gap-over-record', F, 'if (g > head.period && g < tail.period && !have.has(g)) points.push', 'if (g > head.period && g < tail.period) points.push'],
  // First-seen and detection dates are Eastern Time dates, labeled so (owner briefs R and T).
  ['data-debt-first-seen-unlabeled', F, 'on ${formatDay(o.released)} (Eastern Time date)`;', 'on ${formatDay(o.released)}`;'],
  ['data-debt-first-seen-column-unlabeled', F, "label: 'Total first seen by RadMage Finance (Eastern Time date)' },", "label: 'Total first seen by RadMage Finance' },"],
  ['data-debt-detected-unlabeled', F, '(detected ${formatDay(easternDate(rev.detectedAt))}, Eastern Time date);', '(detected ${formatDay(easternDate(rev.detectedAt))});'],
];
