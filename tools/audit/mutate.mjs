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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  // Interest accrued in illustration rows (conventions 12.5)
  ['illustration-accrual-period-length-off-by-one', `${E}rate-illustration.ts`, '(overlap / (end - start))', '(overlap / (end - start + 1))'],
  ['illustration-accrual-on-period-end-balance', `${E}rate-illustration.ts`, 'balanceAfter(deposit, account, p - 1) * account.annualRate', 'balanceAfter(deposit, account, p) * account.annualRate'],
  ['illustration-year-accrual-misses-december', `${E}rate-illustration.ts`, 'months.slice(12 * y, 12 * y + 12)', 'months.slice(12 * y, 12 * y + 11)'],
  ['calendar-53-weeks', `${E}calendar.ts`, '52: Array.from({ length: 52 }, (_, week) => 7 * week),', '52: Array.from({ length: 53 }, (_, week) => 7 * week),'],
  ['calendar-period-end-exclusive', `${E}calendar.ts`, 'starts[i]! <= offset', 'starts[i]! < offset'],
  ['calendar-day-month-late', `${E}calendar.ts`, 'MONTH_STARTS[month + 1]! <= offset', 'MONTH_STARTS[month + 1]! < offset'],
  // Loan schedules, payoff comparison and payment breakdown (loan-report.ts, conventions 13)
  ['loan-date-one-month-late', `${E}loan-report.ts`, 'const index = first.year * 12 + (first.month - 1) + (k - 1);', 'const index = first.year * 12 + (first.month - 1) + k;'],
  ['loan-cumulative-principal-no-extra', `${E}loan-report.ts`, 'principal += row.principal + row.extra;', 'principal += row.principal;'],
  ['loan-year-misses-extra', `${E}loan-report.ts`, 'y.extra += m.extra;', 'y.extra += 0;'],
  ['loan-baseline-keeps-extras', `${E}loan-report.ts`, 'loanPlan({ principal: input.principal, annualRate: input.annualRate, termMonths: input.termMonths }, first)', 'loanPlan(input, first)'],
  ['loan-months-saved-reversed', `${E}loan-report.ts`, 'monthsSaved: b.schedule.months - a.schedule.months,', 'monthsSaved: a.schedule.months - b.schedule.months,'],
  ['loan-tax-truncated', `${E}loan-report.ts`, 'const propertyTax = roundCents(costs.propertyTaxAnnual / 12);', 'const propertyTax = Math.floor(costs.propertyTaxAnnual / 12);'],
  ['loan-total-without-hoa', `${E}loan-report.ts`, 'total: mortgagePayment + costs.hoaMonthly,', 'total: mortgagePayment,'],
  ['loan-mortgage-payment-with-hoa', `${E}loan-report.ts`, 'const mortgagePayment = payment + escrow + costs.mortgageInsuranceMonthly;', 'const mortgagePayment = payment + escrow + costs.mortgageInsuranceMonthly + costs.hoaMonthly;'],
  ['loan-escrow-misses-insurance', `${E}loan-report.ts`, 'const escrow = propertyTax + insurance;', 'const escrow = propertyTax;'],
  // Mortgage payoff Total paid in the table, report and CSV (loan-view.ts, v0.1.1; conventions 6: payment + extra)
  ['payoff-total-paid-cell-misses-extra', 'src/lib/calc/loan-view.ts', '...(extraCol ? [formatUSD(r.payment + r.extra)] : []),', '...(extraCol ? [formatUSD(r.payment)] : []),'],
  ['payoff-csv-total-paid-misses-extra', 'src/lib/calc/loan-view.ts', '...(extraCol ? [centsToCsv(r.payment + r.extra)] : []),', '...(extraCol ? [centsToCsv(r.payment)] : []),'],
  ['payoff-year-csv-total-paid-misses-extra', 'src/lib/calc/loan-view.ts', '...(extraCol ? [centsToCsv(y.scheduled + y.extra)] : [])', '...(extraCol ? [centsToCsv(y.scheduled)] : [])'],
  // Lesson simulator (src/lib/learn/sim.ts)
  ['sim-runs-past-refusal', 'src/lib/learn/sim.ts', 'if (!result.ok) {\n      const short', 'if (!result.ok && false) {\n      const short'],
  ['sim-interbank-wrong-lender', 'src/lib/learn/sim.ts', 'make: () => interbankLoan(other, short.bank, short.amount)', 'make: () => interbankLoan(short.bank, other, short.amount)'],
  ['sim-nothing-marked-changed', 'src/lib/learn/sim.ts', "if ((before.claims[key] ?? 0) !== (after.claims[key] ?? 0)) out.add(key);", "if ((before.claims[key] ?? 0) !== (after.claims[key] ?? 0) && false) out.add(key);"],
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
  // Phase 2 data pipeline foundations (pipeline/lib, DATA_CONVENTIONS v0.1)
  ['pipeline-revised-aggregate-window-none', 'pipeline/lib/registry-policy.mjs', "revised_aggregate: { frequency: 'month', window: 'scheduled-release',", "revised_aggregate: { frequency: 'month', window: 'none',"],
  ['pipeline-inactivity-critical-late', 'pipeline/lib/schedule-health.mjs', 'if (idleDays >= t.inactivityCriticalDays)', 'if (idleDays > t.inactivityCriticalDays)'],
  ['pipeline-manual-runs-hide-schedule-gap', 'pipeline/lib/schedule-health.mjs', "const scheduled = runs.filter((r) => r.event === 'schedule');", 'const scheduled = runs;'],
  ['pipeline-cancelled-breaks-failure-streak', 'pipeline/lib/schedule-health.mjs', "else if (r.conclusion === 'success') break;", 'else break;'],
  ['pipeline-canonical-utf16-key-order', 'pipeline/lib/canonical.mjs', 'const keys = Object.keys(value).sort(byCodePoint);', 'const keys = Object.keys(value).sort();'],
  ['pipeline-decimal-not-padded', 'pipeline/lib/source-records.mjs', "`${int}.${frac.padEnd(decimals, '0')}`", '`${int}.${frac}`'],
  ['pipeline-schema-unknown-property-ignored', 'pipeline/lib/json-schema.mjs', 'if (schema.additionalProperties === false) errors.push(`${path}: unknown property ${k}`);', 'if (false) errors.push(`${path}: unknown property ${k}`);'],
  // P2.2 pipeline mechanics (DATA_CONVENTIONS v0.3 sections 2, 11, 12 and 17)
  ['pipeline-holidays-ignored', 'pipeline/lib/calendar.mjs', 'return w !== 0 && w !== 6 && !holidays.has(date);', 'return w !== 0 && w !== 6;'],
  ['pipeline-effr-revision-any-later-day', 'pipeline/lib/classify.mjs', 'if (runEtDate === pub) {', 'if (runEtDate >= pub) {'],
  ['pipeline-effr-flag-window-3-days', 'pipeline/lib/classify.mjs', 'runEtDate <= calendar.addBusinessDays(pub, 2)', 'runEtDate <= calendar.addBusinessDays(pub, 3)'],
  ['pipeline-statistics-window-21-days', 'pipeline/lib/classify.mjs', 'calendar.addBusinessDays(quarter.end, series.revision.statistics_window_business_days)', 'calendar.addBusinessDays(quarter.end, series.revision.statistics_window_business_days + 1)'],
  ['pipeline-debt-change-published', 'pipeline/lib/classify.mjs', "if (diff.changed.length) return hold(diff, 'a published value changed", "if (false) return hold(diff, 'a published value changed"],
  ['pipeline-h6-same-release-accepted', 'pipeline/lib/classify.mjs', "typeof seen === 'string' && latest > seen", "typeof seen === 'string' && latest >= seen"],
  ['pipeline-alert-ratio-inclusive', 'pipeline/lib/classify.mjs', '> scale(ratioText, rPlaces) * abs(o)', '>= scale(ratioText, rPlaces) * abs(o)'],
  ['pipeline-derived-ignores-held-source', 'pipeline/lib/classify.mjs', "if (ctx.source?.outcome === 'revised-unexpected' && !isSame(diff))", 'if (false && !isSame(diff))'],
  ['pipeline-gate-archive-rewrite-allowed', 'pipeline/lib/gate.mjs', 'if (old !== null && old !== text) add(4,', 'if (false) add(4,'],
  ['pipeline-gate-restamp-allowed', 'pipeline/lib/gate.mjs', ' || before.retrieved_at !== st.retrieved_at) add(5,', ') add(5,'],
  ['pipeline-gate-revision-records-unchecked', 'pipeline/lib/gate.mjs', 'if (JSON.stringify(a) !== JSON.stringify(b)) add(6,', 'if (false) add(6,'],
  ['pipeline-thirteenth-pin-accepted', 'pipeline/lib/retention.mjs', 'if (pins.pins.length >= MAX_PINS)', 'if (pins.pins.length > MAX_PINS)'],
  ['pipeline-budget-warning-late', 'pipeline/lib/retention.mjs', 'value >= l.warning ?', 'value > l.warning ?'],
  ['pipeline-window-36-days', 'pipeline/lib/retention.mjs', "> cutoff) mark(id, 'window')", ">= cutoff) mark(id, 'window')"],
  ['pipeline-revision-snapshot-prunable', 'pipeline/lib/retention.mjs', 'snapshot.revisions.length > 0 || ', ''],
  ['pipeline-alert-repeated', 'pipeline/lib/alerts.mjs', 'if (old.severity !== a.severity || old.title !== a.title || old.body !== a.body) plan.push', 'if (true) plan.push'],
  ['pipeline-bearer-text-published', 'pipeline/lib/alerts.mjs', "['a bearer credential', /Bearer /],", "['a bearer credential', /BEARER /],"],
  ['pipeline-403-not-blocking', 'pipeline/lib/run.mjs', 'if (r.status === 403 || r.status === 429) {', 'if (r.status === 429) {'],
  ['pipeline-fourth-retry', 'pipeline/lib/run.mjs', 'if (attempt < source.request.max_retries) {', 'if (attempt <= source.request.max_retries) {'],
  ['pipeline-retry-after-ignored', 'pipeline/lib/run.mjs', 'await ctx.o.wait(Math.max(2 ** (attempt + 1),', 'await ctx.o.wait(Math.min(2 ** (attempt + 1),'],
  ['pipeline-weekly-fetch-on-monday', 'pipeline/lib/run.mjs', 'const sunday = weekday(ctx.runEt) === 0 && !(typeof last', 'const sunday = weekday(ctx.runEt) === 1 && !(typeof last'],
  ['pipeline-frozen-series-published', 'pipeline/lib/run.mjs', 'if (standing.length) {', 'if (false) {'],
  ['pipeline-hold-closes-on-allowed-change', 'pipeline/lib/run.mjs', "if (oldHold && r.outcome !== 'revised-unexpected') {", 'if (false) {'],
  ['pipeline-rolled-back-not-withdrawn', 'pipeline/lib/run.mjs', "e.events.push(event('withdrawn', c.rollback.reason));", "e.events.push(event('superseded', c.rollback.reason));"],
  ['pipeline-review-without-reason', 'pipeline/lib/run.mjs', 'if (!text(o.reviewer) || !text(o.reason)) return', 'if (false) return'],
  // P2.2 corrections and the P2.3 collector adapters (DATA_CONVENTIONS v0.3 sections 11.4, 17.5, 17.6 and 18)
  ['pipeline-history-start-unchecked', 'pipeline/lib/normalize.mjs', 'if (firstWithValue && firstWithValue[key] !== series.earliest) problems.push(', 'if (false) problems.push('],
  ['pipeline-missing-day-unchecked', 'pipeline/lib/normalize.mjs', 'if (!have.has(d) && !gaps.has(d) && calendar.isBusinessDay(d)) problems.push(', 'if (false) problems.push('],
  ['pipeline-holiday-record-accepted', 'pipeline/lib/normalize.mjs', '&& !calendar.isBusinessDay(o.period) && !known.has(o.period)) problems.push(', '&& false) problems.push('],
  ['pipeline-rollback-unrecorded', 'pipeline/lib/gate.mjs', 'if (JSON.stringify(norm(want)) !== JSON.stringify(norm(got))) add(6,', 'if (false) add(6,'],
  ['pipeline-retention-decision-silent', 'pipeline/lib/retention.mjs', 'if (measured.publishedBytes >= BUDGET_LEVELS.published.critical) alerts.push', 'if (false) alerts.push'],
  ['pipeline-zip-crc-unchecked', 'pipeline/lib/zip.mjs', 'if (crc32(out) !== e.crc) throw', 'if (false) throw'],
  ['pipeline-zip-size-unbounded', 'pipeline/lib/zip.mjs', 'if (e.size > maxBytes) throw', 'if (false) throw'],
  ['pipeline-doctype-accepted', 'pipeline/lib/sdmx.mjs', 'if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) throw', 'if (false) throw'],
  ['pipeline-foreign-host-requested', 'pipeline/collectors/adapters.mjs', "if (url.protocol !== 'https:' || url.host !== source.host) return", 'if (false) return'],
  ['pipeline-request-budget-ignored', 'pipeline/collectors/adapters.mjs', 'if (n >= budgets.requestsPerHost) return', 'if (false) return'],
  ['pipeline-stale-approval-published', 'pipeline/lib/run.mjs', 'if (hold.candidate.sha256 !== o.candidate_sha256) return', 'if (false) return'],
  ['pipeline-debt-deadline-a-day-early', 'pipeline/lib/tree.mjs', ': calendar.nextBusinessDay(period);', ': period;'],
  ['pipeline-total-count-unchecked', 'pipeline/lib/normalize.mjs', 'else if (total !== rows.length) problems.push(', 'else if (false) problems.push('],
  ['pipeline-weekend-list-ignored', 'pipeline/lib/normalize.mjs', '[0, 6].includes(weekday(p)) && !known.has(p)) {', '[0, 6].includes(weekday(p))) {'],
  // DATA_CONVENTIONS v0.4: CSV segments, zones, documented gaps, held windows, review authorization, absences, route notices
  ['pipeline-unchanged-csv-rewritten', 'pipeline/lib/tree.mjs', 'const at = before && csv && before.sha256 === o.sha256 ? csv.retrieved_at : retrievedAt;', 'const at = retrievedAt;'],
  ['pipeline-deadline-earliest-reading', 'pipeline/lib/tree.mjs', 'return { expected: r.earliest, deadline: addHours(r.latest, cal.grace_hours) };', 'return { expected: r.earliest, deadline: addHours(r.earliest, cal.grace_hours) };'],
  ['pipeline-documented-gap-awaited', 'pipeline/lib/tree.mjs', 'while (gaps.has(d)) d = calendar.nextBusinessDay(d);', 'while (false) d = calendar.nextBusinessDay(d);'],
  ['pipeline-held-history-dropped', 'pipeline/lib/run.mjs', 'const baseOf = (id) => ctx.heldObservations[id] ?? ', 'const baseOf = (id) => '],
  ['pipeline-review-any-permission', 'pipeline/lib/run.mjs', 'if (!ctx.registry.family_policy.review.permissions.includes(o.reviewer_permission)) return', 'if (false) return'],
  ['pipeline-review-bot-accepted', 'pipeline/lib/run.mjs', 'if (AUTOMATION.test(o.reviewer.trim())) return', 'if (false) return'],
  ['pipeline-permission-hour-exclusive', 'pipeline/lib/run.mjs', 'now - at <= PERMISSION_MAX_AGE_SECONDS * 1000', 'now - at < PERMISSION_MAX_AGE_SECONDS * 1000'],
  ['pipeline-review-record-collides', 'pipeline/lib/run.mjs', '-${decision}-${snapshotId(ctx.now)}.json`;', '-${decision}.json`;'],
  ['pipeline-late-source-as-failure', 'pipeline/lib/run.mjs', ": ['source-overdue', 'after-deadline']);", ": ['collection-failure', 'fetch-failed']);"],
  ['pipeline-gap-as-invalid-series', 'pipeline/lib/run.mjs', 'const bad = r.seriesInvalid === true && r.otherProblems !== false;', 'const bad = r.seriesInvalid === true;'],
  ['pipeline-gate-csv-unchecked', 'pipeline/lib/gate.mjs', 'if (!g || canonicalJson(g) !== canonicalJson(e)) add(9,', 'if (false) add(9,'],
  ['pipeline-route-check-window-long', 'pipeline/lib/alerts.mjs', 'dayDiff(today, n.date) >= -30)', 'dayDiff(today, n.date) >= -31)'],
  // DATA_CONVENTIONS v0.5: locks (rejected and rolled back), clear, zero amounts, request identification
  ['pipeline-rollback-lock-lifts-itself', 'pipeline/lib/run.mjs', "(l) => l.origin === 'rolled-back' || beforeWindow(l) || carriesLock(", '(l) => beforeWindow(l) || carriesLock('],
  ['pipeline-rejected-locks-forgotten', 'pipeline/lib/run.mjs', 'const list = (snap?.frozen ?? []).map(', 'const list = [].map('],
  ['pipeline-rollback-locks-forgotten', 'pipeline/lib/run.mjs', 'if (man?.rollback) {', 'if (false) {'],
  ['pipeline-carries-ignores-periods', 'pipeline/lib/run.mjs', "if (field === 'period') return l ? c !== undefined && whole(c) === whole(l) : c === undefined;", "if (field === 'period') return false;"],
  ['pipeline-locked-approve-allowed', 'pipeline/lib/run.mjs', "if (ctx.locks.some((l) => l.series === o.series)) return { rule: 'locked'", "if (false) return { rule: 'locked'"],
  ['pipeline-clear-without-lock', 'pipeline/lib/run.mjs', "if (!mine.length) return { rule: 'not-locked'", "if (false) return { rule: 'not-locked'"],
  ['pipeline-rollback-not-locking', 'pipeline/lib/run.mjs', 'rolledBack.push({ series: s.id,', 'void ({ series: s.id,'],
  ['pipeline-zero-stored', 'pipeline/lib/normalize.mjs', 'else if (eraOf(p)?.refuse_zero === true && ZERO.test(v)) problems.push(', 'else if (false) problems.push('],
  ['pipeline-browser-user-agent', 'pipeline/collectors/adapters.mjs', "({ 'User-Agent': source.request.user_agent,", "({ 'User-Agent': 'Mozilla/5.0',"],
  ['pipeline-lock-change-not-significant', 'pipeline/lib/retention.mjs', '|| locks(snapshot) !== locks(previous);', '|| false;'],
  // DATA_CONVENTIONS v0.6: several locks, window rule, kept rejections, rollback records, accepted zeros, live transport, state store
  ['pipeline-new-periods-unlocked', 'pipeline/lib/run.mjs', "for (const p of diff.added) out.push({ period: p, field: 'period' });", 'for (const p of diff.added) void p;'],
  ['pipeline-window-rule-ignored', 'pipeline/lib/run.mjs', "(l) => l.origin === 'rolled-back' || beforeWindow(l) || carriesLock(", "(l) => l.origin === 'rolled-back' || carriesLock("],
  ['pipeline-rollback-drops-rejections', 'pipeline/lib/run.mjs', 'for (const l of [...targetLocks, ...ctx.locks, ...rolledBack]) {', 'for (const l of [...targetLocks, ...rolledBack]) {'],
  ['pipeline-rollback-record-ignored', 'pipeline/lib/run.mjs', 'for (const l of JSON.parse(text).locks) list.push(', 'for (const l of []) list.push('],
  ['pipeline-clear-lifts-all-locks', 'pipeline/lib/run.mjs', '&& l.series === o.series && l.candidate_sha256 === o.candidate_sha256));', '&& l.series === o.series));'],
  ['pipeline-zero-accepted-anywhere', 'pipeline/lib/normalize.mjs', '&& accepted.has(`${p}|${field}`)) continue;', ') continue;'],
  ['pipeline-future-zero-allowed', 'pipeline/lib/registry-policy.mjs', 'if (!(z.period <= z.checked) || !(z.period <= String(z.authorized_at).slice(0, 10))) add(', 'if (false) add('],
  ['pipeline-transport-any-host', 'pipeline/collectors/live-transport.mjs', "if (u.protocol !== 'https:' || !hosts.has(u.host) ||", "if (u.protocol !== 'https:' ||"],
  ['pipeline-state-extra-file-accepted', 'pipeline/lib/state-store.mjs', 'for (const p of present) if (!listed.has(p)) problems.push(', 'for (const p of present) if (false) problems.push('],
  ['pipeline-state-manifest-unchecked', 'pipeline/lib/state-store.mjs', '|| sha(readFileSync(manifest)) !== descriptor.manifest_sha256) problems.push(', ') problems.push('],
  ['pipeline-state-schema-unchecked', 'pipeline/lib/state-store.mjs', 'const schema = stateSchema(p);', 'const schema = null;'],
  ['pipeline-state-v2-schema-unchecked', 'pipeline/lib/state-store.mjs', 'const schema = stateSchemaV2(p);', 'const schema = null;'],
  ['pipeline-state-force-push', 'pipeline/lib/state-store.mjs', "const push = run(['push', '-q', remote,", "const push = run(['push', '-q', '--force', remote,"],
  // Stage C (conventions v0.7, section 21)
  ['pipeline-sunday-full-every-run', 'pipeline/lib/run.mjs', "const sunday = weekday(ctx.runEt) === 0 && !(typeof last === 'string' && etDate(last) === ctx.runEt);", 'const sunday = weekday(ctx.runEt) === 0;'],
  ['pipeline-full-fetch-invalid-counts', 'pipeline/lib/run.mjs', "!g.members.every((s) => ['failed', 'invalid'].includes(results[s.id].outcome))", "!g.members.every((s) => ['failed'].includes(results[s.id].outcome))"],
  ['pipeline-extra-alerts-dropped', 'pipeline/lib/run.mjs', 'for (const a of ctx.o.extraAlerts ?? []) alerts.push(a);', 'for (const a of []) alerts.push(a);'],
  ['pipeline-operation-mode-collects', 'pipeline/lib/run.mjs', "if (o.mode === 'operation') return Promise.reject(", "if (false) return Promise.reject("],
  ['pipeline-schedule-hourly', 'pipeline/lib/tree.mjs', "export const SCHEDULE = ['17 */4 * * *'];", "export const SCHEDULE = ['17 * * * *'];"],
  ['pipeline-health-gap-old', 'pipeline/lib/schedule-health.mjs', 'runGapWarningHours: 9,', 'runGapWarningHours: 26,'],
  ['pipeline-state-gitattributes-unchecked', 'pipeline/lib/state-store.mjs', 'else if (!readFileSync(ga).equals(Buffer.from(GITATTRIBUTES))) problems.push(', 'else if (false) problems.push('],
  ['pipeline-state-crlf-undiagnosed', 'pipeline/lib/state-store.mjs', 'return lf.length !== bytes.length && sha(lf) === sha256 ?', 'return false ?'],
  ['pipeline-state-named-files-unchecked', 'pipeline/lib/state-store.mjs', 'if (sha(b) !== ref.sha256) problems.push(mismatchText(', 'if (false) problems.push(mismatchText('],
  ['pipeline-state-unpromoted-accepted', 'pipeline/lib/state-store.mjs', 'if (!listed.has(`${STATE_DIR}/${ACCEPTED}`)) problems.push(', 'if (false) problems.push('],
  ['pipeline-state-accepted-mismatch', 'pipeline/lib/state-store.mjs', 'if (!a || a.snapshot !== manifest.snapshot.id || a.manifest_sha256 !== descriptor.manifest_sha256) problems.push(', 'if (!a) problems.push('],
  ['pipeline-state-run-twice', 'pipeline/lib/state-store.mjs', 'if (existsSync(recordFile)) throw new Error(', 'if (false) throw new Error('],
  ['pipeline-state-budget-level', 'pipeline/lib/state-store.mjs', 'if (bytes <= 50_000_000) return null;', 'if (bytes <= 60_000_000) return null;'],
  ['pipeline-validation-ignored', 'pipeline/bin/collect.mjs', 'if (checker.fail !== 0) throw new Error(`validation failed: the independent checker found ${checker.fail} failure(s) in the working root', 'if (false) throw new Error(`validation failed: the independent checker found ${checker.fail} failure(s) in the working root'],
  ['pipeline-record-fields-loose', 'pipeline/bin/collect.mjs', 'const responseRecord = (meta) => Object.fromEntries(RECORD_FIELDS.map((k) => [k, meta[k] ?? null]));', 'const responseRecord = (meta) => ({ ...meta, body: null });'],
  ['pipeline-freshness-never-stale', 'pipeline/lib/freshness.mjs', "status = t && now >= t.staleAt ? 'stale' : 'fresh';", "status = t && now >= t.staleAt ? 'fresh' : 'fresh';"],
  ['pipeline-issues-duplicates-kept', 'pipeline/bin/issues.mjs', "for (const x of extra) actions.push({ action: 'close', number: x.number, key: k, why: 'duplicate' });", 'for (const x of []) actions.push(x);'],
  ['pipeline-issues-never-edited', 'pipeline/bin/issues.mjs', "if (keep.title !== t.title || keep.body !== t.body) actions.push({ action: 'edit'", "if (false) actions.push({ action: 'edit'"],
  ['pipeline-op-automation-allowed', 'pipeline/bin/state-op.mjs', "if (AUTOMATION.test(actor.trim())) return 'an automation account cannot operate on the state store';", 'if (false) return null;'],
  ['pipeline-promote-state-before-record', 'pipeline/lib/state-store.mjs', 'const descriptor = describeV2(checkout, { run, writtenAt: writtenAt < record.ended_at ? record.ended_at : writtenAt });', 'const descriptor = describeV2(checkout, { run, writtenAt: now });'],
  ['pipeline-export-state-before-record', 'pipeline/lib/state-store.mjs', 'const descriptor = describeV2(checkout, { run, writtenAt: writtenAt < full.ended_at ? full.ended_at : writtenAt });', 'const descriptor = describeV2(checkout, { run, writtenAt: record.started_at });'],
  ['pipeline-schema-not-ignored', 'pipeline/lib/json-schema.mjs', 'if (e.length === 0) errors.push(`${path}: matches a schema it must not match`);', 'if (false) errors.push(`${path}: matches a schema it must not match`);'],
  // Stage C timer and watcher (21.3, 21.9, amendment 1 to v0.7)
  ['pipeline-timer-runs-not-scheduled', 'pipeline/lib/run-facts.mjs', 'return run.event === \'workflow_dispatch\' && typeof run.display_title === \'string\' && run.display_title.startsWith(TIMER_TITLE_PREFIX);', 'return false;'],
  ['pipeline-any-dispatch-scheduled', 'pipeline/lib/run-facts.mjs', 'run.display_title.startsWith(TIMER_TITLE_PREFIX);', 'run.display_title.startsWith(\'collect\');'],
  ['pipeline-watch-manifest-findings-kept', 'pipeline/bin/watch.mjs', '.filter((f) => RUN_KEYS.includes(f.key));', '.filter(() => true);'],
  ['pipeline-watch-reconciles-all-keys', 'pipeline/bin/watch.mjs', '{ only: new Set(WATCH_KEYS) }', '{ only: null }'],
  ['pipeline-watch-fails-on-any-finding', 'pipeline/bin/watch.mjs', 'export const watchFails = (findings) => findings.some(', 'export const watchFails = (findings) => findings.length > 0 || findings.some('],
  ['pipeline-watch-unread-facts-ignored', 'pipeline/bin/watch.mjs', "if (!r.ok) throw new Error(`GitHub API GET ${path.split('?')[0]", "if (false) throw new Error(`GitHub API GET ${path.split('?')[0]"],
  ['pipeline-timer-watch-routed-to-collect', 'pipeline/timer/worker.mjs', 'if (minute === \'47:00\') return { workflow: \'watch.yml\', inputs: { slot } };', 'if (minute === \'47:00\') return { workflow: \'collect.yml\', inputs: { mode: \'timer\', slot } };'],
  ['pipeline-timer-4xx-retried', 'pipeline/timer/worker.mjs', 'return status === 0 || status === 429 || status >= 500;', 'return status === 0 || status === 429 || status >= 400;'],
  ['pipeline-timer-slot-milliseconds', 'pipeline/timer/worker.mjs', '.replace(/\\.\\d{3}Z$/, \'Z\');', '.replace(/Z$/, \'Z\');'],
  ['pipeline-timer-slot-seconds-kept', 'pipeline/timer/worker.mjs', 'new Date(Math.floor(scheduledTime / 60_000) * 60_000).toISOString()', 'new Date(scheduledTime).toISOString()'],
  // Stage D v0.8 (9, 10, 17.6, 21.6, 22.3, 22.9; appendix I rows I7, I44, I45)
  ['pipeline-v08-i7-terms-kept', 'pipeline/lib/rules.mjs', 'v07.sources[\'nyfed-markets\'].terms_url = V07_NYFED_TERMS;', 'v07.sources[\'nyfed-markets\'].terms_url = v07.sources[\'nyfed-markets\'].terms_url;'],
  ['pipeline-v08-notice-unsorted', 'pipeline/lib/rules.mjs', 'for (const id of Object.keys(registry.sources).sort()) {', 'for (const id of Object.keys(registry.sources)) {'],
  ['pipeline-v08-notice-lines-repeated', 'pipeline/lib/rules.mjs', 'if (!seen.has(line)) {', 'if (true) {'],
  ['pipeline-v08-notice-no-l1', 'pipeline/lib/rules.mjs', 'lines.push(L1_STATEMENT);', 'lines.push(\'\');'],
  ['pipeline-v08-archived-registry-unhashed', 'pipeline/lib/rules.mjs', 'if (archived !== null && sha256Hex(archived) === h) text = archived;', 'if (archived !== null) text = archived;'],
  ['pipeline-v08-revision-csv-unquoted', 'pipeline/lib/tree.mjs', 'return /[",\\n]/.test(t) ? `"${t.replace(/"/g, \'""\')}"` : t;', 'return t;'],
  ['pipeline-v08-stale-not-followed', 'pipeline/lib/tree.mjs', 'const followed = s.staleness.follows !== undefined ? (times[s.staleness.follows] ?? null) : own;', 'const followed = own;'],
  ['pipeline-v08-manifest-v3', 'pipeline/lib/tree.mjs', 'schema: \'rmf.econ.manifest/4\',', 'schema: \'rmf.econ.manifest/3\','],
  ['pipeline-v08-gate-notice-copy-unchecked', 'pipeline/lib/gate.mjs', 'if (notice !== null && staged.get(\'NOTICE.txt\') !== notice) add(9,', 'if (false) add(9,'],
  ['pipeline-v08-gate-registry-versions-unchecked', 'pipeline/lib/gate.mjs', 'if (JSON.stringify([...versions].sort()) !== JSON.stringify(want)) add(9,', 'if (false) add(9,'],
  ['pipeline-v08-gate-rule-hash-unchecked', 'pipeline/lib/gate.mjs', 'if (hash !== r.sha256) add(3, `rules ${what}: ${r.path} does not match its hash`);', 'void hash;'],
  ['pipeline-v08-reason-utf16-length', 'pipeline/lib/alerts.mjs', 'if ([...text].length > MAX_TEXT)', 'if (text.length > MAX_TEXT)'],
  ['pipeline-v08-operate-reason-unchecked', 'pipeline/bin/state-op.mjs', 'if (why) throw new Error(`operation refused: the reason fails', 'if (false) throw new Error(`operation refused: the reason fails'],
  ['pipeline-v08-notice-txt-archived', 'pipeline/lib/store.mjs', 'const liveOnly = (path) => path === \'NOTICE.txt\' || path.startsWith(\'status/\');', 'const liveOnly = (path) => path.startsWith(\'status/\');'],
  ['pipeline-v08-window-drops-rules', 'pipeline/lib/retention.mjs', 'if (m.rules) for (const r of', 'if (false) for (const r of'],
  ['pipeline-v08-restore-notice-missing', 'pipeline/lib/run.mjs', '  if (manifest.rules) {\n    const notice = files.find', '  if (false) {\n    const notice = files.find'],
  ['pipeline-v08-self-check-all-findings', 'pipeline/lib/run.mjs', '.filter((f) => SELF_CHECK_KEYS.has(f.key))', '.filter(() => true)'],
  ['pipeline-v08-private-log-post-unfixed', 'pipeline/lib/publication.mjs', 'if (last && last.verification.post === null && newestPost !== null) last.verification.post = newestPost;', 'void newestPost;'],
  ['pipeline-v08-fix-post-site-ignored', 'pipeline/lib/publication.mjs', 'if (facts.siteConclusion === \'success\') return', 'if (true) return'],
  ['pipeline-v08-chain-numbering', 'pipeline/lib/publication.mjs', 'const number = list.length ? list[list.length - 1].number + 1 : 1;', 'const number = 1;'],
  ['pipeline-v08-noop-any-post', 'pipeline/lib/publication.mjs', 'return Boolean(d && d.post === \'passed\' && sameDataset(d.dataset, accepted));', 'return Boolean(d && sameDataset(d.dataset, accepted));'],
  ['pipeline-v08-cas-skipped', 'pipeline/lib/site-build.mjs', 'if (currentText(deployed.dataset) !== expected_current) return', 'if (false) return'],
  ['pipeline-v08-monotonic-allows-equal', 'pipeline/lib/site-build.mjs', 'if (input.snapshot > deployed.dataset.snapshot) return null;', 'if (input.snapshot >= deployed.dataset.snapshot) return null;'],
  ['pipeline-v08-redeploy-any-target', 'pipeline/lib/site-build.mjs', 'const target = list.slice(0, -1).find((d) => d.verification.post === \'passed\' && ', 'const target = list.slice(0, -1).find((d) => '],
  ['pipeline-v08-release-sums-unchecked', 'pipeline/lib/site-build.mjs', 'if (Buffer.from(sums).toString(\'utf8\') !== sha256Sums(rest)) throw', 'if (false) throw'],
  ['pipeline-v08-artifact-sha-unchecked', 'pipeline/lib/site-build.mjs', 'if (artifactSha256(files) !== newest.artifact.sha256) throw', 'if (false) throw'],
  ['pipeline-v08-archive-links-allowed', 'pipeline/lib/publication.mjs', 'if (type !== \'0\' && type !== \'\\0\') throw', 'if (false) throw'],
  ['pipeline-v08-archive-outside-allowed', 'pipeline/lib/publication.mjs', 'if (!name.startsWith(\'econ/\') ||', 'if (false ||'],
  ['pipeline-v08-allow-list-open', 'pipeline/lib/publication.mjs', '|| /^(objects|series|snapshots|revisions|registry|notices)\\//.test(path);', '|| true;'],
  ['pipeline-v08-d55-ignores-public', 'pipeline/lib/publication.mjs', 'return withdrawn.filter((id) => inWindow.has(id) && !publicSnapshots.has(id)).sort();', 'return withdrawn.filter((id) => inWindow.has(id)).sort();'],
  ['pipeline-v08-behind-any-time', 'pipeline/lib/publication.mjs', 'if (hours <= BEHIND_HOURS) return null;', 'void hours;'],
  ['pipeline-v08-collector-closes-foreign', 'pipeline/bin/issues.mjs', 'if ((only && !only.has(k)) || (except && except.has(k))) continue;', 'if (only && !only.has(k)) continue;'],
  ['pipeline-v08-gzip-os-byte', 'pipeline/lib/publication.mjs', 'gz[9] = 255;', 'void gz;'],
  ['pipeline-v08-watch-no-publication-keys', 'pipeline/bin/watch.mjs', 'const pub = facts.publication ?? null;', 'const pub = null;'],
  ['pipeline-v08-history-deleted-unchecked', 'pipeline/lib/publication.mjs', 'if (!r) out.push(`release ${d.release} of entry', 'if (false) out.push(`release ${d.release} of entry'],
  ['pipeline-v08-history-deployed-ignored', 'pipeline/lib/publication.mjs', '  if (deployedLog) {', '  if (false) {'],
  ['pipeline-v08-watch-history-not-failing', 'pipeline/bin/watch.mjs', ' || f.key === HISTORY_KEY || (f.key === \'manifest-overdue\'', ' || (f.key === \'manifest-overdue\''],
  ['pipeline-v08-watch-reconciles-run-keys-only', 'pipeline/bin/watch.mjs', '{ only: new Set(WATCH_KEYS) }', '{ only: new Set(RUN_KEYS) }'],
  ['pipeline-v08-assemble-any-store', 'pipeline/bin/publish.mjs', 'if (layout !== \'v0.7\') return { outcome: \'refused-v2\'', 'if (false) return { outcome: \'refused-v2\''],
  ['pipeline-v08-assemble-unverified-redeploy', 'pipeline/bin/publish.mjs', 'if (o.mode === \'redeploy\' && !verifiedPairs(prevLog).some(', 'if (false && !verifiedPairs(prevLog).some('],
  ['pipeline-v08-assemble-v2c-ignored', 'pipeline/bin/publish.mjs', 'if (c.fail !== 0) return { outcome: \'refused-v2\', problems: [`V2c:', 'if (false) return { outcome: \'refused-v2\', problems: [`V2c:'],
  ['pipeline-v08-report-automatic-closes', 'pipeline/bin/publish.mjs', 'if (result.person) want.delete(\'publication-verify-failed\');', 'want.delete(\'publication-verify-failed\');'],
  ['pipeline-v08-site-input-any', 'pipeline/bin/site-data.mjs', 'return want === got ? null :', 'return true ? null :'],
  ['pipeline-v08-window-future-snapshots', 'pipeline/lib/publish-store.mjs', '.filter(([, s]) => s.created_at <= asOf)', '.filter(() => true)'],
  // v0.8 amendment 2 (P114): the record numbers keep the gaps of unanswered requests, and V3
  // retries a transient file fetch failure a bounded number of times, never a mismatch.
  ['pipeline-a2-transport-records-late-answer', 'pipeline/collectors/live-transport.mjs', 'if (done) return; // ended already', 'if (false) return; // ended already'],
  ['pipeline-a2-v3-no-retry', 'pipeline/bin/publish.mjs', 'while (v3Transient(r) && retries < retryWaits.length) {', 'while (false) {'],
  ['pipeline-a2-v3-retry-unbounded', 'pipeline/bin/publish.mjs', 'while (v3Transient(r) && retries < retryWaits.length) {', 'while (v3Transient(r) && retries <= retryWaits.length) {'],
  ['pipeline-a2-v3-retry-any-4xx', 'pipeline/bin/publish.mjs', 'r.status === 408 || r.status === 429 ||', 'r.status >= 400 ||'],
  ['pipeline-a2-v3-retry-mismatch', 'pipeline/bin/publish.mjs', "export const v3Transient = (r) => !r.ok && (", 'export const v3Transient = (r) => r.ok || ('],
  ['pipeline-a2-v3get-status-lost', 'pipeline/bin/publish.mjs', 'return { ok: false, status: r.status };', 'return { ok: false };'],
  // v0.8 amendment 3 (P115): the newest release by published_at, then numeric id (never the
  // tagged commit's created_at); its log ends with its own entry; the watcher reads the same
  // newest release; a dataset the site already deploys is never released again.
  ['pipeline-a3-order-no-id-tiebreak', 'pipeline/lib/publication.mjs', 'return ta - tb || ia - ib;', 'return ta - tb;'],
  ['pipeline-a3-order-id-as-text', 'pipeline/lib/publication.mjs', 'return ta - tb || ia - ib;', 'return ta - tb || String(ia).localeCompare(String(ib));'],
  ['pipeline-a3-newest-is-oldest', 'pipeline/lib/publication.mjs', 'return list.length ? list.sort(compareReleases)[list.length - 1] : null;', 'return list.length ? list.sort(compareReleases)[0] : null;'],
  ['pipeline-a3-published-at-unchecked', 'pipeline/lib/publication.mjs', 'if (!Number.isFinite(t)) throw', 'if (false) throw'],
  ['pipeline-a3-id-unchecked', 'pipeline/lib/publication.mjs', 'if (!Number.isSafeInteger(r.id) || r.id <= 0) throw', 'if (false) throw'],
  ['pipeline-a3-facts-own-log-ignored', 'pipeline/bin/publication-facts.mjs', 'if (own) throw new Error(own);', 'if (false) throw new Error(own);'],
  ['pipeline-a3-watch-longest-log', 'pipeline/bin/watch.mjs', 'const top = releases.find((r) => r.rel === newestRel);', 'const top = [...releases].sort((a, b) => a.log.deployments.length - b.log.deployments.length).pop();'],
  ['pipeline-a3-assemble-deployed-released', 'pipeline/bin/publish.mjs', "if ((o.mode === 'manual' || o.mode === 'timer') && sameDataset(o.deployed, accepted)) {", 'if (false) {'],
  ['pipeline-a3-report-refused-deployed-silent', 'pipeline/bin/publish.mjs', "outcome.outcome === 'no-op' || outcome.outcome === 'refused-gate';", "outcome.outcome === 'no-op' || outcome.outcome === 'refused-gate' || outcome.outcome === 'refused-deployed';"],
];

// The dashboard mutants (brief Q): each tools/audit/mutants/*.mjs exports MUTANTS in the same
// form, so each dashboard keeps its own list in a file it owns.
const EXTRA = resolve('tools', 'audit', 'mutants');
if (existsSync(EXTRA)) {
  for (const f of readdirSync(EXTRA).filter((n) => n.endsWith('.mjs')).sort()) MUTANTS.push(...(await import(pathToFileURL(join(EXTRA, f)).href)).MUTANTS);
}

// Equivalent mutants, deliberately not listed because no test can tell them apart:
// - compound.ts using `input.contribution` when the frequency is none: there are no
//   contribution dates then, so the amount is multiplied by zero everywhere.
// - loan.ts `balance + interest <= payment` changed to `<`: when balance + interest equals
//   the payment exactly, the regular branch posts principal = balance, extra = min(due, 0)
//   = 0 and a zero balance, which is the same row the final-payment branch posts.

// The pipeline belongs to finance-data (owner brief V item 3): a tree that carries pipeline/ (the
// development branch) runs its mutants here; a site-only tree reads the pipeline through
// ECON_TOOLS (tools/econ-tools.mjs) and leaves the pipeline's mutants to the tree that has it,
// and says so.
const HAS_PIPELINE = existsSync('pipeline');
if (!HAS_PIPELINE) {
  const skipped = MUTANTS.filter(([, file]) => file.startsWith('pipeline/')).length;
  for (let i = MUTANTS.length - 1; i >= 0; i -= 1) if (MUTANTS[i][1].startsWith('pipeline/')) MUTANTS.splice(i, 1);
  console.log(`mutation pass: pipeline/ is not in this tree; its ${skipped} mutants run where the pipeline is`);
}

const VITEST = resolve('node_modules', 'vitest', 'vitest.mjs');
const WORK = resolve('local', 'mutation-work');
// Everything the unit tests read, copied into the work tree.
const COPY = ['src/lib', 'src/pages/learn', 'src/styles/report.css', 'public/favicon.svg', 'tests/unit', 'tests/support', 'tests/oracle/fixtures', 'tools/text-scan.mjs', 'tools/econ-tools.mjs', 'vitest.config.ts', ...(HAS_PIPELINE ? ['pipeline', 'tests/datacheck'] : [])];

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

// The data pipeline and the site share no code: pipeline tests import only pipeline/, and the
// dashboard tests use only its fixture scenario, as test data. So a mutant is judged by the tests on its own side, which keeps the
// slower end-to-end pipeline tests out of every engine mutant's run. The unmodified baseline
// still runs everything.
function scopeFor(liveFile) {
  if (liveFile === null) return ['tests/unit'];
  return liveFile.startsWith('pipeline/') ? ['tests/unit/pipeline'] : ['tests/unit', '--exclude', 'tests/unit/pipeline/**'];
}

function runTests(liveFile = null) {
  const dir = mkdtempSync(join(tmpdir(), 'rmf-mutate-'));
  const report = join(dir, 'report.json');
  const run = spawnSync(process.execPath, [VITEST, 'run', ...scopeFor(liveFile), '--pool=threads', '--reporter=json', `--outputFile=${report}`], {
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
    const { failed, timedOut } = runTests(liveFile);
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
