#!/usr/bin/env node
// The full local check, run before every checkpoint commit:
// house-style text scan, type check, unit tests, build, built-output checks, browser tests.
// Output is shown and also saved under local/checks/ (local only, never committed).

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STEPS = [
  ['Text scan (dashes, attribution)', 'node', ['tools/text-scan.mjs']],
  ['Type check', 'npx', ['astro', 'check']],
  ['Unit tests', 'npx', ['vitest', 'run']],
  ['Build', 'npx', ['astro', 'build']],
  ['Built output (links, origins, metadata, sitemap, weight)', 'node', ['tools/dist-check.mjs']],
  ['Browser tests (theme, accessibility, layout, privacy)', 'npx', ['playwright', 'test']],
];

const log = [];
const summary = [];
let failed = false;

for (const [label, command, args] of STEPS) {
  const started = Date.now();
  process.stdout.write(`\n=== ${label}\n`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
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

const text = `${summary.join('\n')}\n`;
process.stdout.write(`\n=== Summary\n${text}`);

const stamp = new Date().toISOString().replace(/[:]/g, '').replace(/\..+/, 'Z');
mkdirSync(join('local', 'checks'), { recursive: true });
const file = join('local', 'checks', `check-${stamp}.log`);
writeFileSync(file, `${log.join('\n')}\n=== Summary\n${text}`);
process.stdout.write(`Saved ${file}\n`);
process.exit(failed ? 1 : 0);
