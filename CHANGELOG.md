# Changelog

All notable changes to RadMage Finance are recorded here.

## Unreleased

### Added

- Site foundation: a static Astro site served under `/finance/`, with TypeScript, hand-written CSS and no client framework.
- Theme system: Dark by default, with Light and System options. The choice is saved on the device, applied before the first paint, and System follows the operating system live. Without JavaScript the site is dark.
- Responsive header with Home, News, Learn, Calculators and a More menu (About, Methodology, Sources, Corrections, Privacy, Disclaimer), a phone menu, breadcrumbs and a footer. More works without JavaScript.
- News section preview at `/finance/news/`: the layout for Markets, Economy, Federal Reserve, Banking, Crypto and Regulation, with feed status, category links, a story layout key and related-coverage grouping. No stories are collected yet, nothing is invented, and the page is not indexed until feeds are live.
- A Financial News section on the homepage linking into each news category.
- Calculation engines, kept separate from the pages: money rounding (half away from zero, with interest postings computed exactly), rate and APY conversions, Regulation DD APY and APY earned, the Regulation DD worked examples (reproduced with an inferred crediting assumption that the regulation does not require), compound interest, loan payments and amortization schedules with extra and one-time payments, and a balance-sheet ledger with the transaction catalog and its accounting invariants. Invalid or unrepresentable input is reported, never computed.
- An independent reference oracle in Python using decimal arithmetic, with fixtures for every published Regulation DD worked example, rate conversions, full loan schedules and compound interest tables. The engines match it to the cent.
- Test-integrity audits: a check that test names match their assertions, and a mutation pass that perturbs every rounding rule, threshold and formula constant.
- Compound interest calculator at `/finance/calculators/compound-interest/`: starting balance, rate, compounding frequency, years, and contributions (none, weekly, biweekly, monthly, quarterly or annually, independent of compounding) at the start or end of each interval, on a stated calendar with real month lengths; a results breakdown that adds up to the cent, a year-by-year chart with a hover and keyboard tooltip and a table equivalent, CSV download, and share links that keep the scenario in the part of the address after #, with exact, rounded or no dollar amounts and a plain statement of what such a link does not keep private. The example scenario is calculated at build time, so results show without JavaScript.
- APR and APY calculator at `/finance/calculators/apr-apy/`: converts a savings account's interest rate to its APY or an APY back to the rate for annual to daily compounding, compares up to three accounts with the interest each would pay on a chosen balance, notes when rounded APYs hide a difference, shows how compounding changes the APY for the same rate, and explains, with citations to Regulation DD and Regulation Z, why a savings APR and a loan APR are different measures. Chart with a table equivalent, CSV download and share links.
- High-yield savings calculator at `/finance/calculators/savings-growth/`: projects a savings balance from its advertised APY the way banks figure interest (a daily rate of 1/365 of the interest rate on each day's balance, compounded daily or monthly, credited monthly and rounded to the cent), with regular deposits on the shared calendar, up to three rate changes, the interest rate each APY implies, and the Regulation DD APY earned each month. Year-by-year and month-by-month tables, chart, CSV and share links.
- A reusable calculator kit: labeled inputs that accept pasted amounts like $1,234.56, results that update after a short pause in typing and are withdrawn the moment an entry becomes invalid, inline error messages, an SVG chart drawn at its real width so labels stay readable on phones, a sticky result bar on phones, and exact formatting and CSV helpers.
- Learn and Calculators section pages listing the first three lessons and five calculators; lessons and calculators that are not built yet are shown as in development and are not links.
- Reference pages: About, Methodology, Sources, Corrections, Privacy and Disclaimer.
- A strict Content Security Policy on every page, no third-party requests and no cookies.
- Local checks: house-style text scan, type check, unit tests, build output checks (links, origins, metadata, sitemap, page weight), and browser tests for the theme, accessibility in every theme, layout at 320 px, and privacy.
