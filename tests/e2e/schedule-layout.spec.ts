// Schedule tables on every calculator: a compact table by default (the period and three key
// figures), a detailed view that shows every other figure under its row, and no sideways
// scrolling, clipped figures or hidden detail at any tested width, in Dark and Light. Year
// expansion, Expand all and Collapse all keep working in both views, the header stays in
// view while the rows scroll, and both views pass axe.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { storeTheme, url } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const WIDTHS = [320, 375, 768, 1024, 1280, 1920];
const CALCULATORS = [
  { name: 'savings', path: 'calculators/savings-growth/', id: 'sg-schedule', keys: ['Year', 'Deposits', 'Interest credited', 'Closing balance'] },
  { name: 'compound interest', path: 'calculators/compound-interest/', id: 'ci-schedule', keys: ['Year', 'Contributions', 'Interest credited', 'Closing balance'] },
  { name: 'APR and APY', path: 'calculators/apr-apy/', id: 'ra-schedule', keys: ['Year', 'Account A balance', 'Account B balance'] },
  { name: 'amortization', path: 'calculators/amortization/', id: 'la-schedule', keys: ['Year', 'Total paid', 'Interest', 'Balance at year end'] },
  { name: 'mortgage payoff', path: 'calculators/loan-payoff/', id: 'mp-schedule', keys: ['Year', 'Total paid', 'Interest', 'Balance at year end'] },
];

/** Opens the schedule as a table with every year expanded. */
async function openTable(page: Page, id: string): Promise<void> {
  await page.check(`input[name="${id}-view"][value="table"]`);
  await page.click(`#${id} [data-action="expand-all"]`);
  await expect(page.locator(`#${id} .sched-detail:visible`).first()).toBeVisible();
}

/** Horizontal overflow of the page, the table box, and any visible figure or label. */
async function overflow(page: Page, id: string) {
  return page.evaluate((sid) => {
    const wrap = document.querySelector<HTMLElement>(`#${sid} .schedule__wrap`)!;
    const doc = document.documentElement;
    const shown = (el: Element) => {
      if ((el as HTMLElement).offsetParent === null) return false;
      // Visually hidden on purpose (kept for assistive technology).
      for (let n: Element | null = el; n && n !== wrap; n = n.parentElement) if (getComputedStyle(n).clipPath !== 'none') return false;
      return true;
    };
    const box = wrap.getBoundingClientRect();
    const problems: string[] = [];
    for (const el of wrap.querySelectorAll<HTMLElement>('th, td, button')) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`clipped ${el.tagName} "${el.textContent!.trim().slice(0, 30)}"`);
      if (r.right > box.right + 1 || r.left < box.left - 1) problems.push(`outside ${el.tagName} "${el.textContent!.trim().slice(0, 30)}"`);
    }
    return { page: doc.scrollWidth > doc.clientWidth, table: wrap.scrollWidth > wrap.clientWidth + 1, problems: problems.slice(0, 5) };
  }, id);
}

for (const calc of CALCULATORS) {
  for (const theme of ['dark', 'light']) {
    test(`${calc.name}: no sideways scrolling or clipped figures at any width, compact and detailed (${theme})`, async ({ page, context }) => {
      await storeTheme(context, theme);
      await page.goto(url(calc.path));
      await openTable(page, calc.id);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        for (const view of ['compact', 'detailed']) {
          await page.check(`input[name="${calc.id}-columns"][value="${view}"]`);
          const result = await overflow(page, calc.id);
          expect(result, `${width} px ${view}`).toEqual({ page: false, table: false, problems: [] });
        }
        await page.check(`input[name="${calc.id}-columns"][value="compact"]`);
      }
    });
  }

  test(`${calc.name}: the compact table shows the period and the key figures; detailed adds every other figure`, async ({ page }) => {
    await page.goto(url(calc.path));
    await page.check(`input[name="${calc.id}-view"][value="table"]`);
    const section = page.locator(`#${calc.id}`);
    await expect(section).toHaveAttribute('data-columns', 'compact');
    await expect(section.locator('.schedule__wrap > table > thead th:visible')).toHaveText(calc.keys);
    const firstRow = section.locator('[data-out="table-rows"] > tr').first();
    const all = await firstRow.locator('td').count();
    await expect(firstRow.locator('td:visible')).toHaveCount(calc.keys.length - 1);
    await page.check(`input[name="${calc.id}-columns"][value="detailed"]`);
    await expect(section).toHaveAttribute('data-columns', 'detailed');
    // Every figure of the row shows, each extra one with its own label.
    await expect(firstRow.locator('td:visible')).toHaveCount(all);
    const extra = firstRow.locator('td.sched-x').first();
    const label = await extra.evaluate((td) => getComputedStyle(td, '::before').content);
    expect(label).toContain(await extra.getAttribute('data-label'));
  });
}

test('the views keep expanded years, and Expand all and Collapse all work in both', async ({ page }) => {
  await page.goto(url('calculators/savings-growth/'));
  await page.check('input[name="sg-schedule-view"][value="table"]');
  const toggles = page.locator('#sg-schedule [data-out="table-rows"] .sched-toggle');
  await toggles.nth(1).click();
  await page.check('input[name="sg-schedule-columns"][value="detailed"]');
  await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#sg-schedule-months-1')).toBeVisible();
  // The months' extra figures show in the detailed view too.
  await expect(page.locator('#sg-schedule-months-1 tbody tr').first().locator('td.sched-x').first()).toBeVisible();
  await page.click('#sg-schedule [data-action="collapse-all"]');
  await expect(page.locator('#sg-schedule .sched-detail:visible')).toHaveCount(0);
  await page.click('#sg-schedule [data-action="expand-all"]');
  await expect(page.locator('#sg-schedule .sched-detail:visible')).toHaveCount(await toggles.count());
  await page.check('input[name="sg-schedule-columns"][value="compact"]');
  await expect(page.locator('#sg-schedule .sched-detail:visible')).toHaveCount(await toggles.count());
  await expect(page.locator('#sg-schedule-months-1 tbody tr').first().locator('td.sched-x').first()).toBeHidden();
});

test('the view choice works from the keyboard, and the month figures line up under the year columns', async ({ page }) => {
  await page.goto(url('calculators/compound-interest/'));
  await page.check('input[name="ci-schedule-view"][value="table"]');
  await page.focus('input[name="ci-schedule-columns"][value="compact"]');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('input[name="ci-schedule-columns"][value="detailed"]')).toBeChecked();
  await expect(page.locator('#ci-schedule')).toHaveAttribute('data-columns', 'detailed');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#ci-schedule')).toHaveAttribute('data-columns', 'compact');
  const toggle = page.locator('#ci-schedule [data-out="table-rows"] .sched-toggle').first();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Each month figure's right edge matches its year column's header.
  const edges = await page.evaluate(() => {
    const right = (el: Element) => Math.round(el.getBoundingClientRect().right);
    const head = [...document.querySelectorAll('#ci-schedule .schedule__wrap > table > thead .sched-key')].map(right);
    const month = [...document.querySelectorAll('#ci-schedule-months-0 tbody tr:first-child .sched-key')].map(right);
    return { head, month };
  });
  expect(edges.month).toEqual(edges.head);
});

test('the header stays in view while a long schedule scrolls down inside its box', async ({ page }) => {
  await page.goto(url('calculators/savings-growth/'));
  await page.check('input[name="sg-schedule-view"][value="table"]');
  await page.check('input[name="sg-schedule-group"][value="month"]');
  const wrap = page.locator('#sg-schedule .schedule__wrap');
  await wrap.evaluate((el) => el.scrollTo(0, 600));
  const tops = await wrap.evaluate((el) => ({
    box: Math.round(el.getBoundingClientRect().top),
    head: Math.round(el.querySelector('thead')!.getBoundingClientRect().top),
    scrolled: el.scrollTop,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(tops.scrolled).toBeGreaterThan(0);
  expect(tops.overflowY).toBe('auto');
  expect(Math.abs(tops.head - tops.box)).toBeLessThanOrEqual(1);
});

test('without JavaScript every figure shows, with its label', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(url('calculators/savings-growth/'));
  const row = page.locator('#sg-schedule [data-out="table-rows"] > tr').first();
  await expect(row.locator('td:visible')).toHaveCount(await row.locator('td').count());
  await context.close();
});

for (const theme of ['dark', 'light']) {
  for (const width of [375, 1280]) {
    test(`both views pass axe with every year expanded at ${width} px (${theme})`, async ({ page, context }) => {
      await storeTheme(context, theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url('calculators/loan-payoff/'));
      await openTable(page, 'mp-schedule');
      for (const view of ['compact', 'detailed']) {
        await page.check(`input[name="mp-schedule-columns"][value="${view}"]`);
        const results = await new AxeBuilder({ page }).include('#mp-schedule').withTags(TAGS).analyze();
        expect(results.violations.map((v) => v.id), view).toEqual([]);
      }
    });
  }
}
