# RadMage Finance

A free financial education and research site from RadMage Labs, planned for `https://radmagelabs.com/finance/`.

**Status: v0.1.0 release candidate, not yet published.** Phase 1 is complete: five calculators (compound interest, APR and APY, high-yield savings, loan amortization, mortgage payoff) with reports, CSV, printing and share links, and three interactive lessons (What Is Money?, How Banks Create Money, How Money Flows).

## What it will be

- **Learn**: interactive lessons on what money is, how it moves, how banks create it, how the Federal Reserve operates, inflation, interest and debt, with balance sheets that always balance.
- **Calculators**: compound interest, APR and APY, high-yield savings growth, loan amortization and mortgage payoff first; inflation, debt repayment and refinancing later. Formulas and assumptions are shown, and everything is calculated in your browser.
- **Data**: official economic data from US agencies, with sources and release dates.
- **News**: headlines from named sources, linked to the original articles.
- **Crypto**: digital asset coverage and a source-backed adoption tracker.
- **Policy**: legislation, rulemaking and votes from primary public records.

It is not a trading-signal service, investment advice, a partisan outlet or a crypto promotion site.

## Principles

- Free to use, with no account.
- Calculations run in your browser; your numbers are not sent anywhere.
- Every fact is sourced, and time-sensitive facts carry the date they were checked.
- Each section says whether it states facts, accounting identities, simplified models, interpretations, projections or forecasts.
- Accessible in dark and light themes, on phones and desktops.

## Development

Requires Node.js 22.23.4 or later, and Python 3 (standard library only) for the independent reference oracle in `tests/oracle/`.

```sh
npm install
npx playwright install chromium   # once, for the browser tests
npm run dev       # development server at http://localhost:4321/finance/
npm run build     # static site in dist/
npm run preview   # serve the build at http://127.0.0.1:4329/finance/
npm run check     # full local check: text rules, oracle fixtures, types, unit tests, test-integrity audits, build, output checks, browser tests
node tools/dist-manifest.mjs > SHA256SUMS.txt   # checksums of the build in dist/
```
