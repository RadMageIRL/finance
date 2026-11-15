import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { storeTheme, url } from './helpers';

const PAGE = url('calculators/apr-apy/');
const conversions = JSON.parse(readFileSync('tests/oracle/fixtures/conversions.json', 'utf8'));

const hero = (page: Page) => page.locator('[data-out="hero"]');
const compareRow = (page: Page, i: number) => page.locator('[data-out="compare-rows"] tr').nth(i);
/** A fixture fraction ("0.0425") as the percent a visitor types ("4.25"). */
const percentText = (fraction: string) => String(Math.round(Number(fraction) * 1e8) / 1e6);

async function account(page: Page, i: number, values: { kind?: 'rate' | 'apy'; value?: string; n?: string }) {
  if (values.kind) await page.check(`input[name="ra-kind-${i}"][value="${values.kind}"]`);
  if (values.n) await page.selectOption(`#ra-n-${i}`, values.n);
  if (values.value !== undefined) await page.fill(`#ra-value-${i}`, values.value);
}

test.describe('APR and APY calculator', () => {
  test('shows the example comparison before any input, and the same with JavaScript off', async ({ browser }) => {
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled });
      const page = await context.newPage();
      await page.goto(PAGE);
      // 4.5% compounded daily (APY 4.6025%) against a 4.55% APY: engine and oracle agree.
      await expect(hero(page)).toHaveText('4.60% APY');
      await expect(page.locator('[data-out="hero-note"]')).toHaveText('Account A has the highest APY');
      await expect(page.locator('[data-out="compare-rows"] tr')).toHaveCount(2);
      await expect(compareRow(page, 0).locator('td').last()).toHaveText('$460.25');
      await context.close();
    }
  });

  const rateRows = [
    ['0.0525', 12],
    ['0.035', 365],
    ['0.075', 4],
    ['0.2499', 52],
  ] as const;
  for (const [rate, n] of rateRows) {
    test(`displays the oracle's APY for a ${rate} rate compounded ${n} times a year`, async ({ page }) => {
      const row = conversions.apy_from_nominal.find((r: { annual_rate: string; periods_per_year: number }) => r.annual_rate === rate && r.periods_per_year === n);
      test.skip(!row, 'fixture row missing');
      await page.goto(PAGE);
      await account(page, 1, { value: '' });
      await account(page, 0, { kind: 'rate', n: String(n), value: percentText(rate) });
      await expect(hero(page)).toHaveText(`${row.apy_percent}% APY`);
      await expect(compareRow(page, 0).locator('td').first()).toHaveText(`${row.apy_percent}%`);
    });
  }

  const apyRows = [
    ['0.0539', 365],
    ['0.05', 12],
    ['0.1', 2],
  ] as const;
  for (const [apy, n] of apyRows) {
    test(`displays the oracle's interest rate for a ${apy} APY compounded ${n} times a year`, async ({ page }) => {
      const row = conversions.nominal_from_apy.find((r: { apy: string; periods_per_year: number }) => r.apy === apy && r.periods_per_year === n);
      test.skip(!row, 'fixture row missing');
      await page.goto(PAGE);
      await account(page, 1, { value: '' });
      await account(page, 0, { kind: 'apy', n: String(n), value: percentText(apy) });
      const expected = `${(Number(row.annual_rate) * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
      await expect(compareRow(page, 0).locator('td').nth(1)).toContainText(expected);
    });
  }

  test('leaves blank accounts out, and asks for at least one rate', async ({ page }) => {
    await page.goto(PAGE);
    await account(page, 2, { value: '4.6', n: '1' });
    await expect(page.locator('[data-out="compare-rows"] tr')).toHaveCount(3);
    await expect(page.locator('[data-out="hero-note"]')).toContainText('Account C also shows 4.60% once rounded');
    for (const i of [0, 1, 2]) await page.fill(`#ra-value-${i}`, '');
    await expect(page.locator('.calc')).toHaveAttribute('data-state', 'invalid');
    await expect(page.locator('#ra-value-0-error')).toHaveText('Enter a rate for at least one account.');
    await expect(hero(page)).toBeHidden();
  });

  test('withholds results at once for a rate above 100%', async ({ page }) => {
    await page.goto(PAGE);
    const state = await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>('#ra-value-1')!;
      field.value = '150';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return document.querySelector<HTMLElement>('.calc')!.dataset.state;
    });
    expect(state).toBe('invalid');
    await expect(page.locator('#ra-value-1-error')).toHaveText('Rates up to 100% only.');
    await expect(page.locator('[data-action="csv"]')).toBeHidden();
  });

  test('a share link restores every account; a No amounts link leaves the balance blank', async ({ page, context }) => {
    await page.goto(PAGE);
    await page.fill('#ra-balance', '25,000');
    await account(page, 2, { kind: 'apy', value: '4.75', n: '4' });
    // Wait for the results to include account C: the table grows and moves the buttons.
    await expect(page.locator('[data-out="compare-rows"] tr')).toHaveCount(3);
    const heroText = await hero(page).textContent();
    await page.click('[data-action="share"]');
    const link = await page.locator('#ra-share-link').inputValue();
    const fresh = await context.newPage();
    await fresh.goto(link);
    await expect(fresh.locator('#ra-balance')).toHaveValue('25,000.00');
    await expect(fresh.locator('#ra-value-2')).toHaveValue('4.75');
    await expect(fresh.locator('#ra-n-2')).toHaveValue('4');
    await expect(fresh.locator('input[name="ra-kind-2"][value="apy"]')).toBeChecked();
    await expect(hero(fresh)).toHaveText(heroText!);

    await page.check('input[name="ra-share-amounts"][value="none"]');
    const blank = await page.locator('#ra-share-link').inputValue();
    expect(decodeURIComponent(blank)).not.toMatch(/[?&]?b=/);
    const other = await context.newPage();
    await other.goto(blank);
    await expect(other.locator('#ra-balance')).toHaveValue('');
    await expect(other.locator('.calc')).toHaveAttribute('data-state', 'incomplete');
    await expect(other.locator('#ra-balance')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(other.locator('#ra-value-2')).toHaveValue('4.75');
  });

  test('downloads the balance illustration as CSV', async ({ page }) => {
    await page.goto(PAGE);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="csv"]')]);
    expect(download.suggestedFilename()).toMatch(/^radmage-finance-apr-apy-balance-illustration-by-year-[\d-]+\.csv$/);
    const lines = readFileSync((await download.path())!, 'utf8').trim().split('\r\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('year,a_periods_completed,a_balance_usd,a_interest_in_period_usd,a_interest_to_date_usd,a_balance_unrounded_usd,b_periods_completed,b_balance_usd,b_interest_in_period_usd,b_interest_to_date_usd,b_balance_unrounded_usd');
    // After one year each account has grown by exactly its APY: 4.6025% for A, 4.55% for B.
    expect(lines[1]).toMatch(/^1,365,10460\.25,460\.25,460\.25,10460\.24958\d,12,10455\.00,455\.00,455\.00,10455\.000000$/);
  });

  test('the chart reads out each account from the keyboard', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('.calc-chart .chart-box').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.calc-chart .chart-tooltip')).toContainText('Account A: $460.25');
    await page.keyboard.press('End');
    await expect(page.locator('.calc-chart .chart-tooltip')).toContainText('Account B');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`has no accessibility violations in ${theme}, including errors and the open share panel`, async ({ browser }) => {
      const context = await browser.newContext();
      await storeTheme(context, theme);
      const page = await context.newPage();
      await page.goto(PAGE);
      await page.locator('.calc-table summary').click();
      await page.click('[data-action="share"]');
      const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
      expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => v.id)).toEqual([]);
      await page.fill('#ra-value-0', 'abc');
      await expect(page.locator('#ra-value-0-error')).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => v.id)).toEqual([]);
      await context.close();
    });
  }
});
