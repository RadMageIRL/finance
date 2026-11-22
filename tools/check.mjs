#!/usr/bin/env node
// The full local check, run before every checkpoint commit: house-style text scan, oracle
// fixture reproduction, type check, unit tests, the two test-integrity audits, the independent
// check of the data pipeline's fixture scenario, and four builds (held, no data, fixture,
// release), each with its built-output checks and browser tests.
// Output is shown and also saved under local/checks/ (local only, never committed).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// One check at a time: overlapping runs share the build output, the preview port and the
// mutation work tree, and their results are easy to confuse.
const LOCK = join('local', 'checks', '.running');
mkdirSync(join('local', 'checks'), { recursive: true });
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    alive = false;
  }
  if (alive) {
    console.log(`check: another check is already running (process ${pid}); wait for it to finish`);
    process.exit(1);
  }
}
writeFileSync(LOCK, String(process.pid));
process.on('exit', () => rmSync(LOCK, { force: true }));

// The builds the last steps check (brief Q; owner brief R; src/lib/data/econ-load.ts and rule D5 of
// src/lib/data/shell-dist.ts), each with the matching browser run (ECON_BUILD, tests/e2e/helpers.ts):
// - HELD: as production builds until the data pages are approved to go live: no DATA_PAGES, no
//   data. The site must be the live Finance site as it was.
// - NO_DATA: the data pages built without a dataset: their unavailable state.
// - FIXTURE: the data pages built with the verified appendix B fixture root (test data, never a
//   publication; the pages say so and carry noindex).
// - RELEASE: the production release build rehearsed (owner brief V item 2): the appendix J
//   scenario's release checked and placed outside dist/ by the site build's own fetch-step code
//   and the independent checker (tools/econ-release.mjs), the build made from it with the pages
//   approved, the tree copied to dist/data/econ, and the built-output checks run as on GitHub
//   Actions, so the production rule D6 applies. Test data from the fixtures; nothing is published.
// Only RELEASE sets ECON_SOURCE and ECON_VERIFIED.
const HELD = { DATA_PAGES: '', ECON_DIR: '', ECON_SOURCE: '', ECON_VERIFIED: '', ECON_BUILD: 'held' };
const NO_DATA = { DATA_PAGES: 'on', ECON_DIR: '', ECON_SOURCE: '', ECON_VERIFIED: '', ECON_BUILD: 'none' };
const FIXTURE = { DATA_PAGES: 'on', ECON_DIR: join('local', 'econ-fixture', 'live'), ECON_SOURCE: '', ECON_VERIFIED: '', ECON_BUILD: 'fixture' };
const RELEASE_ROOT = join('local', 'econ-release');
const RELEASE = { DATA_PAGES: 'on', ECON_DIR: join(RELEASE_ROOT, 'econ'), ECON_SOURCE: 'release', ECON_VERIFIED: join(RELEASE_ROOT, 'verified.json'), ECON_BUILD: 'release' };
const AS_PRODUCTION = { ...RELEASE, GITHUB_ACTIONS: 'true' };

// The pipeline belongs to finance-data (owner brief V item 3): its own independent check runs where
// pipeline/ is in the tree (the development branch). A site-only tree reads the pipeline through
// ECON_TOOLS for the fixture and release steps (tools/econ-tools.mjs) and leaves this check to
// finance-data, and the summary says so.
const HAS_PIPELINE = existsSync('pipeline');
const DATACHECK = HAS_PIPELINE
  ? [['Data pipeline: independent check of the fixture scenario (Python)', 'node', ['tools/datacheck.mjs']]]
  : [];

const STEPS = [
  ['Text scan (dashes, attribution)', 'node', ['tools/text-scan.mjs']],
  ['Oracle fixtures reproduce (Python decimal)', 'node', ['tools/oracle-check.mjs']],
  ['Type check', 'npx', ['astro', 'check']],
  ['Unit tests (engines against the oracle and Regulation DD)', 'npx', ['vitest', 'run']],
  ['Test integrity: names versus assertions', 'node', ['tools/audit/test-names.mjs']],
  ['Test integrity: mutation pass', 'node', ['tools/audit/mutate.mjs']],
  ...DATACHECK,
  ['Build as production, the data pages held', 'npx', ['astro', 'build'], HELD],
  ['Built output with the data pages held', 'node', ['tools/dist-check.mjs'], HELD],
  ['Browser tests with the data pages held (the live site as it was)', 'npx', ['playwright', 'test'], HELD],
  ['Build with the data pages and no data', 'npx', ['astro', 'build'], NO_DATA],
  ['Built output with the data pages and no data', 'node', ['tools/dist-check.mjs'], NO_DATA],
  ['Browser tests with the data pages and no data (the unavailable state)', 'npx', ['playwright', 'test'], NO_DATA],
  ['Economic data fixture (appendix B, test data)', 'node', ['tools/econ-fixture.mjs']],
  ['Build with the economic data fixture', 'npx', ['astro', 'build'], FIXTURE],
  ['Built output (links, origins, metadata, sitemap, weight)', 'node', ['tools/dist-check.mjs'], FIXTURE],
  ['Browser tests (theme, accessibility, layout, privacy)', 'npx', ['playwright', 'test'], FIXTURE],
  ['Economic data release (appendix J, test data), checked and placed as the site build does', 'node', ['tools/econ-release.mjs']],
  ['Build from the release, as production with the pages approved', 'npx', ['astro', 'build'], RELEASE],
  ['The verified release tree copied to dist/data/econ', 'node', ['tools/econ-release.mjs', 'place'], RELEASE],
  ['Built output from the release, checked as production (rule D6)', 'node', ['tools/dist-check.mjs'], AS_PRODUCTION],
  ['Browser tests from the release (indexed, stamped, data files served as verified)', 'npx', ['playwright', 'test'], RELEASE],
];

const log = [];
const summary = [];
let failed = false;

for (const [label, command, args, stepEnv = {}] of STEPS) {
  const started = Date.now();
  process.stdout.write(`\n=== ${label}\n`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...stepEnv },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  const ok = result.status === 0;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  summary.push(`${ok ? 'PASS' : 'FAIL'}  ${label} (${seconds}s)`);
  log.push(`=== ${label}\n${output}`);
  if (!ok) {
    failed = true;
    break;
  }
}

if (!HAS_PIPELINE) summary.push('NOTE  pipeline/ is not in this tree: its independent check and its mutants run in finance-data');
const text = `${summary.join('\n')}\n`;
process.stdout.write(`\n=== Summary\n${text}`);

const stamp = new Date().toISOString().replace(/[:]/g, '').replace(/\..+/, 'Z');
mkdirSync(join('local', 'checks'), { recursive: true });
const file = join('local', 'checks', `check-${stamp}.log`);
writeFileSync(file, `${log.join('\n')}\n=== Summary\n${text}`);
process.stdout.write(`Saved ${file}\n`);
process.exit(failed ? 1 : 0);
