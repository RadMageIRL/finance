// Expandable year rows (ENGINE_CONVENTIONS section 14): each year shows its months on
// demand, one at a time or all at once, by mouse or keyboard; the month table totals back to
// the year; the exports include the months only when asked, whatever is expanded on screen.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { storeTheme, url } from './helpers';

const COMPOUND = url('calculators/compound-interest/');
const SAVINGS = url('calculators/savings-growth/');
const RATES = url('calculators/apr-apy/');
const AMORTIZATION = url('calculators/amortization/');
const PAYOFF = url('calculators/loan-payoff/');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const toggles = (page: Page, id: string) => page.locator(`#${id} [data-out="table-rows"] .sched-toggle`);
const detail = (page: Page, id: string, i: number) => page.locator(`#${id}-months-${i}`);

async function download(page: Page, action: string): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent('download'), page.click(`[data-action="${action}"]`)]);
  return { name: file.suggestedFilename(), text: readFileSync((await file.path())!, 'utf8') };
}

test.describe('months under each year', () => {
  test('each year expands and collapses on its own, and its months total back to the year', async ({ page }) => {
    await page.goto(COMPOUND);
    const t = toggles(page, 'ci-schedule');
    await expect(t).toHaveCount(10);
    await expect(t.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(detail(page, 'ci-schedule', 0)).toBeHidden();
    await t.nth(0).click();
    await t.nth(2).click();
    await expect(t.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(t.nth(2)).toHaveAttribute('aria-expanded', 'true');
    await expect(t.nth(1)).toHaveAttribute('aria-expanded', 'false');
    const year1 = detail(page, 'ci-schedule', 0);
    await expect(year1).toBeVisible();
    await expect(year1.locator('tbody tr')).toHaveCount(12);
    await expect(year1.locator('caption')).toHaveText('Year 1 by month: balances, contributions, interest accrued and credited');
    // The footer under year 1 repeats the year's own figures: deposits, accrued, credited, closing.
    const yearCells = await t.nth(0).locator('xpath=ancestor::tr[1]').locator('td').allTextContents();
    const footCells = await year1.locator('tfoot td').allTextContents();
    expect([footCells[1], footCells[2], footCells[3], footCells[5], footCells[6]]).toEqual([yearCells[1], yearCells[2], yearCells[3], yearCells[5], yearCells[6]]);
    // Collapsing one leaves the other open.
    await t.nth(0).click();
    await expect(t.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(year1).toBeHidden();
    await expect(detail(page, 'ci-schedule', 2)).toBeVisible();
  });

  test('Expand all and Collapse all; the state survives a recalculation and a trip to another grouping', async ({ page }) => {
    await page.goto(SAVINGS);
    const t = toggles(page, 'sg-schedule');
    const count = await t.count();
    expect(count).toBe(5);
    await page.click('#sg-schedule [data-action="expand-all"]');
    for (let i = 0; i < count; i += 1) await expect(t.nth(i)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#sg-schedule .sched-detail:visible')).toHaveCount(count);
    await expect(page.locator('#sg-schedule [data-out="expand-status"]')).toHaveText('Showing the months of all 5 years.');
    // A new deposit amount recalculates; the years stay open.
    await page.fill('#sg-contribution', '600');
    await expect(page.locator('#sg-schedule .sched-detail:visible')).toHaveCount(count);
    await page.click('#sg-schedule [data-action="collapse-all"]');
    await expect(page.locator('#sg-schedule .sched-detail:visible')).toHaveCount(0);
    // The controls belong to the year view only.
    await t.nth(1).click();
    await page.check('input[name="sg-schedule-group"][value="month"]');
    await expect(page.locator('#sg-schedule [data-out="expand-controls"]')).toBeHidden();
    await expect(toggles(page, 'sg-schedule')).toHaveCount(0);
    await page.check('input[name="sg-schedule-group"][value="year"]');
    await expect(page.locator('#sg-schedule [data-out="expand-controls"]')).toBeVisible();
    await expect(toggles(page, 'sg-schedule').nth(1)).toHaveAttribute('aria-expanded', 'true');
  });

  test('works from the keyboard: Enter and Space toggle a focused year', async ({ page }) => {
    await page.goto(AMORTIZATION);
    const first = toggles(page, 'la-schedule').first();
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(first).toBeFocused();
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await expect(first).toHaveAccessibleName(/^\d{4} payments$/);
  });

  test('loan years list their payments, with the regular payment, principal, interest, extra and balance', async ({ page }) => {
    await page.goto(PAYOFF);
    const first = toggles(page, 'mp-schedule').first();
    await first.click();
    const months = detail(page, 'mp-schedule', 0);
    await expect(months.locator('thead th')).toHaveText(['Payment', 'Regular payment', 'Principal', 'Interest', 'Extra', 'Remaining balance', 'Cumulative interest', 'Balance without extra payments']);
    const yearRow = first.locator('xpath=ancestor::tr[1]');
    const payments = Number((await yearRow.locator('td').first().textContent())!);
    await expect(months.locator('tbody tr')).toHaveCount(payments);
    const yearCells = await yearRow.locator('td').allTextContents();
    const foot = await months.locator('tfoot td').allTextContents();
    // Principal, interest, extra, balance at year end and cumulative interest all match the year.
    expect(foot.slice(1, 6)).toEqual(yearCells.slice(2, 7));
  });

  test('APR and APY months show opening, accrued, credited and closing balances, and the difference between accounts', async ({ page }) => {
    await page.goto(RATES);
    await toggles(page, 'ra-schedule').nth(1).click();
    const months = detail(page, 'ra-schedule', 1);
    await expect(months.locator('tbody tr')).toHaveCount(12);
    await expect(months.locator('thead th')).toContainText(['Account A opening balance', 'Account A interest accrued', 'Account A interest credited', 'Account A closing balance', 'Account B minus Account A']);
    await expect(months.locator('tfoot th')).toHaveText('Year 2 total');
  });
});

test.describe('months in the exports', () => {
  test('the report includes every year\'s months only when asked, whatever is expanded on the page', async ({ page }) => {
    await page.goto(COMPOUND);
    const option = page.locator('[data-out="months-option"]');
    await expect(option).toBeVisible();
    await toggles(page, 'ci-schedule').first().click();
    const plain = await download(page, 'report');
    expect(plain.text).not.toContain('<tr class="rmf-report__detail">');
    await page.check('[data-action="months"]');
    await page.click('#ci-schedule [data-action="collapse-all"]');
    const withMonths = await download(page, 'report');
    expect(withMonths.text.match(/<tr class="rmf-report__detail">/g)).toHaveLength(10);
    expect(withMonths.text).toContain('Schedule by year, with each year&#39;s months');
    expect(withMonths.text).not.toMatch(/<script/);
    // Grouped by month, the option does not apply and is not offered.
    await page.check('input[name="ci-schedule-group"][value="month"]');
    await expect(option).toBeHidden();
  });

  test('the CSV with months is the full monthly schedule, and without them the years', async ({ page }) => {
    await page.goto(AMORTIZATION);
    const years = await download(page, 'csv');
    expect(years.name).toMatch(/schedule-by-year/);
    await page.check('[data-action="months"]');
    const months = await download(page, 'csv');
    expect(months.name).toMatch(/schedule-by-payment/);
    const lines = months.text.trim().split(/\r\n/);
    expect(lines[0]).toMatch(/^payment_number,year,month,payment_usd,principal_usd,interest_usd/);
    // Every payment of the default loan, with no year expanded on the page.
    await expect(page.locator('#la-schedule .sched-detail:visible')).toHaveCount(0);
    expect(lines).toHaveLength(1 + 60);
  });
});

test.describe('months under each year on a phone', () => {
  for (const theme of ['dark', 'light']) {
    test(`an expanded year fits the page at 375 px with no axe violations (${theme})`, async ({ page, context }) => {
      await storeTheme(context, theme);
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(PAYOFF);
      await page.check('input[name="mp-schedule-view"][value="table"]');
      const first = toggles(page, 'mp-schedule').first();
      await first.click();
      await expect(detail(page, 'mp-schedule', 0)).toBeVisible();
      const box = (await first.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(page.locator('#mp-schedule [data-action="expand-all"]')).toBeVisible();
      const results = await new AxeBuilder({ page }).include('#mp-schedule').withTags(TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
