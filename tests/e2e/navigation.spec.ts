import { expect, test } from '@playwright/test';
import { url } from './helpers';

const MORE_LINKS = ['About', 'Methodology', 'Sources', 'Corrections', 'Privacy', 'Disclaimer'];

test.describe('primary navigation', () => {
  test('desktop shows Home, News, Learn, Calculators and More in that order', async ({ page }) => {
    await page.goto(url(''));
    const items = page.locator('.site-header .site-nav > ul > li');
    await expect(items).toHaveCount(5);
    await expect(items.locator('> a, > details > summary')).toHaveText(['Home', 'News', 'Learn', 'Calculators', 'More']);
    await expect(page.locator('.site-nav > ul > li > a[aria-current="page"]')).toHaveText('Home');
  });

  test('the current section is marked on its pages', async ({ page }) => {
    await page.goto(url('news/'));
    await expect(page.locator('.site-nav > ul > li > a[aria-current="page"]')).toHaveText('News');
    await page.goto(url('methodology/'));
    await expect(page.locator('.site-nav > ul > li > a[aria-current]')).toHaveCount(0);
    await expect(page.locator('.more-menu > summary')).toHaveClass(/is-current/);
  });
});

test.describe('More menu', () => {
  test('opens from the keyboard, lists the reference pages, and Escape returns focus', async ({ page }) => {
    await page.goto(url(''));
    const summary = page.locator('.more-menu > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.more-menu')).toHaveAttribute('open', '');
    await expect(page.locator('.more-menu__panel ul a')).toHaveText(MORE_LINKS);
    await page.keyboard.press('Tab');
    await expect(page.locator('.more-menu__panel a', { hasText: 'About' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.more-menu')).not.toHaveAttribute('open', '');
    await expect(summary).toBeFocused();
  });

  test('closes on an outside click and when focus leaves it', async ({ page }) => {
    await page.goto(url(''));
    const menu = page.locator('.more-menu');
    await page.locator('.more-menu > summary').click();
    await expect(menu).toHaveAttribute('open', '');
    await page.mouse.click(20, 500);
    await expect(menu).not.toHaveAttribute('open', '');

    await page.locator('.more-menu > summary').click();
    await page.locator('.more-menu__foot a').focus();
    await page.keyboard.press('Tab');
    await expect(menu).not.toHaveAttribute('open', '');
  });

  test('its links navigate', async ({ page }) => {
    await page.goto(url(''));
    await page.locator('.more-menu > summary').click();
    await page.locator('.more-menu__panel a', { hasText: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/finance\/privacy\/$/);
  });

  test('the phone menu carries the same More links', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(url(''));
    await page.locator('[data-menu-open]').click();
    await expect(page.locator('#site-menu .menu-nav').first().locator('a')).toHaveText(['Home', 'News', 'Learn', 'Calculators']);
    await expect(page.locator('#site-menu .menu-nav--secondary a')).toHaveText(MORE_LINKS);
    await context.close();
  });
});

test.describe('in-development items', () => {
  test('/finance/calculators/ links every one of the five Phase 1 calculators', async ({ page }) => {
    await page.goto(url('calculators/'));
    await expect(page.locator('.badge', { hasText: 'In development' })).toHaveCount(0);
    for (const path of ['compound-interest/', 'apr-apy/', 'savings-growth/', 'amortization/', 'loan-payoff/']) {
      await expect(page.locator(`a[href="/finance/calculators/${path}"]`).first(), path).toBeVisible();
    }
  });

  test('/finance/learn/ links all three Phase 1 lessons', async ({ page }) => {
    await page.goto(url('learn/'));
    await expect(page.locator('.badge', { hasText: 'In development' })).toHaveCount(0);
    for (const path of ['what-is-money/', 'how-banks-create-money/', 'how-money-flows/']) {
      await expect(page.locator(`a[href="/finance/learn/${path}"]`).first(), path).toBeVisible();
    }
  });

  for (const path of ['design-system/']) {
    test(`/finance/${path} shows in-development cards that are not links`, async ({ page }) => {
      await page.goto(url(path));
      const cards = page.locator('.card').filter({ has: page.locator('.badge', { hasText: 'In development' }) });
      expect(await cards.count()).toBeGreaterThan(0);
      await expect(cards.locator('a')).toHaveCount(0);
      for (const card of await cards.all()) {
        expect(await card.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');
        expect(await card.getAttribute('tabindex')).toBeNull();
      }
    });
  }
});

// The News pages are tested in tests/e2e/news.spec.ts (v0.3.0: live news replaced the preview).
