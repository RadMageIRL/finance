// Financial News (v0.3.0). With NEWS_BUILD=fixture the build read tests/fixtures/news/news.json
// (synthetic test stories, one failed test feed); with NEWS_BUILD=none it had no news file.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { collectErrors, NEWS_BUILD, url } from './helpers';

const CATEGORIES = ['Markets', 'Economy', 'Federal Reserve', 'Banking', 'Crypto', 'Regulation'];

test.describe('News with stories', () => {
  test.skip(NEWS_BUILD !== 'fixture', 'needs the build with the fixture news file (NEWS_BUILD=fixture)');
  const fixture = JSON.parse(readFileSync('tests/fixtures/news/news.json', 'utf8')) as { items: { title: string; url: string; published: string | null; first_seen: string; categories: string[] }[] };

  test('lists every story newest first, with publisher, time and a link to the original, and is indexed', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(url('news/'));
    await expect(page.locator('h1')).toHaveText('Financial News');
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    const items = page.locator('[data-news-list] [data-news-item]');
    await expect(items).toHaveCount(fixture.items.length);
    await expect(items.locator('.news-item__title a')).toHaveText(fixture.items.map((i) => i.title));
    for (const [n, item] of fixture.items.entries()) {
      const li = items.nth(n);
      await expect(li.locator('.news-item__title a')).toHaveAttribute('href', item.url);
      await expect(li.locator('.news-item__title a')).toHaveAttribute('rel', 'noopener');
      await expect(li.locator('time')).toHaveAttribute('datetime', item.published ?? item.first_seen);
    }
    const times = await items.locator('time').evaluateAll((ts) => ts.map((t) => t.getAttribute('datetime') ?? ''));
    expect(times).toEqual([...times].sort().reverse());
    expect(errors).toEqual([]);
  });

  test('shows the refresh status and the feed that failed, without dropping anything', async ({ page }) => {
    await page.goto(url('news/'));
    await expect(page.locator('.feed-status dd').first()).toHaveText('November 22, 2026 at 18:00 UTC');
    await expect(page.locator('.news-warning')).toContainText('Test Treasury');
    await expect(page.locator('.news-warning')).toContainText('could not be read');
    await expect(page.locator('.news-sources li')).toHaveCount(4);
  });

  test('groups a joint release once, with the other publisher, and shows an excerpt only where allowed', async ({ page }) => {
    await page.goto(url('news/'));
    const joint = page.locator('[data-news-item]', { hasText: 'joint statement on bank capital' });
    await expect(joint).toHaveCount(1);
    await expect(joint.locator('.news-item__also a')).toHaveText('Test Bank Regulator');
    const bank = page.locator('[data-news-item]', { hasText: 'Deposit insurance fund' });
    await expect(bank.locator('.news-item__excerpt')).toHaveCount(0);
    await expect(page.locator('[data-news-item]', { hasText: 'stablecoin' }).locator('.news-item__excerpt')).toHaveText('Test data. Staff statement on crypto asset disclosures.');
  });

  test('search keeps only matching stories and says how many', async ({ page }) => {
    await page.goto(url('news/'));
    const input = page.getByLabel('Search these headlines');
    await input.fill('stablecoin');
    await expect(page.locator('[data-news-item]:visible')).toHaveCount(1);
    await expect(page.locator('[data-news-count]')).toHaveText(`1 of ${fixture.items.length} stories match`);
    await input.fill('test agency charges');
    await expect(page.locator('[data-news-item]:visible .news-item__title')).toHaveText(['Test: Agency charges firm with market manipulation']);
    await input.fill('');
    await expect(page.locator('[data-news-item]:visible')).toHaveCount(fixture.items.length);
  });

  test('each category page lists its stories; an empty one says so and is not indexed', async ({ page }) => {
    await page.goto(url('news/'));
    await expect(page.locator('.chip-nav a')).toHaveText(['All', ...CATEGORIES]);
    await page.locator('.chip-nav a', { hasText: 'Crypto' }).click();
    await expect(page).toHaveURL(/\/finance\/news\/crypto\/$/);
    await expect(page.locator('h1')).toHaveText('Crypto News');
    await expect(page.locator('.chip-nav a[aria-current="page"]')).toHaveText('Crypto');
    await expect(page.locator('[data-news-item]')).toHaveCount(fixture.items.filter((i) => i.categories.includes('crypto')).length);
    await page.goto(url('news/economy/'));
    await expect(page.locator('h2', { hasText: 'No stories yet' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  });

  test('without JavaScript every story is listed and the search stays hidden', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(url('news/'));
    await expect(page.locator('[data-news-item]')).toHaveCount(fixture.items.length);
    await expect(page.locator('[data-news-search]')).toBeHidden();
    await context.close();
  });

  test('the homepage links to the live News and its categories', async ({ page }) => {
    await page.goto(url(''));
    const panel = page.locator('.news-home');
    await expect(panel.locator('.badge--preview')).toHaveCount(0);
    await expect(panel.locator('.topic-tile')).toHaveCount(6);
    await panel.locator('.topic-tile', { hasText: 'Federal Reserve' }).click();
    await expect(page).toHaveURL(/\/finance\/news\/federal-reserve\/$/);
  });

  test('publishes the news file for the next collection', async ({ request }) => {
    const r = await request.get(url('news/news.json'));
    expect(r.ok()).toBe(true);
    expect((await r.json()).items).toHaveLength(fixture.items.length);
  });
});

test.describe('News without a news file', () => {
  test.skip(NEWS_BUILD !== 'none', 'needs a build without a news file (NEWS_BUILD=none)');

  test('says no stories have been collected, invents nothing, and is not indexed', async ({ page }) => {
    await page.goto(url('news/'));
    await expect(page.locator('h1')).toHaveText('Financial News');
    await expect(page.locator('h2', { hasText: 'No stories yet' })).toBeVisible();
    await expect(page.locator('[data-news-item]')).toHaveCount(0);
    await expect(page.locator('.feed-status dd').first()).toHaveText('None yet');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
    await expect(page.locator('main a[href^="http"]')).toHaveCount(0);
  });
});
