import { createHash } from 'node:crypto';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { HEAD_SCRIPT } from './src/lib/theme/head-script.mjs';

// The theme bootstrap is the only inline script. Its hash goes into script-src so the page
// can run it under a strict Content-Security-Policy.
const headScriptHash = `sha256-${createHash('sha256').update(HEAD_SCRIPT).digest('base64')}`;

// Pages that must not be indexed: review and error pages, and News while it is a preview
// (NEWS_LIVE in src/lib/site.ts; remove 'news' here when feeds go live).
const LAST_REVIEWED = '2026-11-16';

const NOT_IN_SITEMAP = /\/finance\/(design-system|404|news)\/$/;

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
  // No code blocks on the site; Shiki's inline styles would also conflict with the CSP.
  markdown: { syntaxHighlight: false },
  integrations: [
    sitemap({
      filter: (page) => !NOT_IN_SITEMAP.test(page),
      // Every Phase 1 page was last reviewed on this date (src/lib/site.ts PHASE1_REVIEWED).
      serialize: (item) => ({ ...item, lastmod: LAST_REVIEWED }),
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
