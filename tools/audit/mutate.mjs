#!/usr/bin/env node
// Test-suite integrity, part 2 (FINANCIAL_MODEL_REQUIREMENTS 8.3): mutation pass.
//
// Each rounding rule, threshold and formula constant in the engines is perturbed, in both
// directions where that makes sense, one at a time. The unit tests must fail for every
// mutant. The unmodified code must pass with zero failures first. Mutants in different
// files that fail exactly the same set of tests are reported for review, since that can
// mean the tests are not telling the mutations apart.
//
// Safety: all mutation happens in a private copy under local/mutation-work. The live
// source files are only read, and are hashed before and after: if anything in them changed
// during the run, the pass fails. (An earlier version mutated the live files in place and
// restored them afterwards; a commit made while such a run was in progress captured a
// mutant.) Each test run has a hard timeout and runs its workers as threads in one process,
// so a mutant that loops forever is killed and reported.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const E = 'src/lib/engines/';
const RUN_TIMEOUT_MS = 180_000;

const MUTANTS = [
  // Exact interest posting (money.ts periodicInterest)
  ['posting-truncates', `${E}money.ts`, 'return Number((2n * numerator + denominator) / (2n * denominator));', 'return Number((2n * numerator) / (2n * denominator));'],
  ['posting-rounds-up', `${E}money.ts`, 'return Number((2n * numerator + denominator) / (2n * denominator));', 'return Number((2n * numerator + 2n * denominator - 1n) / (2n * denominator));'],
  // Float rounding (money.ts roundHalfUp)
  ['round-threshold-low', `${E}money.ts`, 'return fraction > 0.5 ? whole + 1 : whole;', 'return fraction > 0.4 ? whole + 1 : whole;'],
  ['round-threshold-high', `${E}money.ts`, 'return fraction > 0.5 ? whole + 1 : whole;', 'return fraction > 0.6 ? whole + 1 : whole;'],
  ['round-no-tie-snap', `${E}money.ts`, 'if (Math.abs(fraction - 0.5) <= tolerance) return whole + 1;', 'if (false) return whole + 1;'],
  ['round-tolerance-cap-wide', `${E}money.ts`, 'const HALF_TOLERANCE_MAX = 2 ** -20;', 'const HALF_TOLERANCE_MAX = 2 ** -2;'],
  ['percent-scale', `${E}money.ts`, 'const hundredths = roundHalfUp(Math.abs(percent) * 100);', 'const hundredths = roundHalfUp(Math.abs(percent) * 1000);'],
  // Rates and Regulation DD (rates.ts)
  ['days-in-year-366', `${E}rates.ts`, 'export const DAYS_IN_YEAR = 365;', 'export const DAYS_IN_YEAR = 366;'],
  ['days-in-year-364', `${E}rates.ts`, 'export const DAYS_IN_YEAR = 365;', 'export const DAYS_IN_YEAR = 364;'],
  ['apy-exponent-inverted', `${E}rates.ts`, '(DAYS_IN_YEAR / days) * Math.log1p(interest / principal)', '(days / DAYS_IN_YEAR) * Math.log1p(interest / principal)'],
  ['apy-n-plus-one', `${E}rates.ts`, 'Math.expm1(periodsPerYear * Math.log1p(annualRate / periodsPerYear))', 'Math.expm1((periodsPerYear + 1) * Math.log1p(annualRate / periodsPerYear))'],
  ['nominal-n-minus-one', `${E}rates.ts`, 'periodsPerYear * Math.expm1(Math.log1p(apy) / periodsPerYear)', '(periodsPerYear - 1) * Math.expm1(Math.log1p(apy) / periodsPerYear)'],
  ['credit-late', `${E}rates.ts`, 'if (daysInPeriod === DAYS_IN_YEAR) credit();', 'if (daysInPeriod === DAYS_IN_YEAR + 1) credit();'],
  ['credit-only-at-maturity', `${E}rates.ts`, 'if (daysInPeriod === DAYS_IN_YEAR) credit();', 'if (false) credit();'],
  // Exact average-balance posting (money.ts averageBalanceInterest)
  ['average-days-ignored', `${E}money.ts`, 'const denominator = rate.scale * BigInt(periodsPerYear) * BigInt(days);', 'const denominator = rate.scale * BigInt(periodsPerYear);'],
  // Calendar (calendar.ts)
  ['calendar-30-day-months', `${E}calendar.ts`, 'export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;', 'export const MONTH_DAYS = [30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30] as const;'],
  ['calendar-february-30', `${E}calendar.ts`, 'export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;', 'export const MONTH_DAYS = [31, 30, 31, 30, 31, 30, 31, 31, 30, 31, 30, 29] as const;'],
  ['calendar-weekly-6-days', `${E}calendar.ts`, '{ weekly: 7, biweekly: 14 }', '{ weekly: 6, biweekly: 14 }'],
  ['calendar-biweekly-15-days', `${E}calendar.ts`, '{ weekly: 7, biweekly: 14 }', '{ weekly: 7, biweekly: 15 }'],
  ['calendar-quarters-shifted', `${E}calendar.ts`, '4: [MONTH_STARTS[0]!, MONTH_STARTS[3]!, MONTH_STARTS[6]!, MONTH_STARTS[9]!],', '4: [MONTH_STARTS[0]!, MONTH_STARTS[2]!, MONTH_STARTS[5]!, MONTH_STARTS[8]!],'],
  ['calendar-half-year-june', `${E}calendar.ts`, '2: [MONTH_STARTS[0]!, MONTH_STARTS[6]!],', '2: [MONTH_STARTS[0]!, MONTH_STARTS[5]!],'],
  ['calendar-start-includes-term-end', `${E}calendar.ts`, 'intervals.filter((t) => t < term) : intervals', 'intervals.filter((t) => t <= term) : intervals'],
  ['calendar-end-includes-day-0', `${E}calendar.ts`, ': intervals.filter((t) => t > 0);', ': intervals.filter((t) => t >= 0);'],
  // Compound interest (compound.ts)
  ['compound-periods-up', `${E}compound.ts`, 'averageBalanceInterest(balanceDays, days, annualRate, n);', 'averageBalanceInterest(balanceDays, days, annualRate, n + 1);'],
  ['compound-periods-down', `${E}compound.ts`, 'averageBalanceInterest(balanceDays, days, annualRate, n);', 'averageBalanceInterest(balanceDays, days, annualRate, Math.max(1, n - 1));'],
  ['compound-held-days-plus-one', `${E}compound.ts`, 'heldDays += end - deposits[next]!;', 'heldDays += end - deposits[next]! + 1;'],
  ['compound-held-whole-period', `${E}compound.ts`, 'heldDays += end - deposits[next]!;', 'heldDays += days;'],
  ['compound-held-no-days', `${E}compound.ts`, 'heldDays += end - deposits[next]!;', 'heldDays += 0;'],
  ['compound-belongs-swapped', `${E}compound.ts`, "timing === 'start' ? (t: number, end: number) => t < end : (t: number, end: number) => t <= end;", "timing === 'start' ? (t: number, end: number) => t <= end : (t: number, end: number) => t < end;"],
  ['compound-year-count', `${E}compound.ts`, 'contributions: contribution * yearCount,', 'contributions: contribution * (yearCount + 1),'],
  ['compound-none-validates', `${E}compound.ts`, "&& input.contributionFrequency !== 'none') {", '&& true) {'],
  ['compound-cap-doubled', `${E}compound.ts`, 'if (balance > Number.MAX_SAFE_INTEGER) {', 'if (balance > 2 * Number.MAX_SAFE_INTEGER) {'],
  // Rate comparison (rate-compare.ts)
  ['rates-interest-from-rate', `${E}rate-compare.ts`, 'oneYearInterest: roundCents(balance * apy),', 'oneYearInterest: roundCents(balance * annualRate),'],
  ['rates-periodic-n-plus-one', `${E}rate-compare.ts`, 'periodicRate: annualRate / n,', 'periodicRate: annualRate / (n + 1),'],
  ['rates-kind-swapped', `${E}rate-compare.ts`, "const annualRate = a.kind === 'rate' ? a.value : nominalFromApy(a.value, n);", "const annualRate = a.kind === 'apy' ? a.value : nominalFromApy(a.value, n);"],
  ['rates-best-is-lowest', `${E}rate-compare.ts`, 'const top = Math.max(...out.map((a) => a.apy));', 'const top = Math.min(...out.map((a) => a.apy));'],
  ['rates-four-accounts', `${E}rate-compare.ts`, 'export const MAX_ACCOUNTS = 3;', 'export const MAX_ACCOUNTS = 4;'],
  // Savings account (hysa.ts)
  ['hysa-monthly-366-days', `${E}hysa.ts`, 'interest = roundCents((balanceDays * rate.annualRate) / YEAR_DAYS);', 'interest = roundCents((balanceDays * rate.annualRate) / (YEAR_DAYS + 1));'],
  ['hysa-daily-364-days', `${E}hysa.ts`, 'const logDaily = Math.log1p(rate.apy) / YEAR_DAYS;', 'const logDaily = Math.log1p(rate.apy) / (YEAR_DAYS - 1);'],
  ['hysa-deposit-whole-month', `${E}hysa.ts`, 'heldEnds.push(end - deposits[next]!);', 'heldEnds.push(days);'],
  ['hysa-calibration-textbook', `${E}hysa.ts`, 'const growth = (r: number) => MONTH_DAYS.reduce((sum, days) => sum + Math.log1p((r * days) / YEAR_DAYS), 0);', 'const growth = (r: number) => 12 * Math.log1p(r / 12) + 0 * MONTH_DAYS.length;'],
  ['hysa-rate-change-late', `${E}hysa.ts`, 'rates[rateIndex + 1]!.fromMonth <= month', 'rates[rateIndex + 1]!.fromMonth < month'],
  ['hysa-apy-earned-inverted', `${E}hysa.ts`, 'Math.expm1((YEAR_DAYS / days) * Math.log1p(interest / averageDailyBalance))', 'Math.expm1((days / YEAR_DAYS) * Math.log1p(interest / averageDailyBalance))'],
  ['hysa-belongs-swapped', `${E}hysa.ts`, "timing === 'start' ? (t: number, end: number) => t < end : (t: number, end: number) => t <= end;", "timing === 'start' ? (t: number, end: number) => t <= end : (t: number, end: number) => t < end;"],
  ['hysa-cap-doubled', `${E}hysa.ts`, 'if (balance > Number.MAX_SAFE_INTEGER) {', 'if (balance > 2 * Number.MAX_SAFE_INTEGER) {'],
  // Schedules by day, month and year (schedule.ts, conventions section 11)
  ['schedule-start-deposit-day-early', `${E}schedule.ts`, "counts[timing === 'start' ? t : t - 1]! += 1;", "counts[t === 0 ? 0 : t - 1]! += 1;"],
  ['schedule-end-deposit-earns-its-day', `${E}schedule.ts`, "const dayBalance = timing === 'start' ? opening + deposits : opening;", 'const dayBalance = opening + deposits;'],
  ['schedule-compound-period-length', `${E}schedule.ts`, '(dayBalance * annualRate) / (n * (p.end - p.start))', '(dayBalance * annualRate) / (n * (p.end - p.start + 1))'],
  ['schedule-savings-366-days', `${E}schedule.ts`, '(dayBalance * rates[p.rate]!.annualRate) / YEAR_DAYS', '(dayBalance * rates[p.rate]!.annualRate) / (YEAR_DAYS + 1)'],
  ['schedule-daily-no-compounding', `${E}schedule.ts`, '(dayBalance + accruedSoFar) * growth[p.rate]!', 'dayBalance * growth[p.rate]!'],
  ['schedule-credit-first-day', `${E}schedule.ts`, 'day === period.end - 1 ? period.interest : 0', 'day === period.start ? period.interest : 0'],
  ['schedule-row-opens-at-last', `${E}schedule.ts`, 'opening: first.opening', 'opening: last.opening'],
  ['schedule-accrued-not-summed', `${E}schedule.ts`, 'accrued += part.accrued;', 'accrued = part.accrued;'],
  ['schedule-first-rate-only', `${E}schedule.ts`, 'if (rates[rates.length - 1] !== r) rates.push(r);', 'if (rates.length === 0) rates.push(r);'],
  ['schedule-30-day-months', `${E}schedule.ts`, 'const to = month === 11 ? (year + 1) * YEAR_DAYS : year * YEAR_DAYS + MONTH_STARTS[month + 1]!;', 'const to = month === 11 ? (year + 1) * YEAR_DAYS : year * YEAR_DAYS + MONTH_STARTS[month]! + 30;'],
  // Rate illustration (rate-illustration.ts, conventions section 12) and its calendar
  ['illustration-periodic-n-plus-one', `${E}rate-illustration.ts`, 'return deposit * Math.exp(k * Math.log1p(account.annualRate / account.periodsPerYear));', 'return deposit * Math.exp(k * Math.log1p(account.annualRate / (account.periodsPerYear + 1)));'],
  ['illustration-cap-doubled', `${E}rate-illustration.ts`, '> Number.MAX_SAFE_INTEGER)', '> 2 * Number.MAX_SAFE_INTEGER)'],
  ['illustration-shown-truncated', `${E}rate-illustration.ts`, 'shown: balances.map(roundCents)', 'shown: balances.map(Math.floor)'],
  ['illustration-month-ends-shifted', `${E}rate-illustration.ts`, 'periodBoundaries(12, years).slice(1)', 'periodBoundaries(12, years).slice(0, -1)'],
  ['calendar-53-weeks', `${E}calendar.ts`, '52: Array.from({ length: 52 }, (_, week) => 7 * week),', '52: Array.from({ length: 53 }, (_, week) => 7 * week),'],
  ['calendar-period-end-exclusive', `${E}calendar.ts`, 'starts[i]! <= offset', 'starts[i]! < offset'],
  ['calendar-day-month-late', `${E}calendar.ts`, 'MONTH_STARTS[month + 1]! <= offset', 'MONTH_STARTS[month + 1]! < offset'],
  // Loans (loan.ts)
  ['loan-months-per-year-11', `${E}loan.ts`, 'return periodicInterest(balance, annualRate, 12);', 'return periodicInterest(balance, annualRate, 11);'],
  ['loan-months-per-year-13', `${E}loan.ts`, 'return periodicInterest(balance, annualRate, 12);', 'return periodicInterest(balance, annualRate, 13);'],
  ['loan-zero-rate-divisor', `${E}loan.ts`, 'if (annualRate === 0) return roundCents(principal / termMonths);', 'if (annualRate === 0) return roundCents(principal / (termMonths + 1));'],
  ['loan-no-forced-final', `${E}loan.ts`, 'if (month === termMonths || balance + interest <= payment)', 'if (balance + interest <= payment)'],
  ['loan-extra-uncapped', `${E}loan.ts`, 'const extra = Math.min(extraMonthly + (oneTimeByMonth.get(month) ?? 0), balance);', 'const extra = extraMonthly + (oneTimeByMonth.get(month) ?? 0);'],
  ['loan-guard-strict', `${E}loan.ts`, 'payment <= monthlyInterest(principal, annualRate)', 'payment < monthlyInterest(principal, annualRate)'],
  // Ledger
  ['ledger-no-settlement', `${E}ledger/catalog.ts`, 'if (fromBank === toBank) return [];', 'return [];'],
  ['ledger-shortfall-code', `${E}ledger/ledger.ts`, "reserves: 'reserve-shortfall',", "reserves: 'insufficient-funds',"],
  ['ledger-capital-half', `${E}ledger/ledger.ts`, 'after.equity < options.minCapitalRatio * after.totalAssets', 'after.equity < 0.5 * options.minCapitalRatio * after.totalAssets'],
  ['ledger-no-balance-check', `${E}ledger/ledger.ts`, 'if (sheet.totalAssets !== sheet.totalLiabilities + sheet.equity) {', 'if (false) {'],
  ['ledger-money-includes-banks', `${E}ledger/model.ts`, '&& isNonbank(c.holder));', ');'],
];

// Equivalent mutants, deliberately not listed because no test can tell them apart:
// - compound.ts using `input.contribution` when the frequency is none: there are no
//   contribution dates then, so the amount is multiplied by zero everywhere.
// - loan.ts `balance + interest <= payment` changed to `<`: when balance + interest equals
//   the payment exactly, the regular branch posts principal = balance, extra = min(due, 0)
//   = 0 and a zero balance, which is the same row the final-payment branch posts.

const VITEST = resolve('node_modules', 'vitest', 'vitest.mjs');
const WORK = resolve('local', 'mutation-work');
// Everything the unit tests read, copied into the work tree.
const COPY = ['src/lib', 'src/pages/learn', 'src/styles/report.css', 'public/favicon.svg', 'tests/unit', 'tests/support', 'tests/oracle/fixtures', 'tools/text-scan.mjs', 'vitest.config.ts'];

function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, e.name);
      if (e.isDirectory()) walk(path);
      else out[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

const liveBefore = hashTree('src/lib');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
for (const path of COPY) cpSync(path, join(WORK, path), { recursive: true });

function runTests() {
  const dir = mkdtempSync(join(tmpdir(), 'rmf-mutate-'));
  const report = join(dir, 'report.json');
  const run = spawnSync(process.execPath, [VITEST, 'run', 'tests/unit', '--pool=threads', '--reporter=json', `--outputFile=${report}`], {
    cwd: WORK,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  try {
    if (run.error || run.signal) return { total: 0, failed: ['(timed out or killed)'], timedOut: true };
    const json = JSON.parse(readFileSync(report, 'utf8'));
    const failed = json.testResults
      .flatMap((file) => file.assertionResults)
      .filter((t) => t.status !== 'passed')
      .map((t) => t.fullName);
    // A test file that cannot even load (a missing file it reads, a syntax error) runs no
    // tests at all; count it as a failure, never as silence.
    for (const file of json.testResults) {
      if (file.status === 'failed' && !file.assertionResults.some((t) => t.status !== 'passed')) failed.push(`(file failed to run) ${file.name}`);
    }
    return { total: json.numTotalTests, failed, timedOut: false };
  } catch {
    return { total: 0, failed: ['(the test run did not produce a report)'], timedOut: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const baseline = runTests();
if (baseline.failed.length || baseline.total === 0) {
  console.log(`mutation pass: the unmodified code must pass first; ${baseline.failed.length} failure(s):`);
  for (const f of baseline.failed) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`mutation pass: unmodified code passes (${baseline.total} tests)`);

let restore = null;
process.on('SIGINT', () => {
  if (restore) restore();
  process.exit(130);
});

const results = [];
for (const [id, liveFile, find, replace] of MUTANTS) {
  const file = join(WORK, liveFile);
  const original = readFileSync(file, 'utf8');
  const occurrences = original.split(find).length - 1;
  if (occurrences !== 1) {
    console.log(`mutation pass: mutant ${id} target found ${occurrences} times in ${file}; fix the mutant list`);
    process.exit(1);
  }
  restore = () => writeFileSync(file, original);
  try {
    writeFileSync(file, original.replace(find, replace));
    const { failed, timedOut } = runTests();
    results.push({ id, file: liveFile, failed, timedOut });
    const label = timedOut ? 'TIMEOUT ' : failed.length ? 'killed  ' : 'SURVIVED';
    console.log(`${label} ${id.padEnd(30)} ${timedOut ? 'run did not finish' : `${String(failed.length).padStart(3)} failing test(s)`}`);
  } finally {
    restore();
    restore = null;
  }
}

rmSync(WORK, { recursive: true, force: true });

// The live sources must be exactly as they were: this pass never writes to them.
const liveAfter = hashTree('src/lib');
const changed = Object.keys({ ...liveBefore, ...liveAfter }).filter((f) => liveBefore[f] !== liveAfter[f]);
if (changed.length) {
  console.log(`mutation pass: live source files changed during the run (${changed.join(', ')}); do not commit until this is understood`);
  process.exit(1);
}

const survivors = results.filter((r) => r.failed.length === 0);
const timeouts = results.filter((r) => r.timedOut);

const bySignature = new Map();
for (const r of results.filter((x) => x.failed.length && !x.timedOut)) {
  const key = [...r.failed].sort().join('\n');
  bySignature.set(key, [...(bySignature.get(key) ?? []), r]);
}
for (const group of bySignature.values()) {
  const files = new Set(group.map((r) => r.file));
  if (files.size > 1) console.log(`review: mutants in different files fail the same tests: ${group.map((r) => r.id).join(', ')}`);
}
if (timeouts.length) {
  console.log(`warning: ${timeouts.length} mutant(s) hung instead of failing (${timeouts.map((t) => t.id).join(', ')}); an engine loop may not be bounded`);
}

if (survivors.length) {
  console.log(`mutation pass: ${survivors.length} of ${results.length} mutant(s) survived: ${survivors.map((s) => s.id).join(', ')}`);
  process.exit(1);
}
console.log(`mutation pass: all ${results.length} mutants detected`);
