import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { storeTheme, url } from './helpers';

const PAGE = url('calculators/savings-growth/');
const FIXTURE = 'tests/oracle/fixtures/hysa.json';
const hysa = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : { cases: [] };

interface Case {
  id: string;
  principal_cents: number;
  years: number;
  compounding: 'daily' | 'monthly';
  rates: { from_month: number; apy: string }[];
  contribution_frequency: string;
  contribution_cents: number;
  timing: 'start' | 'end';
  final_balance_cents: number;
  total_interest_cents: number;
  monthly: number[][];
}

const dollars = (cents: number) => `$${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;
const percentText = (fraction: string) => String(Math.round(Number(fraction) * 1e8) / 1e6);
const hero = (page: Page) => page.locator('[data-out="final"]');

/** The first oracle case that the form can enter (at most three rate changes) and that matches. */
const pick = (match: (c: Case) => boolean): Case | undefined => (hysa.cases as Case[]).find((c) => c.rates.length <= 4 && match(c));

async function enter(page: Page, c: Case) {
  await page.selectOption('#sg-contribution-frequency', c.contribution_frequency);
  await page.selectOption('#sg-compounding', c.compounding);
  await page.fill('#sg-principal', (c.principal_cents / 100).toFixed(2));
  await page.fill('#sg-apy', percentText(c.rates[0]!.apy));
  await page.fill('#sg-years', String(c.years));
  for (const slot of [1, 2, 3]) {
    const step = c.rates[slot];
    await page.fill(`#sg-m${slot}`, step ? String(step.from_month) : '');
    await page.fill(`#sg-r${slot}`, step ? percentText(step.apy) : '');
  }
  if (c.contribution_frequency !== 'none') {
    await page.fill('#sg-contribution', (c.contribution_cents / 100).toFixed(2));
    await page.check(`input[name="sg-timing"][value="${c.timing}"]`);
  }
}

test.describe('high-yield savings calculator', () => {
  test('shows the example before any input, and the same with JavaScript off', async ({ browser }) => {
    const values: string[] = [];
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled });
      const page = await context.newPage();
      await page.goto(PAGE);
      await expect(hero(page)).toHaveText(/^\$\d{2},\d{3}\.\d{2}$/);
      values.push((await hero(page).textContent())!);
      await expect(page.locator('[data-out="rates"] tr')).toHaveCount(1);
      await expect(page.locator('#sg-schedule [data-out="table-rows"] > tr:not(.sched-detail)')).toHaveCount(5);
      await context.close();
    }
    expect(values[0]).toBe(values[1]);
  });

  const displayed: [string, Case | undefined][] = [
    ['daily compounding with monthly deposits', pick((c) => c.compounding === 'daily' && c.contribution_frequency === 'monthly' && c.rates.length === 1)],
    ['monthly compounding with weekly deposits', pick((c) => c.compounding === 'monthly' && c.contribution_frequency === 'weekly')],
    ['biweekly deposits at the start', pick((c) => c.contribution_frequency === 'biweekly' && c.timing === 'start')],
    ['a falling rate', pick((c) => c.rates.length === 2 && Number(c.rates[1]!.apy) < Number(c.rates[0]!.apy))],
    ['three or four rates', pick((c) => c.rates.length >= 3)],
    ['no deposits', pick((c) => c.contribution_frequency === 'none')],
  ];
  for (const [name, c] of displayed) {
    test(`displays the oracle's result to the cent: ${name}`, async ({ page }) => {
      test.skip(!c, `no fixture for ${name}`);
      await page.goto(PAGE);
      await enter(page, c!);
      await expect(hero(page)).toHaveText(dollars(c!.final_balance_cents));
      await expect(page.locator('[data-out="interest"]')).toHaveText(dollars(c!.total_interest_cents));
      // The first month's credited interest, from the month table.
      await page.check('input[name="sg-schedule-group"][value="month"]');
      await expect(page.locator('#sg-schedule [data-out="table-rows"] > tr:not(.sched-detail)').first().locator('td').nth(3)).toHaveText(dollars(c!.monthly[0]![4]!));
    });
  }

  test('asks for both halves of a rate change, and for changes in order', async ({ page }) => {
    await page.goto(PAGE);
    await page.fill('#sg-m1', '13');
    await page.locator('#sg-m1').blur();
    await expect(page.locator('#sg-r1-error')).toHaveText('Enter both the month and the APY, or leave both blank.');
    await expect(page.locator('.calc')).toHaveAttribute('data-state', 'invalid');
    await page.fill('#sg-r1', '3.5');
    await expect(page.locator('.calc')).toHaveAttribute('data-state', 'ok');
    await expect(page.locator('[data-out="rates"] tr')).toHaveCount(2);
    await page.fill('#sg-m2', '6');
    await page.fill('#sg-r2', '3');
    await expect(page.locator('#sg-m2-error')).toContainText('after the one above it');
    await page.fill('#sg-m2', '61');
    await expect(page.locator('#sg-m2-error')).toContainText('after the end of the projection');
  });

  test('a share link restores the rate changes; a No amounts link leaves both amounts blank', async ({ page, context }) => {
    await page.goto(PAGE);
    await page.selectOption('#sg-compounding', 'monthly');
    await page.fill('#sg-m1', '13');
    await page.fill('#sg-r1', '3.75');
    await expect(page.locator('[data-out="rates"] tr')).toHaveCount(2);
    const final = await hero(page).textContent();
    await page.click('[data-action="share"]');
    const link = await page.locator('#sg-share-link').inputValue();
    const fresh = await context.newPage();
    await fresh.goto(link);
    await expect(fresh.locator('#sg-m1')).toHaveValue('13');
    await expect(fresh.locator('#sg-r1')).toHaveValue('3.75');
    await expect(fresh.locator('#sg-compounding')).toHaveValue('monthly');
    await expect(hero(fresh)).toHaveText(final!);

    await page.check('input[name="sg-share-amounts"][value="none"]');
    const blank = decodeURIComponent((await page.locator('#sg-share-link').inputValue()).split('#s=')[1]!);
    expect(blank).not.toMatch(/(^|&)(p|c)=/);
    const other = await context.newPage();
    await other.goto(`${PAGE}#s=${encodeURIComponent(blank)}`);
    await expect(other.locator('#sg-principal')).toHaveValue('');
    await expect(other.locator('#sg-contribution')).toHaveValue('');
    await expect(other.locator('.calc')).toHaveAttribute('data-state', 'incomplete');
  });

  test('downloads the month-by-month schedule as CSV', async ({ page }) => {
    await page.goto(PAGE);
    await page.check('input[name="sg-schedule-group"][value="month"]');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="csv"]')]);
    expect(download.suggestedFilename()).toMatch(/^radmage-finance-savings-schedule-by-month-[\d-]+\.csv$/);
    const lines = readFileSync((await download.path())!, 'utf8').trim().split('\r\n');
    expect(lines).toHaveLength(61);
    expect(lines[0]).toContain('apy_earned_percent');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`has no accessibility violations in ${theme}, including errors and the month table`, async ({ browser }) => {
      const context = await browser.newContext();
      await storeTheme(context, theme);
      const page = await context.newPage();
      await page.goto(PAGE);
      await page.check('input[name="sg-schedule-group"][value="month"]');
      const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
      expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => v.id)).toEqual([]);
      await page.fill('#sg-apy', '200');
      await expect(page.locator('#sg-apy-error')).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => v.id)).toEqual([]);
      await context.close();
    });
  }
});
