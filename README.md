# RadMage Finance

A free financial education and research site from RadMage Labs at `https://radmagelabs.com/finance/`.

**Version 0.1.0 (2026-11-16).** Phase 1: five calculators (compound interest, APR and APY, high-yield savings, loan amortization, mortgage payoff) with reports, CSV, printing and share links, and three interactive lessons (What Is Money?, How Banks Create Money, How Money Flows).

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

## Release and deployment

The site is published to GitHub Pages by `.github/workflows/pages.yml`, which runs only by hand, and the RadMage Labs site serves it at `https://radmagelabs.com/finance/` through a rewrite to `https://radmageirl.github.io/finance/`. The repository name matches the `/finance/` base path, so both addresses work.

1. Recheck every dated fact the pages cite, bump the review dates, and run `npm run check`; every step must pass.
2. Commit, tag the release (`vX.Y.Z`), push, and run the workflow (`gh workflow run pages.yml`).
3. Compare the SHA-256 list in the workflow log with `node tools/dist-manifest.mjs` from a local build of the same commit. Builds of one commit match within a calendar month: the loan calculators' default first payment is the month after the build.
4. Verify the deployment: `node tools/verify-prod.mjs https://radmageirl.github.io --origin-only` for GitHub Pages, and `node tools/verify-prod.mjs` for `radmagelabs.com` (pages, canonicals, security headers, the 404 page, trailing-slash redirects, sitemap, `robots.txt`, and the other RadMage Labs apps).

Rollback: run the workflow again from the previous release tag. If the problem is in the RadMage Labs routing, revert that change in the Labs repository.

## License

The original application code in this repository is released under the MIT License (see `LICENSE`). Third-party material is not covered by it and stays under its own terms: the quotations from statutes, regulations, agency publications and other works that the lessons and calculators cite, and the npm dependencies, each under its own license.
