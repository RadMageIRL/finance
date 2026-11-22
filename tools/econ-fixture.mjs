#!/usr/bin/env node
// Writes the appendix B fixture scenario (DATA_CONVENTIONS v0.8 appendix B) to local/econ-fixture/
// and checks its tree hash against pipeline/fixtures/scenario-tree.sha256 (the pipeline from
// finance-data, ECON_TOOLS, or this tree: tools/econ-tools.mjs), so dashboards are
// developed and tested on the verified fixture root only. The econ root is local/econ-fixture/live:
//
//   node tools/econ-fixture.mjs
//   ECON_DIR=local/econ-fixture/live npm run build
//
// The fixture root is test data (synthetic after its saved dates), never a publication.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { econToolsPath, importEconTool } from './econ-tools.mjs';

const { runScenario } = await importEconTool('pipeline/bin/fixture-scenario.mjs');

// The tree hash of tools/datacheck.mjs: every path and its bytes, in name order.
const NUL = String.fromCharCode(0);
const treeHash = (dir) => {
  const h = createHash('sha256');
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), r);
      else h.update(r).update(NUL).update(readFileSync(join(d, e.name))).update(NUL);
    }
  };
  walk(dir, '');
  return h.digest('hex');
};

const out = resolve('local', 'econ-fixture');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await runScenario(out);
const want = readFileSync(econToolsPath('pipeline', 'fixtures', 'scenario-tree.sha256'), 'utf8').trim().split(/\s+/)[0];
const got = treeHash(out);
if (got !== want) {
  console.error(`econ fixture: tree hash ${got} differs from the committed ${want}`);
  process.exit(1);
}
console.log(`econ fixture: ${join(out, 'live')} (tree hash ${got}, appendix B, test data)`);
