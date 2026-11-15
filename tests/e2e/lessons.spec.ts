// How Banks Create Money and How Money Flows in the browser: readable without JavaScript,
// stepping, counters, the reserve-shortfall choices, refusals, the flow view, the free mode,
// accessibility in both themes and a 320 px screen.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { storeTheme, url } from './helpers';

const BANKS = url('learn/how-banks-create-money/');
const FLOWS = url('learn/how-money-flows/');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const counter = (page: Page, label: string) => page.locator('[data-sim="counters"] div', { hasText: label }).locator('dd');
const next = (page: Page) => page.click('[data-sim="next"]');

test.describe('How Banks Create Money', () => {
  test('reads without JavaScript: the starting balance sheets and every step in words', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(BANKS);
    await expect(page.locator('.taccount')).toHaveCount(5);
    await expect(page.locator('#steps + p + ol > li')).toHaveCount(6);
    await expect(counter(page, 'Money in the model')).toHaveText('$16,000.00');
    await expect(page.locator('[data-sim="next"]')).toBeHidden();
    await context.close();
  });

  test('a loan creates money, the payment moves reserves, repayment destroys money', async ({ page }) => {
    await page.goto(BANKS);
    await next(page);
    await expect(counter(page, 'Money in the model')).toHaveText('$17,000.00');
    await expect(page.locator('.taccount[data-entity="BankA"] tr.is-changed')).toHaveCount(2);
    await next(page);
    await expect(counter(page, 'Money in the model')).toHaveText('$17,000.00');
    await expect(page.locator('[data-sim="moves"] li').nth(1)).toHaveText('Reserves: $1,000.00 from Bank A to Bank B.');
    await next(page);
    await expect(counter(page, 'Money in the model')).toHaveText('$16,911.15');
    await page.click('[data-sim="back"]');
    await expect(page.locator('[data-sim="title"]')).toHaveText('The borrower spends the money');
    await page.click('[data-sim="reset"]');
    await expect(page.locator('[data-sim="count"]')).toHaveText('Step 0 of 6');
  });

  test('stops at a reserve shortfall and offers labeled choices; the discount window resolves it', async ({ page }) => {
    await page.goto(BANKS);
    for (let i = 0; i < 5; i += 1) await next(page);
    await expect(page.locator('[data-sim="message"]')).toContainText('it is $4,000.00 short');
    await expect(page.locator('.sim-choice')).toHaveCount(3);
    await expect(page.locator('[data-sim="next"]')).toBeDisabled();
    await page.locator('.sim-choice', { hasText: 'discount window' }).click();
    await expect(page.locator('.taccount[data-entity="Fed"]')).toContainText('Loans to banks');
    await expect(page.locator('.sim-choice')).toHaveCount(0);
    await next(page);
    await expect(page.locator('[data-sim="message"]')).toContainText("Refused: Bank A would fall below the lesson's hypothetical capital rule");
    await expect(page.locator('[data-sim="next"]')).toBeDisabled();
  });

  test('free mode: the ledger refuses what an account cannot cover', async ({ page }) => {
    await page.goto(BANKS);
    await page.selectOption('#sim-banks-action', 'repay');
    await page.fill('#sim-banks-amount', '50');
    await page.click('.sim-free button[type="submit"]');
    await expect(page.locator('[data-sim="message"]')).toContainText('That is more than Household 1 owes.');
    // Refused: nothing on any balance sheet changed.
    await expect(page.locator('.taccount tr.is-changed')).toHaveCount(0);
    await page.fill('#sim-banks-amount', 'abc');
    await page.click('.sim-free button[type="submit"]');
    await expect(page.locator('#sim-banks-amount-error')).toBeVisible();
  });
});

test.describe('How Money Flows', () => {
  test('taxes move reserves into the Treasury account, and the flow view draws who paid', async ({ page }) => {
    await page.goto(FLOWS);
    for (let i = 0; i < 7; i += 1) await next(page);
    await expect(page.locator('[data-sim="title"]')).toHaveText('Taxes');
    await expect(counter(page, 'Treasury General Account')).toHaveText('$220.00');
    await expect(page.locator('.flow title')).toContainText('Household 1 to Treasury, pays $20.00');
    await expect(page.locator('.flow .flow__node.is-changed')).not.toHaveCount(0);
  });

  test('switches between the flow view and the balance sheets', async ({ page }) => {
    await page.goto(FLOWS);
    await page.check('input[name="mf-view"][value="flow"]');
    await expect(page.locator('.sim__sheets')).toBeHidden();
    await expect(page.locator('.sim__flow')).toBeVisible();
    await page.check('input[name="mf-view"][value="sheets"]');
    await expect(page.locator('.sim__flow')).toBeHidden();
    await expect(page.locator('.taccount')).toHaveCount(9);
  });

  test('free mode offers the whole catalog, including the reverse repo', async ({ page }) => {
    await page.goto(FLOWS);
    await expect(page.locator('#sim-flows-action option')).toHaveCount(17);
    await page.selectOption('#sim-flows-action', 'reverse-repo');
    await page.fill('#sim-flows-amount', '50');
    await page.click('.sim-free button[type="submit"]');
    await expect(page.locator('[data-sim="moves"]')).toContainText('Reverse repo with the Fed held by Money market fund, owed by Federal Reserve: $50.00 created.');
    await expect(counter(page, 'Bank reserves')).toHaveText('$450.00');
  });

  test('free mode: a write-off is drawn as the bank writing off the loan, never as a repayment', async ({ page }) => {
    await page.goto(FLOWS);
    await page.selectOption('#sim-flows-action', 'lend');
    await page.selectOption('#sim-flows-party', 'H1');
    await page.fill('#sim-flows-amount', '100');
    await page.click('.sim-free button[type="submit"]');
    await page.selectOption('#sim-flows-action', 'write-off');
    await page.selectOption('#sim-flows-party', 'H1');
    await page.fill('#sim-flows-amount', '40');
    await page.click('.sim-free button[type="submit"]');
    const title = page.locator('[data-sim="flow"] svg title');
    await expect(title).toHaveText('Flows: Bank A to Household 1, writes off $40.00');
    await expect(title).not.toContainText('repays');
  });
});

for (const theme of ['dark', 'light'] as const) {
  test(`both lessons have no accessibility violations in ${theme}, mid-simulation`, async ({ browser }) => {
    const context = await browser.newContext();
    await storeTheme(context, theme);
    const page = await context.newPage();
    for (const path of [BANKS, FLOWS]) {
      await page.goto(path);
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => `${path} ${v.id}`)).toEqual([]);
      for (let i = 0; i < 5; i += 1) await next(page);
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => `${path} ${v.id}`)).toEqual([]);
    }
    await context.close();
  });
}

test('a 320 px screen never scrolls sideways in either lesson', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const page = await context.newPage();
  for (const path of [BANKS, FLOWS]) {
    await page.goto(path);
    await next(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(320);
  }
  await context.close();
});
