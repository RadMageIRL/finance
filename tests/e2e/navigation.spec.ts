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

  for (const path of ['', 'learn/']) {
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

test.describe('News preview', () => {
  test('is clearly marked as a preview with true status values and is not indexed', async ({ page }) => {
    await page.goto(url('news/'));
    await expect(page.locator('h1')).toHaveText('Financial News');
    await expect(page.locator('.preview-banner')).toContainText('News is not live yet');
    await expect(page.locator('.feed-status dd')).toHaveText(['Not live', '0', 'None yet']);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  });

  test('has a section for each category, reachable from the category links', async ({ page }) => {
    await page.goto(url('news/'));
    const categories = ['Markets', 'Economy', 'Federal Reserve', 'Banking', 'Crypto', 'Regulation'];
    await expect(page.locator('.chip-nav a')).toHaveText(categories);
    await expect(page.locator('.news-category h2')).toHaveText(categories);
    for (const chip of await page.locator('.chip-nav a').all()) {
      const target = (await chip.getAttribute('href'))!;
      await expect(page.locator(target)).toHaveCount(1);
    }
  });

  test('invents nothing: no times, no outside links, skeletons hidden from assistive technology', async ({ page }) => {
    await page.goto(url('news/'));
    const main = page.locator('main');
    await expect(main.locator('time')).toHaveCount(0);
    await expect(main.locator('a[href^="http"]')).toHaveCount(0);
    const skeletons = main.locator('.story-grid, .cluster, .story--anatomy');
    expect(await skeletons.count()).toBeGreaterThan(0);
    for (const block of await skeletons.all()) {
      await expect(block).toHaveAttribute('aria-hidden', 'true');
      await expect(block.locator('a, button, input, [tabindex]')).toHaveCount(0);
    }
  });

  test('the homepage features News with links into each category', async ({ page }) => {
    await page.goto(url(''));
    const panel = page.locator('.news-home');
    await expect(panel.locator('h2')).toHaveText('Financial News');
    await expect(panel.locator('.badge--preview')).toBeVisible();
    await expect(panel.locator('.topic-tile')).toHaveCount(6);
    await panel.locator('.topic-tile', { hasText: 'Federal Reserve' }).click();
    await expect(page).toHaveURL(/\/finance\/news\/#federal-reserve$/);
    await expect(page.locator('#federal-reserve')).toBeInViewport();
  });
});
