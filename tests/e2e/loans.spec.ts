// The loan amortization and mortgage payoff calculators: payments, schedules by month and
// calendar year, the payoff comparison, the separate housing-cost panel, share links,
// exports, accessibility and layout.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { paymentBreakdown, payoffComparison } from '../../src/lib/engines/loan-report';
import { formatUSD } from '../../src/lib/calc/format';
import { storeTheme, url } from './helpers';

const AMORTIZATION = url('calculators/amortization/');
const PAYOFF = url('calculators/loan-payoff/');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function loan(page: Page, prefix: 'la' | 'mp', values: { principal: string; rate: string; term: string; unit?: 'years' | 'months'; month?: string; year?: string }) {
  await page.fill(`#${prefix}-principal`, values.principal);
  await page.fill(`#${prefix}-rate`, values.rate);
  await page.fill(`#${prefix}-term`, values.term);
  await page.selectOption(`#${prefix}-term-unit`, values.unit ?? 'years');
  if (values.month) await page.selectOption(`#${prefix}-first-month`, values.month);
  if (values.year) await page.fill(`#${prefix}-first-year`, values.year);
}

test.describe('loan amortization calculator', () => {
  test('shows the example without JavaScript, and the same with it', async ({ browser }) => {
    const values: string[] = [];
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled });
      const page = await context.newPage();
      await page.goto(AMORTIZATION);
      values.push((await page.locator('[data-out="payment"]').textContent())!);
      await context.close();
    }
    expect(values).toEqual(['$594.04', '$594.04']);
  });

  test('the requirements reference mortgage pays $1,199.10 a month', async ({ page }) => {
    await page.goto(AMORTIZATION);
    await loan(page, 'la', { principal: '200,000', rate: '6', term: '30', month: '1', year: '2027' });
    await expect(page.locator('[data-out="payment"]')).toHaveText('$1,199.10');
    await expect(page.locator('[data-out="payoff"]')).toHaveText('Dec 2056');
    await expect(page.locator('#la-schedule [data-out="table-rows"] > tr:not(.sched-detail)')).toHaveCount(30);
    await expect(page.locator('#la-schedule tfoot td').nth(4)).toHaveText('$0.00');
  });

  test('groups by payment, paging a long loan, and by calendar year with partial first and last years', async ({ page }) => {
    await page.goto(AMORTIZATION);
    await loan(page, 'la', { principal: '200,000', rate: '6', term: '360', unit: 'months', month: '7', year: '2027' });
    const rows = page.locator('#la-schedule [data-out="table-rows"] > tr:not(.sched-detail)');
    await expect(rows).toHaveCount(31);
    await expect(rows.first().locator('td').first()).toHaveText('6');
    await page.check('input[name="la-schedule-group"][value="month"]');
    await expect(rows).toHaveCount(120);
    await expect(rows.first().locator('th')).toHaveText('Jul 2027 (#1)');
    await expect(page.locator('#la-schedule [data-out="page-status"]')).toContainText('Page 1 of 3');
    await page.click('#la-schedule [data-page="last"]');
    await expect(rows.last().locator('th')).toHaveText('Jun 2057 (#360)');
    await expect(rows.last().locator('td').nth(3)).toHaveText('$0.00');
  });

  test('explains a loan that could never be paid off', async ({ page }) => {
    await page.goto(AMORTIZATION);
    await loan(page, 'la', { principal: '0.01', rate: '6', term: '3', unit: 'months' });
    await expect(page.locator('#la-rate-error')).toContainText('would not even cover the interest');
    await expect(page.locator('.calc')).toHaveAttribute('data-state', 'invalid');
  });

  test('downloads the schedule by payment as CSV with every payment', async ({ page }) => {
    await page.goto(AMORTIZATION);
    await page.check('input[name="la-schedule-group"][value="month"]');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="csv"]')]);
    expect(download.suggestedFilename()).toMatch(/^radmage-finance-loan-amortization-schedule-by-payment-[\d-]+\.csv$/);
    const lines = readFileSync((await download.path())!, 'utf8').trim().split('\r\n');
    expect(lines[0]).toBe('payment_number,year,month,payment_usd,principal_usd,interest_usd,balance_usd,cumulative_interest_usd,cumulative_principal_usd');
    expect(lines).toHaveLength(61);
    expect(lines[60]).toMatch(/^60,\d{4},\d{1,2},\d+\.\d{2},\d+\.\d{2},\d+\.\d{2},0\.00,\d+\.\d{2},30000\.00$/);
  });
});

test.describe('mortgage payoff calculator', () => {
  test('compares the loan with and without extra payments, and keeps housing costs apart', async ({ page }) => {
    await page.goto(PAYOFF);
    await loan(page, 'mp', { principal: '200,000', rate: '6', term: '30', month: '1', year: '2027' });
    await page.fill('#mp-extra', '0');
    await expect(page.locator('[data-out="hero"]')).toHaveText('$0.00');
    await expect(page.locator('[data-out="compare-rows"] tr').first().locator('td')).toHaveText(['Dec 2056', 'Dec 2056']);
    await page.fill('#mp-extra', '100');
    await expect(page.locator('[data-out="hero"]')).not.toHaveText('$0.00');
    await expect(page.locator('[data-out="part-pi"]')).toHaveText('$1,199.10');
    await page.fill('#mp-tax', '3,601');
    await expect(page.locator('[data-out="part-tax"]')).toHaveText('$300.08');
    // The housing costs never change the loan.
    await expect(page.locator('[data-out="part-pi"]')).toHaveText('$1,199.10');
  });

  test('shows the mortgage payment without HOA dues and the housing cost with them, as the engine figures them', async ({ page }) => {
    await page.goto(PAYOFF);
    await loan(page, 'mp', { principal: '200,000', rate: '6', term: '30', month: '1', year: '2027' });
    const cases = [
      { tax: '3,601', insurance: '1,500', mi: '90', hoa: '350' },
      { tax: '0', insurance: '0', mi: '0', hoa: '0' },
      { tax: '0', insurance: '0', mi: '0', hoa: '275.50' },
      { tax: '2,400.06', insurance: '0', mi: '0', hoa: '0' },
    ];
    const payment = payoffComparison({ principal: 20_000_000, annualRate: 0.06, termMonths: 360, extraMonthly: 10_000 }, { year: 2027, month: 1 });
    if (!payment.ok) throw new Error('invalid');
    await page.fill('#mp-extra', '100');
    const cents = (text: string) => Math.round(Number(text.replace(/,/g, '')) * 100);
    for (const c of cases) {
      await page.fill('#mp-tax', c.tax);
      await page.fill('#mp-insurance', c.insurance);
      await page.fill('#mp-mi', c.mi);
      await page.fill('#mp-hoa', c.hoa);
      const b = paymentBreakdown(payment.value.accelerated.schedule.payment, {
        propertyTaxAnnual: cents(c.tax),
        insuranceAnnual: cents(c.insurance),
        mortgageInsuranceMonthly: cents(c.mi),
        hoaMonthly: cents(c.hoa),
      });
      if (!b.ok) throw new Error('invalid');
      const want = { pi: b.value.principalAndInterest, tax: b.value.propertyTax, insurance: b.value.insurance, escrow: b.value.escrow, mi: b.value.mortgageInsurance, mortgage: b.value.mortgagePayment, hoa: b.value.hoa, total: b.value.total };
      await expect(page.locator('[data-out="part-total"]'), JSON.stringify(c)).toHaveText(formatUSD(want.total));
      for (const [key, value] of Object.entries(want)) {
        await expect(page.locator(`[data-out="part-${key}"]`), `${key} ${JSON.stringify(c)}`).toHaveText(formatUSD(value));
      }
      // HOA dues never enter the mortgage payment.
      expect(b.value.mortgagePayment).toBe(b.value.principalAndInterest + b.value.escrow + b.value.mortgageInsurance);
      expect(b.value.total - b.value.mortgagePayment).toBe(cents(c.hoa));
    }
  });

  test('applies a one-time payment in its month and says which month that is', async ({ page }) => {
    await page.goto(PAYOFF);
    await loan(page, 'mp', { principal: '200,000', rate: '6', term: '30', month: '1', year: '2027' });
    await page.fill('#mp-extra', '0');
    await page.fill('#mp-o1', '13');
    await page.fill('#mp-o1a', '5,000');
    await expect(page.locator('#mp-o1-hint')).toHaveText('Payment 13 is in Jan 2028.');
    await page.check('input[name="mp-schedule-group"][value="month"]');
    await expect(page.locator('#mp-schedule [data-out="table-rows"] > tr:not(.sched-detail)').nth(12).locator('td').nth(3)).toHaveText('$5,000.00');
    await page.fill('#mp-o1a', '');
    await expect(page.locator('#mp-o1a-error')).toContainText('Enter both');
  });

  test('a No amounts share link carries no dollar figure', async ({ page, context }) => {
    await page.goto(PAYOFF);
    await page.fill('#mp-o1', '24');
    await page.fill('#mp-o1a', '2,500');
    await expect(page.locator('[data-out="hero"]')).toBeVisible();
    await page.click('[data-action="share"]');
    await page.check('input[name="mp-share-amounts"][value="none"]');
    const link = await page.locator('#mp-share-link').inputValue();
    const inner = decodeURIComponent(link.split('#s=')[1]!);
    expect(inner).not.toMatch(/(^|&)(p|x|o1a|tx|in|mi|hoa)=/);
    expect(inner).toMatch(/(^|&)o1=24(&|$)/);
    const other = await context.newPage();
    await other.goto(link);
    await expect(other.locator('#mp-principal')).toHaveValue('');
    await expect(other.locator('#mp-o1')).toHaveValue('24');
    await expect(other.locator('.calc')).toHaveAttribute('data-state', 'incomplete');
  });

  test('the report compares both plans and lists the monthly payment parts', async ({ page }) => {
    await page.goto(PAYOFF);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="report"]')]);
    const html = readFileSync((await download.path())!, 'utf8');
    expect(html).toContain('<h1>Mortgage payoff calculator</h1>');
    expect(html).toContain('<h2>With and without the extra payments</h2>');
    expect(html).toContain('Estimated total monthly housing cost');
    expect(html).toContain('HOA dues (not part of the mortgage payment)');
    expect(html).not.toContain('Total monthly payment');
    // The report's breakdown matches the page, line for line.
    for (const key of ['pi', 'tax', 'insurance', 'escrow', 'mi', 'mortgage', 'hoa', 'total']) {
      const shown = (await page.locator(`[data-out="part-${key}"]`).textContent())!;
      expect(html, key).toContain(`<td>${shown}</td>`);
    }
    expect(html).toContain('<tr class="rmf-report__strong"><th scope="row">Estimated mortgage payment (to the lender)</th>');
    expect(html).not.toMatch(/<script/);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`both calculators have no accessibility violations in ${theme}`, async ({ browser }) => {
      const context = await browser.newContext();
      await storeTheme(context, theme);
      const page = await context.newPage();
      for (const path of [AMORTIZATION, PAYOFF]) {
        await page.goto(path);
        const prefix = path === AMORTIZATION ? 'la' : 'mp';
        await page.check(`input[name="${prefix}-schedule-group"][value="month"]`);
        expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => `${path} ${v.id}`)).toEqual([]);
        await page.fill(`#${prefix}-rate`, 'abc');
        await expect(page.locator(`#${prefix}-rate-error`)).toBeVisible();
        expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => `${path} ${v.id}`)).toEqual([]);
      }
      await context.close();
    });
  }

  test('a 320 px screen never scrolls sideways', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
    const page = await context.newPage();
    for (const path of [AMORTIZATION, PAYOFF]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(320);
    }
    await context.close();
  });
});
