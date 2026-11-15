#!/usr/bin/env node
// Open Graph images (SEO_STRATEGY section 3): one 1200 x 630 PNG per lesson and calculator,
// plus a default, written to public/og/. Rendered locally with Playwright from an HTML card
// that uses the site's mark and dark palette; run again after a title changes and commit
// the images. Nothing here runs at build time or on the site.

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('public', 'og');
const MARK = readFileSync(join('public', 'favicon.svg'), 'utf8');

const CARDS = [
  { file: 'default', kicker: 'RadMage Labs', title: 'Money, banking and interest, explained with sources', line: 'Lessons and calculators that show their work' },
  { file: 'lesson-what-is-money', kicker: 'Lesson', title: 'What Is Money?', line: 'Cash, deposits, reserves, Treasury bills, stablecoins, bitcoin and gold compared' },
  { file: 'lesson-how-banks-create-money', kicker: 'Lesson', title: 'How Banks Create Money', line: 'A loan from start to finish, on balance sheets that always balance' },
  { file: 'lesson-how-money-flows', kicker: 'Lesson', title: 'How Money Flows', line: 'Payments, taxes, Treasury borrowing and the Fed, step by step' },
  { file: 'calc-compound-interest', kicker: 'Calculator', title: 'Compound interest', line: 'Contributions versus interest, by day, month or year' },
  { file: 'calc-apr-apy', kicker: 'Calculator', title: 'APR and APY', line: 'Compare savings accounts on the same footing' },
  { file: 'calc-savings-growth', kicker: 'Calculator', title: 'High-yield savings', line: 'Daily rates, monthly credits and the APY you actually earn' },
  { file: 'calc-amortization', kicker: 'Calculator', title: 'Loan amortization', line: 'Every payment split into principal and interest' },
  { file: 'calc-loan-payoff', kicker: 'Calculator', title: 'Mortgage payoff', line: 'What extra payments save, with and without them' },
];

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; }
  body { box-sizing: border-box; padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between;
    background: #10151f; color: #e8eef6;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  .brand { display: flex; align-items: center; gap: 18px; font-size: 34px; font-weight: 700; }
  .brand svg { width: 64px; height: 64px; }
  .brand b { color: #7dd3e8; }
  .kicker { margin: 0 0 18px; color: #7dd3e8; font-size: 28px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; }
  h1 { margin: 0; font-size: 84px; line-height: 1.05; letter-spacing: -0.02em; }
  p.line { margin: 26px 0 0; color: #aab7c8; font-size: 34px; line-height: 1.3; max-width: 980px; }
  .foot { display: flex; justify-content: space-between; color: #8c99ae; font-size: 24px; border-top: 2px solid #273548; padding-top: 22px; }
</style></head><body>
  <div class="brand">${MARK}<span>RadMage <b>Finance</b></span></div>
  <div><p class="kicker">${esc(c.kicker)}</p><h1>${esc(c.title)}</h1><p class="line">${esc(c.line)}</p></div>
  <div class="foot"><span>radmagelabs.com/finance</span><span>Free, sourced, private</span></div>
</body></html>`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const c of CARDS) {
  await page.setContent(html(c), { waitUntil: 'load' });
  await page.screenshot({ path: join(OUT, `${c.file}.png`), type: 'png' });
  console.log(`og: ${c.file}.png`);
}
await browser.close();
