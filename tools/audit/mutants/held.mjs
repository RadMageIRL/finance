// Mutants of the owner brief R changes, read by tools/audit/mutate.mjs with the rest: the pages
// guard (src/lib/data/shell-dist.ts rule D5), the production rule D6 (owner brief V) and the Eastern Time dates of the change logs
// (src/lib/data/format.ts). Each entry is [id, file, find, replace]; `find` occurs exactly once in
// the file. tests/unit/data/shell/dist.test.ts and tests/unit/data/format.test.ts must fail for
// every one.
const D = 'src/lib/data/shell-dist.ts';
const F = 'src/lib/data/format.ts';

export const MUTANTS = [
  // D5: only DATA_PAGES=on builds the pages; anything else holds them.
  ['data-held-any-value-builds', D, "return env.DATA_PAGES === 'on';", 'return Boolean(env.DATA_PAGES);'],
  ['data-held-dataset-builds', D, "return env.DATA_PAGES === 'on';", "return env.DATA_PAGES === 'on' || Boolean(env.ECON_DIR);"],
  // D5: a held build may not build a data page, nor link to one; each linked page is named once.
  ['data-held-pages-ignored', D, 'for (const p of pages) if (isDataPage(p)) problems.push(', 'for (const p of pages) if (false && isDataPage(p)) problems.push('],
  ['data-held-links-ignored', D, 'for (const l of new Set(links)) if (isDataPage(l)) problems.push(', 'for (const l of new Set(links)) if (false && isDataPage(l)) problems.push('],
  ['data-held-links-repeated', D, 'for (const l of new Set(links)) if (isDataPage(l)) problems.push(', 'for (const l of links) if (isDataPage(l)) problems.push('],
  // D5: with the pages on, every one of the four must be built.
  ['data-held-on-missing-ignored', D, 'for (const p of DATA_PAGE_PATHS) if (!built.has(p)) problems.push(', 'for (const p of DATA_PAGE_PATHS) if (false && !built.has(p)) problems.push('],
  ['data-held-on-checks-held-rules', D, '    return problems;\n  }\n  for (const p of pages)', '  }\n  for (const p of pages)'],
  // D6 (owner brief V item 1): production shows the pages only from a verified release.
  ['data-prod-anywhere', D, "if (env.GITHUB_ACTIONS !== 'true') return [];", "if (env.GITHUB_ACTIONS === 'false') return [];"],
  ['data-prod-never', D, "if (env.GITHUB_ACTIONS !== 'true') return [];", 'return [];'],
  ['data-prod-source-ignored', D, "const release = env.ECON_SOURCE === 'release' && Boolean(env.ECON_DIR)", 'const release = Boolean(env.ECON_DIR)'],
  ['data-prod-dir-unchecked', D, '&& Boolean(env.ECON_DIR) && dirExists && Boolean(env.ECON_VERIFIED);', '&& Boolean(env.ECON_DIR) && Boolean(env.ECON_VERIFIED);'],
  ['data-prod-verified-ignored', D, '&& dirExists && Boolean(env.ECON_VERIFIED);', '&& dirExists;'],
  ['data-prod-pages-allowed', D, "if (dataPagesOn(env) && !release) problems.push(", "if (false && !release) problems.push("],
  ['data-prod-fixture-allowed', D, "if (env.ECON_DIR && !release) problems.push(", "if (false) problems.push("],
  // Change logs: detection dates are America/New_York dates, labeled so.
  ['data-et-date-utc', F, "const EASTERN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',", "const EASTERN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC',"],
  ['data-et-date-any-input', F, "if (!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/.test(utc)) throw new Error(`not a stored UTC time: ${utc}`);", ''],
  ['data-et-label-unlabeled', F, "export const DETECTED_LABEL = 'Detected (Eastern Time date)';", "export const DETECTED_LABEL = 'Detected';"],
];
