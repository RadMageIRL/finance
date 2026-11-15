#!/usr/bin/env node
// Test-suite integrity, part 2 (FINANCIAL_MODEL_REQUIREMENTS 8.3): mutation pass.
//
// Each rounding rule, threshold and formula constant in the engines is perturbed, in both
// directions where that makes sense, one at a time. The unit tests must fail for every
// mutant. The unmodified code must pass with zero failures first. Mutants in different
// files that fail exactly the same set of tests are reported for review, since that can
// mean the tests are not telling the mutations apart.
//
// Safety: the source file is restored in a finally block, also on Ctrl+C; each test run
// has a hard timeout and runs its workers as threads in one process, so a mutant that
// loops forever is killed with that process and counted as detected (with a warning).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  // Compound interest (compound.ts)
  ['compound-periods-up', `${E}compound.ts`, 'periodicInterest(balance, annualRate, n);', 'periodicInterest(balance, annualRate, n + 1);'],
  ['compound-periods-down', `${E}compound.ts`, 'periodicInterest(balance, annualRate, n);', 'periodicInterest(balance, annualRate, Math.max(1, n - 1));'],
  ['compound-timing-swapped', `${E}compound.ts`, "if (timing === 'start') balance += contribution;", "if (timing === 'end') balance += contribution;"],
  ['compound-contributions-total', `${E}compound.ts`, 'contributions: contribution * n,', 'contributions: contribution * (n + 1),'],
  ['compound-cap-doubled', `${E}compound.ts`, 'if (balance > Number.MAX_SAFE_INTEGER) {', 'if (balance > 2 * Number.MAX_SAFE_INTEGER) {'],
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
// - loan.ts `balance + interest <= payment` changed to `<`: when balance + interest equals
//   the payment exactly, the regular branch posts principal = balance, extra = min(due, 0)
//   = 0 and a zero balance, which is the same row the final-payment branch posts.

const VITEST = join('node_modules', 'vitest', 'vitest.mjs');

function runTests() {
  const dir = mkdtempSync(join(tmpdir(), 'rmf-mutate-'));
  const report = join(dir, 'report.json');
  const run = spawnSync(process.execPath, [VITEST, 'run', 'tests/unit', '--pool=threads', '--reporter=json', `--outputFile=${report}`], {
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
for (const [id, file, find, replace] of MUTANTS) {
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
    results.push({ id, file, failed, timedOut });
    const label = timedOut ? 'TIMEOUT ' : failed.length ? 'killed  ' : 'SURVIVED';
    console.log(`${label} ${id.padEnd(30)} ${timedOut ? 'run did not finish' : `${String(failed.length).padStart(3)} failing test(s)`}`);
  } finally {
    restore();
    restore = null;
  }
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
