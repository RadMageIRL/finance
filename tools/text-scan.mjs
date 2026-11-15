#!/usr/bin/env node
// House-style scan: no em dashes, no en dashes, and no AI attribution text, anywhere in the
// project's own files (code, styles, pages, tests, tools, docs, commit messages).
//
//   node tools/text-scan.mjs              scan the working tree
//   node tools/text-scan.mjs --staged     scan the staged version of staged files (pre-commit)
//   node tools/text-scan.mjs --message F  scan a commit message file (commit-msg)

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

// Built from fragments so this file does not flag itself.
const ATTRIBUTION = [
  new RegExp(['co', 'authored', 'by'].join('-'), 'i'),
  new RegExp(`\\b${['clau', 'de'].join('')}\\b`, 'i'),
  new RegExp(`\\b${['anth', 'ropic'].join('')}\\b`, 'i'),
  new RegExp(`\\b${['chat', 'gpt'].join('')}\\b`, 'i'),
  new RegExp(`\\bai[- ]${['gener', 'ated'].join('')}\\b`, 'i'),
  new RegExp(`\\bai[- ]${['assi', 'sted'].join('')}\\b`, 'i'),
  new RegExp(`${['gener', 'ated'].join('')} (with|by) (an? )?ai\\b`, 'i'),
];

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.astro', 'local', 'test-results', 'playwright-report', 'blob-report',
]);
const SKIP_FILES = new Set(['package-lock.json']);
// Local planning notes quote the attribution rule itself, so only the dash rules apply there.
const ATTRIBUTION_EXEMPT = [/^docs\//, /^HANDOFF\.md$/];
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.pdf', '.zip']);

/** Returns a list of problems found in `text`, each with a 1-based line number. */
export function scanText(text, { attribution = true } = {}) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes(EM_DASH)) problems.push({ line: index + 1, rule: 'em dash' });
    if (line.includes(EN_DASH)) problems.push({ line: index + 1, rule: 'en dash' });
    if (!attribution) return;
    for (const pattern of ATTRIBUTION) {
      if (pattern.test(line)) {
        problems.push({ line: index + 1, rule: 'attribution text' });
        break;
      }
    }
  });
  return problems;
}

const isExempt = (file) => ATTRIBUTION_EXEMPT.some((pattern) => pattern.test(file));

function walk(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), root, out);
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name) || BINARY.has(extname(entry.name).toLowerCase())) continue;
      out.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
    }
  }
  return out;
}

function report(results) {
  let count = 0;
  for (const { file, problems } of results) {
    for (const problem of problems) {
      console.log(`${file}:${problem.line}: ${problem.rule}`);
      count += 1;
    }
  }
  return count;
}

function main() {
  const args = process.argv.slice(2);
  const root = process.cwd();
  const results = [];

  if (args[0] === '--message') {
    const file = args[1];
    if (!file) throw new Error('--message needs a file');
    // Git comment lines are not part of the message.
    const text = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n');
    results.push({ file: 'commit message', problems: scanText(text) });
  } else if (args[0] === '--staged') {
    const names = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      .filter((name) => !BINARY.has(extname(name).toLowerCase()) && !SKIP_FILES.has(name.split('/').pop()));
    for (const name of names) {
      const text = execFileSync('git', ['show', `:${name}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      results.push({ file: name, problems: scanText(text, { attribution: !isExempt(name) }) });
    }
  } else {
    for (const file of walk(root, root, [])) {
      if (statSync(join(root, file)).size > 5 * 1024 * 1024) continue;
      results.push({ file, problems: scanText(readFileSync(join(root, file), 'utf8'), { attribution: !isExempt(file) }) });
    }
  }

  const count = report(results);
  const scope = args[0] === '--message' ? 'commit message' : `${results.length} file(s)`;
  if (count > 0) {
    console.log(`text scan: ${count} problem(s) in ${scope}`);
    process.exit(1);
  }
  console.log(`text scan: clean (${scope})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
