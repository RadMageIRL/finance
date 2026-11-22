import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { HEAD_SCRIPT } from './src/lib/theme/head-script.mjs';
import { dataPagesIndexed, dataPagesOn, isDataPage } from './src/lib/data/shell-dist.ts';
import { DATA_PAGES_REVIEWED } from './src/lib/data/review.ts';

// The theme bootstrap is the only inline script. Its hash goes into script-src so the page
// can run it under a strict Content-Security-Policy.
const headScriptHash = `sha256-${createHash('sha256').update(HEAD_SCRIPT).digest('base64')}`;

// Pages that must not be indexed: review and error pages, and News while it is a preview
// (NEWS_LIVE in src/lib/site.ts; remove 'news' here when feeds go live).
const LAST_REVIEWED = '2026-11-16';
// The sitemap's lastmod is each page's last reviewed date (SEO_STRATEGY 5; owner brief T). The data
// pages, and the reference pages whose economic data sections are built with them, were reviewed
// on DATA_PAGES_REVIEWED (src/lib/data/review.ts); a held build lists neither, so it is unchanged.
const DATA_SECTION_PAGES = /\/finance\/(sources|methodology|privacy|corrections)\/$/;
const lastmodOf = (url) => (dataPagesOn(process.env) && (isDataPage(url) || DATA_SECTION_PAGES.test(url)) ? DATA_PAGES_REVIEWED : LAST_REVIEWED);

const BASE_NOT_IN_SITEMAP = /\/finance\/(design-system|404|news)\/$/;
// The economic data pages stay out of the sitemap unless the build is from a verified release
// (they carry noindex then too; DataLayout.astro, src/lib/data/shell-dist.ts).
const NOT_IN_SITEMAP = { test: (page) => BASE_NOT_IN_SITEMAP.test(page) || (!dataPagesIndexed(process.env) && isDataPage(page)) };

// The economic data pages live outside src/pages and are added as routes only when the build has
// DATA_PAGES=on (owner brief R, option (b); rule D5 of src/lib/data/shell-dist.ts). Without it the
// build is the live Finance site as it was: the pages, their menu entries and every link to them
// are held until they are approved to go live.
const DATA_ROUTES = [
  ['/data', './src/data-pages/index.astro'],
  ['/data/federal-funds-rate', './src/data-pages/federal-funds-rate.astro'],
  ['/data/money-stock', './src/data-pages/money-stock.astro'],
  ['/data/public-debt', './src/data-pages/public-debt.astro'],
];
const dataPages = {
  name: 'rmf-data-pages',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      if (!dataPagesOn(process.env)) return;
      for (const [pattern, entrypoint] of DATA_ROUTES) injectRoute({ pattern, entrypoint });
    },
  },
};

// In a held build, the data components that pages outside /finance/data/ import resolve to an
// empty component, so their markup, styles and scripts never reach the build (Astro links the
// styles of every component a page imports, rendered or not).
const HELD_MODULES = ['/src/components/data/DataMenuEntry.astro', '/src/components/data/DesignSystemData.astro'];
const HELD_STAND_IN = fileURLToPath(new URL('./src/components/data/Held.astro', import.meta.url));
const holdDataModules = {
  name: 'rmf-hold-data-modules',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (dataPagesOn(process.env) || !source.includes('/data/') || !source.endsWith('.astro')) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    const id = resolved?.id.replace(/\\/g, '/');
    return id && HELD_MODULES.some((m) => id.endsWith(m)) ? HELD_STAND_IN : null;
  },
};

export default defineConfig({
  site: 'https://radmagelabs.com',
  base: '/finance',
  trailingSlash: 'always',
  output: 'static',
  build: {
    format: 'directory',
    inlineStylesheets: 'never',
  },
  devToolbar: { enabled: false },
  vite: { plugins: [holdDataModules] },
  // No code blocks on the site; Shiki's inline styles would also conflict with the CSP.
  markdown: { syntaxHighlight: false },
  integrations: [
    dataPages,
    sitemap({
      filter: (page) => !NOT_IN_SITEMAP.test(page),
      // Every Phase 1 page was last reviewed on LAST_REVIEWED (src/lib/site.ts PHASE1_REVIEWED);
      // the data pages and the data sections on DATA_PAGES_REVIEWED.
      serialize: (item) => ({ ...item, lastmod: lastmodOf(item.url) }),
    }),
  ],
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      scriptDirective: {
        hashes: [headScriptHash],
      },
    },
  },
});
