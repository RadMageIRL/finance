#!/usr/bin/env node
// Test-suite integrity, part 1 (FINANCIAL_MODEL_REQUIREMENTS 8.3): names versus assertions.
//
// Flags, in unit test files:
//   - a test with no assertion (no expect(...) and no call to an expect* helper);
//   - a test whose name claims a refusal ("rejects", "refuses", "throws") but whose body
//     asserts no refusal;
//   - a test whose name states a money or percent figure (6.17%, $1,199.10, 1 cent) that the
//     body never checks, in either dollars-and-cents or whole-cents form.
//
// The checker validates itself first against tools/audit/fixtures/bad-tests.txt, which
// holds one deliberately wrong test per rule; if it misses any, the audit fails.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Extracts `it(...)`/`test(...)` calls with their name and the text of their body. */
export function extractTests(source) {
  const tests = [];
  const pattern = /\b(?:it|test)\(\s*(['`"])((?:\\.|(?!\1)[^\\])*)\1\s*,/g;
  let match;
  while ((match = pattern.exec(source))) {
    // Walk to the end of this call by bracket depth, ignoring brackets inside strings.
    let depth = 1;
    let i = pattern.lastIndex;
    let quote = null;
    for (; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === '\\') i += 1;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(' || c === '{' || c === '[') depth += 1;
      else if (c === ')' || c === '}' || c === ']') depth -= 1;
    }
    tests.push({ name: match[2], body: source.slice(pattern.lastIndex, i), index: match.index });
  }
  return tests;
}

// "throws" counts only at the start ("throws on ..."); elsewhere it usually describes the
// environment ("falls back when storage access throws").
const REFUSAL_NAME = /\b(rejects?|refuses?)\b|^throws\b/i;
// Refusal forms used in this suite: thrown errors, results with ok: false, issue lists,
// hidden or absent elements, and decoders that return an empty object.
const REFUSAL_ASSERTION = /toThrow|\.ok\)\.toBe\(false|ok\s*===\s*false|ok:\s*false|issues|toBeHidden|toHaveCount\(0\)|code:\s*'|toEqual\(\{\}\)/;

/** Money and percent figures stated in a test name. */
function statedFigures(name) {
  const figures = [];
  for (const m of name.matchAll(/\$([\d,]+(?:\.\d{2})?)/g)) figures.push({ text: m[0], dollars: m[1].replace(/,/g, '') });
  for (const m of name.matchAll(/(\d+\.\d{2})%/g)) figures.push({ text: m[0], percent: m[1] });
  for (const m of name.matchAll(/\b(\d[\d,]*) cents?\b/g)) figures.push({ text: m[0], cents: m[1].replace(/,/g, '') });
  return figures;
}

function bodyChecks(body, figure) {
  const digits = body.replace(/_/g, '');
  const has = (s) => new RegExp(`(^|[^\\d.])${s.replace('.', '\\.')}($|[^\\d])`).test(digits);
  if (figure.percent) return has(figure.percent);
  if (figure.cents) return has(figure.cents);
  const [whole, fraction = '00'] = figure.dollars.split('.');
  const cents = String(Number(whole) * 100 + Number(fraction));
  return has(cents) || has(`${whole}.${fraction}`) || (fraction === '00' && has(whole));
}

export function audit(source) {
  const problems = [];
  for (const t of extractTests(source)) {
    const assertsSomething = /\bexpect\(|\bexpect[A-Z]\w*\(/.test(t.body);
    if (!assertsSomething) problems.push({ test: t.name, rule: 'no assertion' });
    if (REFUSAL_NAME.test(t.name) && !REFUSAL_ASSERTION.test(t.body)) problems.push({ test: t.name, rule: 'claims a refusal but asserts none' });
    for (const figure of statedFigures(t.name)) {
      if (!bodyChecks(t.body, figure)) problems.push({ test: t.name, rule: `states ${figure.text} but never checks it` });
    }
  }
  return problems;
}

function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? testFiles(join(dir, e.name)) : /\.(test|spec)\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

function main() {
  // 1. The checker must catch every planted mistake.
  const planted = audit(readFileSync('tools/audit/fixtures/bad-tests.txt', 'utf8'));
  const expectedRules = ['no assertion', 'claims a refusal but asserts none', 'states 6.17% but never checks it', 'states $133.13 but never checks it'];
  const missed = expectedRules.filter((rule) => !planted.some((p) => p.rule === rule));
  if (missed.length) {
    console.log(`test-name audit: SELF-CHECK FAILED, the checker missed: ${missed.join('; ')}`);
    process.exit(1);
  }
  console.log(`test-name audit: self-check caught all ${expectedRules.length} planted mistakes`);

  // 2. The real suite must be clean.
  let count = 0;
  let tests = 0;
  for (const file of [...testFiles('tests/unit'), ...testFiles('tests/e2e')]) {
    const source = readFileSync(file, 'utf8');
    tests += extractTests(source).length;
    for (const p of audit(source)) {
      console.log(`${file}: "${p.test}": ${p.rule}`);
      count += 1;
    }
  }
  if (count) {
    console.log(`test-name audit: ${count} problem(s) in ${tests} tests`);
    process.exit(1);
  }
  console.log(`test-name audit: clean (${tests} tests)`);
}

main();
