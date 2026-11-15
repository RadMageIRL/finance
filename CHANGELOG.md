# Changelog

All notable changes to RadMage Finance are recorded here.

## Unreleased

### Added

- Site foundation: a static Astro site served under `/finance/`, with TypeScript, hand-written CSS and no client framework.
- Theme system: Dark by default, with Light and System options. The choice is saved on the device, applied before the first paint, and System follows the operating system live. Without JavaScript the site is dark.
- Responsive header with primary navigation, a phone menu, breadcrumbs and a footer.
- Learn and Calculators section pages listing the first three lessons and five calculators, which are in development.
- Reference pages: About, Methodology, Sources, Corrections, Privacy and Disclaimer.
- A strict Content Security Policy on every page, no third-party requests and no cookies.
- Local checks: house-style text scan, type check, unit tests, build output checks (links, origins, metadata, sitemap, page weight), and browser tests for the theme, accessibility in every theme, layout at 320 px, and privacy.
