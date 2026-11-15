// The shared report system in the browser: view and grouping controls, paging, the same
// figures in every view and export, the HTML report offline and accessible in both color
// schemes, print output, file names without amounts, and very long schedules.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Page } from '@playwright/test';
import { storeTheme, url } from './helpers';

const SAVINGS = url('calculators/savings-growth/');
const COMPOUND = url('calculators/compound-interest/');
const RATES = url('calculators/apr-apy/');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const rows = (page: Page, id: string) => page.locator(`#${id} [data-out="table-rows"] tr`);
const group = (page: Page, id: string, value: 'day' | 'month' | 'year') => page.check(`input[name="${id}-group"][value="${value}"]`);

async function download(page: Page, action: string): Promise<{ name: string; text: string; file: Download }> {
  const [file] = await Promise.all([page.waitForEvent('download'), page.click(`[data-action="${action}"]`)]);
  return { name: file.suggestedFilename(), text: readFileSync((await file.path())!, 'utf8'), file };
}

test.describe('schedules and reports', () => {
  test('switches between Chart, Table and Both', async ({ page }) => {
    await page.goto(SAVINGS);
    const chart = page.locator('#sg-schedule .schedule__chart');
    const table = page.locator('#sg-schedule .schedule__table');
    await expect(chart).toBeVisible();
    await expect(table).toBeVisible();
    await page.check('input[name="sg-schedule-view"][value="chart"]');
    await expect(table).toBeHidden();
    await expect(chart).toBeVisible();
    await page.check('input[name="sg-schedule-view"][value="table"]');
    await expect(chart).toBeHidden();
    await expect(table).toBeVisible();
  });

  test('every grouping reconciles to the same final balance and interest', async ({ page }) => {
    await page.goto(SAVINGS);
    const final = await page.locator('[data-out="final"]').textContent();
    const interest = await page.locator('[data-out="interest"]').textContent();
    for (const g of ['year', 'month', 'day'] as const) {
      await group(page, 'sg-schedule', g);
      const foot = page.locator('#sg-schedule tfoot td');
      await expect(foot.nth(3), g).toHaveText(interest!);
      await expect(foot.nth(5), g).toHaveText(final!);
      await expect(foot.nth(6), g).toHaveText(interest!);
      await expect(page.locator('[data-out="final"]')).toHaveText(final!);
    }
    await expect(rows(page, 'sg-schedule')).toHaveCount(365);
    await page.click('#sg-schedule [data-page="last"]');
    await expect(rows(page, 'sg-schedule').last().locator('td').nth(5)).toHaveText(final!);
  });

  test('shows a credit only on the last day of each month in the daily view', async ({ page }) => {
    await page.goto(SAVINGS);
    await group(page, 'sg-schedule', 'day');
    const credited = await rows(page, 'sg-schedule').evaluateAll((trs) => trs.slice(0, 59).map((tr) => tr.querySelectorAll('td')[3]!.textContent));
    credited.forEach((text, day) => {
      if (day === 30 || day === 58) expect(text, `day ${day}`).not.toBe('$0.00');
      else expect(text, `day ${day}`).toBe('$0.00');
    });
  });

  test('pages a long daily schedule with buttons and a page list', async ({ page }) => {
    await page.goto(COMPOUND);
    await page.fill('#ci-years', '100');
    await page.selectOption('#ci-frequency', '365');
    await group(page, 'ci-schedule', 'day');
    const status = page.locator('#ci-schedule [data-out="page-status"]');
    await expect(status).toHaveText('Page 1 of 100: rows 1 to 365 of 36,500.');
    await expect(page.locator('#ci-schedule [data-page="previous"]')).toBeDisabled();
    await page.click('#ci-schedule [data-page="next"]');
    await expect(status).toHaveText('Page 2 of 100: rows 366 to 730 of 36,500.');
    await page.selectOption('#ci-schedule [data-page="jump"]', '49');
    await expect(status).toContainText('Page 50 of 100');
    await expect(rows(page, 'ci-schedule').first().locator('th')).toHaveText('Jan 1, year 50');
    await page.click('#ci-schedule [data-page="last"]');
    await expect(page.locator('#ci-schedule [data-page="next"]')).toBeDisabled();
    await expect(rows(page, 'ci-schedule').last().locator('th')).toHaveText('Dec 31, year 100');
    await expect(rows(page, 'ci-schedule')).toHaveCount(365);
  });

  test('exports every row of a long daily schedule, and reports it by month', async ({ page }) => {
    await page.goto(COMPOUND);
    await page.fill('#ci-years', '100');
    await page.selectOption('#ci-frequency', '365');
    await group(page, 'ci-schedule', 'day');
    const csv = await download(page, 'csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines).toHaveLength(36_501);
    expect(lines.at(-1)).toMatch(/^36500,100,12,31,/);
    const report = await download(page, 'report');
    expect(report.text).toContain('has 36,500 rows, too many for a readable report');
    expect(report.text.match(/<tr><th scope="row">[A-Z][a-z]{2}, year \d+</g)).toHaveLength(1_200);
  });

  test('the CSV and the report carry exactly the figures on the page', async ({ page }) => {
    await page.goto(SAVINGS);
    await group(page, 'sg-schedule', 'month');
    const shown = await rows(page, 'sg-schedule').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('th, td')].map((c) => c.firstChild?.textContent ?? '')));
    const csv = (await download(page, 'csv')).text.trim().split('\r\n').slice(1).map((l) => l.split(','));
    expect(csv).toHaveLength(shown.length);
    const money = (v: string) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    csv.forEach((cells, i) => {
      // opening, deposits, credited, closing, cumulative
      expect([money(cells[4]!), money(cells[5]!), money(cells[7]!), money(cells[10]!), money(cells[11]!)], `month ${i + 1}`).toEqual([shown[i]![1], shown[i]![2], shown[i]![4], shown[i]![6], shown[i]![7]]);
    });
    const report = (await download(page, 'report')).text;
    for (const row of shown) expect(report).toContain(`<td>${row[6]}</td>`);
    expect(report).toContain(await page.locator('[data-out="final"]').textContent());
  });

  test('file names never include the amounts entered', async ({ page }) => {
    await page.goto(SAVINGS);
    await page.fill('#sg-principal', '12,345.67');
    await page.fill('#sg-contribution', '765.43');
    await expect(page.locator('[data-out="principal"]')).toHaveText('$12,345.67');
    for (const action of ['report', 'csv', 'summary']) {
      const { name } = await download(page, action);
      expect(name).toMatch(/^radmage-finance-savings-[a-z-]+-\d{4}-\d{2}-\d{2}\.(html|csv|txt)$/);
      expect(name).not.toMatch(/12345|1234567|765/);
    }
  });

  test('the plain-text summary states the notice, the results and the assumptions', async ({ page }) => {
    await page.goto(SAVINGS);
    const { text } = await download(page, 'summary');
    expect(text).toMatch(/^RadMage Finance: High-yield savings calculator\r\n/);
    expect(text).toContain('HYPOTHETICAL CALCULATION.');
    expect(text).toContain(`Projected balance: ${await page.locator('[data-out="final"]').textContent()}`);
    expect(text).toContain('Assumption (deposit day)');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the downloaded report works offline, loads nothing and is accessible (${scheme})`, async ({ page, browser }) => {
      await page.goto(SAVINGS);
      await group(page, 'sg-schedule', 'month');
      const { text } = await download(page, 'report');
      // The report has no script of its own; JavaScript stays on only so axe can run.
      const context = await browser.newContext({ offline: true, colorScheme: scheme });
      const requests: string[] = [];
      await context.route('**/*', (route) => {
        requests.push(route.request().url());
        return route.abort();
      });
      const viewer = await context.newPage();
      const errors: string[] = [];
      viewer.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await viewer.setContent(text, { waitUntil: 'load' });
      await expect(viewer.locator('h1')).toHaveText('High-yield savings calculator');
      await expect(viewer.locator('.rmf-report__notice')).toContainText('Hypothetical calculation.');
      await expect(viewer.locator('.rmf-report__schedule tbody tr')).toHaveCount(60);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
      expect((await new AxeBuilder({ page: viewer }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);
      await context.close();
    });
  }

  test('printing shows only the report, starts the schedule on a new page and repeats its header', async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        (window as unknown as { printed: number }).printed = ((window as unknown as { printed?: number }).printed ?? 0) + 1;
      };
    });
    await page.goto(COMPOUND);
    await page.click('[data-action="print"]');
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
    await page.emulateMedia({ media: 'print' });
    const layout = await page.evaluate(() => ({
      shown: [...document.body.children].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.className),
      breakBefore: getComputedStyle(document.querySelector('.print-root .rmf-report__schedule')!).breakBefore,
      thead: getComputedStyle(document.querySelector('.print-root .rmf-report__schedule thead')!).display,
      row: getComputedStyle(document.querySelector('.print-root .rmf-report__schedule tbody tr')!).breakInside,
      texture: getComputedStyle(document.querySelector('.print-root .chart__tex')!).display,
      background: getComputedStyle(document.querySelector('.print-root .rmf-report')!).backgroundColor,
    }));
    expect(layout).toEqual({ shown: ['print-root'], breakBefore: 'page', thead: 'table-header-group', row: 'avoid', texture: 'inline', background: 'rgb(255, 255, 255)' });
    const pdf = await page.pdf({ format: 'Letter' });
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)!.length).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('.print-root')).toHaveCount(0);
  });

  test("printing from the browser's own menu prints the report too", async ({ page }) => {
    await page.goto(SAVINGS);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(page.locator('.print-root h1')).toHaveText('High-yield savings calculator');
  });

  test('while entries are invalid there is no schedule and nothing to export', async ({ page }) => {
    await page.goto(SAVINGS);
    await page.fill('#sg-years', '0');
    await expect(page.locator('#sg-schedule [data-out="schedule-withheld"]')).toBeVisible();
    await expect(page.locator('#sg-schedule .schedule__body')).toBeHidden();
    for (const action of ['report', 'csv', 'summary', 'print']) await expect(page.locator(`[data-action="${action}"]`)).toBeHidden();
  });

  test('the APR/APY illustration groups by month and reads out every account', async ({ page }) => {
    await page.goto(RATES);
    await group(page, 'ra-schedule', 'month');
    await expect(rows(page, 'ra-schedule')).toHaveCount(60);
    await expect(rows(page, 'ra-schedule').nth(11).locator('td').first()).toHaveText('$10,460.25');
    await page.locator('#ra-schedule .chart-box').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#ra-schedule .chart-tooltip')).toContainText('Account A');
    await expect(page.locator('#ra-schedule .chart-tooltip')).toContainText('Account B');
    await page.fill('#ra-years', '31');
    await expect(page.locator('#ra-years-error')).toContainText('1 to 30');
  });

  test('the monthly chart reads every month from the keyboard', async ({ page }) => {
    await page.goto(SAVINGS);
    await group(page, 'sg-schedule', 'month');
    const box = page.locator('#sg-schedule .chart-box');
    await box.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#sg-schedule .chart-tooltip strong')).toContainText('Jan, year 1');
    await page.keyboard.press('PageDown');
    await expect(page.locator('#sg-schedule .chart-tooltip strong')).toContainText('Jul, year 1');
    await page.keyboard.press('End');
    await expect(page.locator('#sg-schedule .chart-tooltip strong')).toHaveText(`Dec, year 5: ${await page.locator('[data-out="final"]').textContent()}`);
    await expect(page.locator('#sg-schedule .chart__cursor')).toHaveAttribute('visibility', 'visible');
  });

  test('a 320 px screen never scrolls sideways, whatever the grouping', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
    const page = await context.newPage();
    for (const path of [SAVINGS, COMPOUND, RATES]) {
      await page.goto(path);
      const id = path === SAVINGS ? 'sg-schedule' : path === COMPOUND ? 'ci-schedule' : 'ra-schedule';
      await group(page, id, 'day');
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(320);
    }
    await context.close();
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`the schedule controls, pager and daily table have no accessibility violations (${theme})`, async ({ browser }) => {
      const context = await browser.newContext();
      await storeTheme(context, theme);
      const page = await context.newPage();
      await page.goto(SAVINGS);
      await group(page, 'sg-schedule', 'day');
      await expect(page.locator('#sg-schedule [data-pager]')).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);
      await page.check('input[name="sg-schedule-view"][value="table"]');
      await page.goto(RATES);
      await group(page, 'ra-schedule', 'month');
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);
      await context.close();
    });
  }
});
