// What Is Money?: readable without JavaScript, the comparison panel by keyboard and pointer,
// citations that resolve, accessibility in both themes, and a 320 px screen.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { storeTheme, url } from './helpers';

const PAGE = url('learn/what-is-money/');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe('What Is Money?', () => {
  test('reads in full without JavaScript: every instrument, every question, every source', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(PAGE);
    await expect(page.locator('h1')).toHaveText('What Is Money?');
    await expect(page.locator('.instrument')).toHaveCount(8);
    await expect(page.locator('.instrument').first().locator('dt')).toHaveCount(6);
    await expect(page.locator('.money-table thead th')).toHaveCount(4);
    await expect(page.locator('.money-compare__controls')).toBeHidden();
    const refs = await page.locator('a.cite-ref').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
    expect(refs.length).toBeGreaterThan(40);
    for (const ref of new Set(refs)) await expect(page.locator(ref), ref).toHaveCount(1);
    await context.close();
  });

  test('compares up to three side by side, and says so when the limit is reached', async ({ page }) => {
    await page.goto(PAGE);
    const table = page.locator('[data-out="compare"] .money-table');
    await expect(table.locator('thead th')).toHaveText(['Question', 'Cash', 'Bank deposits', 'Payment stablecoins']);
    await expect(page.locator('input[name="mc-item"][value="gold"]')).toBeDisabled();
    await expect(page.locator('[data-out="compare-hint"]')).toContainText('Up to 3');
    await page.locator('input[name="mc-item"][value="deposits"]').uncheck();
    await page.locator('input[name="mc-item"][value="gold"]').check();
    await expect(table.locator('thead th')).toHaveText(['Question', 'Cash', 'Payment stablecoins', 'Gold']);
    await expect(page.locator('[data-out="compare-status"]')).toHaveText('Comparing cash, payment stablecoins, gold.');
    await expect(table.locator('tbody tr')).toHaveCount(6);
  });

  test('shows every answer to one question', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('input[name="mc-mode"][value="question"]').check();
    await page.locator('input[name="mc-question"][value="backing"]').check();
    await expect(page.locator('.money-answers > div')).toHaveCount(8);
    await expect(page.locator('.money-answers__question')).toHaveText('Insurance or backing');
    await expect(page.locator('.money-answers')).toContainText('$250,000 per depositor');
    await expect(page.locator('[data-for="side"]')).toBeHidden();
  });

  test('works from the keyboard', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('input[name="mc-item"][value="cash"]').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-out="compare"] thead th')).toHaveText(['Question', 'Bank deposits', 'Payment stablecoins']);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.locator('input[name="mc-item"][value="deposits"]')).not.toBeChecked();
  });

  test('every source links to its original on a government site', async ({ page }) => {
    await page.goto(PAGE);
    const links = await page.locator('.source-list a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(links.length).toBeGreaterThanOrEqual(20);
    for (const link of links) expect(new URL(link).hostname, link).toMatch(/\.gov$|^www\.federalreserveeducation\.org$/);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`has no accessibility violations in ${theme}, in both views`, async ({ browser }) => {
      const context = await browser.newContext();
      await storeTheme(context, theme);
      const page = await context.newPage();
      await page.goto(PAGE);
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);
      await page.locator('input[name="mc-mode"][value="question"]').check();
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);
      await context.close();
    });
  }

  test('a 320 px screen never scrolls sideways', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
    const page = await context.newPage();
    await page.goto(PAGE);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.locator('input[name="mc-mode"][value="question"]').check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await context.close();
  });
});
