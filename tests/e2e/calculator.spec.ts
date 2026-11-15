import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { storeTheme, url } from './helpers';

const PAGE = url('calculators/compound-interest/');
const compound = JSON.parse(readFileSync('tests/oracle/fixtures/compound.json', 'utf8'));

const dollars = (cents: number) => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
};

async function fill(page: Page, values: { principal?: string; rate?: string; years?: string; contribution?: string; frequency?: string; timing?: 'start' | 'end' }) {
  if (values.principal !== undefined) await page.fill('#ci-principal', values.principal);
  if (values.rate !== undefined) await page.fill('#ci-rate', values.rate);
  if (values.years !== undefined) await page.fill('#ci-years', values.years);
  if (values.contribution !== undefined) await page.fill('#ci-contribution', values.contribution);
  if (values.frequency !== undefined) await page.selectOption('#ci-frequency', values.frequency);
  if (values.timing !== undefined) await page.check(`input[name="ci-timing"][value="${values.timing}"]`);
}

const hero = (page: Page) => page.locator('[data-out="final"]');

/** A fixture rate string ("0.07") as the percent a visitor types ("7"), without float noise. */
const percentText = (rate: string) => String(Math.round(Number(rate) * 1e6) / 1e4);

// $10,000 at 5% compounded monthly for 10 years with $100 at the end of each month, from the
// engines (which match the oracle; see tests/unit/engines/oracle.test.ts).
const EXAMPLE_FINAL = '$31,998.39';

test.describe('compound interest calculator', () => {
  test('shows the example scenario before any input, and the same with JavaScript off', async ({ browser }) => {
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled });
      const page = await context.newPage();
      await page.goto(PAGE);
      // $10,000 at 5% monthly for 10 years, $100 at the end of each month (engine and oracle agree).
      await expect(hero(page)).toHaveText(EXAMPLE_FINAL);
      await expect(page.locator('tfoot [data-out="total-end"]')).toHaveText(EXAMPLE_FINAL);
      await expect(page.locator('.calc-table tbody tr')).toHaveCount(10);
      await context.close();
    }
  });

  for (const id of ['n12-end', 'n365-start', 'n1-start', 'n4-end', 'exact-half-annual-10-cents', 'exact-half-daily-3650-cents', 'daily-5.25-percent-30-years-contribution-1000-start']) {
    test(`displays the oracle's result for ${id} to the cent`, async ({ page }) => {
      const c = compound.cases.find((x: { id: string }) => x.id === id);
      test.skip(!c, `fixture ${id} not present`);
      await page.goto(PAGE);
      await fill(page, {
        principal: (c.principal_cents / 100).toFixed(2),
        rate: percentText(c.annual_rate),
        years: String(c.years),
        contribution: (c.contribution_cents / 100).toFixed(2),
        frequency: String(c.periods_per_year),
        timing: c.timing,
      });
      await expect(hero(page)).toHaveText(dollars(c.final_balance_cents));
      await expect(page.locator('[data-out="interest"]')).toHaveText(dollars(c.total_interest_cents));
      const lastRow = page.locator('.calc-table tbody tr').last();
      await expect(lastRow.locator('td').last()).toHaveText(dollars(c.yearly.at(-1)[4]));
    });
  }

  test('breakdown adds up to the final balance exactly', async ({ page }) => {
    await page.goto(PAGE);
    await fill(page, { principal: '2,500', rate: '4.25', years: '17', contribution: '75.50', frequency: '4', timing: 'start' });
    const cents = async (sel: string) => Number((await page.locator(sel).textContent())!.replace(/[$,.]/g, ''));
    expect(await cents('[data-out="principal"]') + await cents('[data-out="contributions"]') + await cents('[data-out="interest"]')).toBe(await cents('[data-out="final"]'));
  });

  test('withholds results and explains the problem when an input is invalid', async ({ page }) => {
    await page.goto(PAGE);
    await page.fill('#ci-rate', '150');
    await expect(page.locator('#ci-rate')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#ci-rate-error')).toBeVisible();
    await expect(page.locator('#ci-rate-error')).toContainText('100%');
    await expect(page.locator('.calc')).toHaveAttribute('data-state', 'invalid');
    await expect(hero(page)).toBeHidden();
    await page.fill('#ci-rate', '5');
    await expect(page.locator('#ci-rate')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(hero(page)).toBeVisible();
  });

  test('accepts pasted amounts like $12,345.67', async ({ page }) => {
    await page.goto(PAGE);
    await fill(page, { principal: '$12,345.67', rate: '0', contribution: '0', years: '1' });
    await expect(hero(page)).toHaveText('$12,345.67');
  });

  test('a share link restores every input, and malformed links are ignored', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(PAGE);
    await fill(page, { principal: '7,500', rate: '3.75', years: '12', contribution: '50', frequency: '4', timing: 'start' });
    const final = await hero(page).textContent();
    await page.click('[data-action="share"]');
    const link = await page.locator('#ci-share-link').inputValue();
    expect(link).toContain('#s=');
    expect(new URL(link).search).toBe('');
    const fresh = await context.newPage();
    await fresh.goto(link);
    await expect(fresh.locator('#ci-principal')).toHaveValue('7,500.00');
    await expect(hero(fresh)).toHaveText(final!);
    // A second link in the same tab changes only the fragment; the calculator follows it.
    await fresh.goto(`${PAGE}#${link.split('#')[1]!.replace(encodeURIComponent('y=12'), encodeURIComponent('y=20'))}`);
    await expect(fresh.locator('#ci-years')).toHaveValue('20');
    // A malformed link in a new tab is ignored field by field, falling back to the example.
    const other = await context.newPage();
    await other.goto(`${PAGE}#s=${encodeURIComponent('v=1&p=-5&r=999&n=7&x=1')}`);
    await expect(hero(other)).toHaveText(EXAMPLE_FINAL);
    await expect(other.locator('#ci-rate')).toHaveValue('5');
  });

  test('downloads the yearly table as CSV with unformatted numbers', async ({ page }) => {
    await page.goto(PAGE);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="csv"]')]);
    expect(download.suggestedFilename()).toBe('compound-interest.csv');
    const csv = readFileSync((await download.path())!, 'utf8');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('year,start_balance_usd,contributions_usd,interest_usd,end_balance_usd');
    expect(lines).toHaveLength(11);
    expect(lines[10]).toMatch(/^10,\d+\.\d{2},1200\.00,\d+\.\d{2},\d+\.\d{2}$/);
  });

  test('the chart has a table equivalent and a keyboard-readable tooltip', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('.calc-table summary').click();
    await expect(page.locator('.calc-table tbody tr')).toHaveCount(10);
    await page.locator('.chart-box').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.chart-tooltip')).toBeVisible();
    await expect(page.locator('.chart-tooltip')).toContainText('Year 1');
    await page.keyboard.press('End');
    await expect(page.locator('.chart-tooltip')).toContainText('Year 10');
    await page.keyboard.press('Escape');
    await expect(page.locator('.chart-tooltip')).toBeHidden();
  });

  test('hovering a year shows its values in a tooltip', async ({ page }) => {
    await page.goto(PAGE);
    const hit = page.locator('.chart__col[data-index="4"] .chart__hit');
    await hit.scrollIntoViewIfNeeded();
    await hit.hover();
    await expect(page.locator('.chart-tooltip')).toBeVisible();
    await expect(page.locator('.chart-tooltip strong')).toContainText('Year 5');
    await expect(page.locator('.chart__col[data-index="4"]')).toHaveClass(/is-active/);
  });

  test('on a phone the chart is drawn at its real width, so its labels keep their size', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(PAGE);
    const ratio = await page.locator('.chart').evaluate((svg) => svg.getBoundingClientRect().width / (svg as SVGSVGElement).viewBox.baseVal.width);
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
    await context.close();
  });

  test('hides the download and share buttons while results are withheld', async ({ page }) => {
    await page.goto(PAGE);
    await page.fill('#ci-years', '0');
    await expect(page.locator('[data-action="csv"]')).toBeHidden();
    await expect(page.locator('#ci-years-error')).toContainText('at least 1');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`has no accessibility violations in ${theme}, including the error state`, async ({ browser }) => {
      const context = await browser.newContext();
      await storeTheme(context, theme);
      const page = await context.newPage();
      await page.goto(PAGE);
      await page.locator('.calc-table summary').click();
      const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
      expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => v.id)).toEqual([]);
      await page.fill('#ci-years', '0');
      expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => v.id)).toEqual([]);
      await context.close();
    });
  }
});
