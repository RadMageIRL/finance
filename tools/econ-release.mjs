#!/usr/bin/env node
// The release build rehearsed locally (owner brief V item 2; ledger P79). Nothing leaves the
// machine and nothing is published.
//
//   node tools/econ-release.mjs          make the release and place it outside dist/
//   node tools/econ-release.mjs place    after the build, copy the placed tree to dist/data/econ
//
// The first form runs the publication scenario of DATA_CONVENTIONS v0.8 appendix J (fixtures only)
// into local/econ-release/scenario: it makes immutable releases in a local release store. It takes
// the last release the scenario both released and deployed, and runs on its four assets the code
// that `pages.yml` runs after downloading them:
// - placeRelease of pipeline/bin/site-data.mjs: the release check of 22.8, the tree written to
//   local/econ-release/econ and the verified file list to local/econ-release/verified.json;
// - the independent checker on the assets (tests/datacheck/check_p22.py --release --expect).
// The full check then builds from that tree as production does (DATA_PAGES=on, ECON_DIR,
// ECON_SOURCE=release, ECON_VERIFIED), copies it to dist/data/econ with the second form, and runs
// the built-output checks and the browser tests on the result. The release is test data from
// the fixtures, never a publication.
//
// The pipeline and the checker come from finance-data (ECON_TOOLS) or this tree (tools/econ-tools.mjs).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { econToolsPath, importEconTool } from './econ-tools.mjs';

const ROOT = resolve('local', 'econ-release');
const SCENARIO = join(ROOT, 'scenario');
const TREE = join(ROOT, 'econ');
const VERIFIED = join(ROOT, 'verified.json');
const DIST = resolve('dist', 'data', 'econ');

if (process.argv[2] === 'place') {
  if (!existsSync(join(TREE, 'manifest.json')) || !existsSync(VERIFIED)) {
    console.error('econ release: nothing placed yet; run node tools/econ-release.mjs first');
    process.exit(1);
  }
  if (!existsSync(resolve('dist', 'index.html'))) {
    console.error('econ release: dist/ has no build; build first');
    process.exit(1);
  }
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, '..'), { recursive: true });
  cpSync(TREE, DIST, { recursive: true });
  console.log(`econ release: ${TREE} copied to ${DIST}`);
  process.exit(0);
}

const { runPublishScenario } = await importEconTool('pipeline/bin/publish-scenario.mjs');
const { placeRelease } = await importEconTool('pipeline/bin/site-data.mjs');

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });
const { steps } = await runPublishScenario(SCENARIO);
const step = steps.filter((s) => s.outcome === 'released-deployed' && s.release && s.deployed).at(-1);
if (!step) {
  console.error('econ release: the publication scenario released and deployed nothing');
  process.exit(1);
}
const { snapshot, manifest_sha256 } = step.deployed;
const assets = join(SCENARIO, 'releases', step.release);
const list = placeRelease({ assetsDir: assets, snapshot, manifest_sha256, out: TREE, verifiedFile: VERIFIED });
const written = JSON.parse(readFileSync(VERIFIED, 'utf8'));
if (written.length !== list.length || list.length === 0) {
  console.error('econ release: the verified file list does not match the placed tree');
  process.exit(1);
}

let checked = null;
for (const python of ['python', 'python3']) {
  checked = spawnSync(python, ['-I', econToolsPath('tests', 'datacheck', 'check_p22.py'), '--release', assets, '--expect', `${snapshot}:${manifest_sha256}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!checked.error) break;
}
process.stdout.write(`${checked.stdout ?? ''}${checked.stderr ?? ''}`);
if (checked.error || checked.status !== 0) {
  console.error(`econ release: the independent checker refused ${step.release} (${checked.error ? checked.error.message : `exit ${checked.status}`})`);
  process.exit(1);
}
console.log(`econ release: ${step.release} (step ${step.step}, snapshot ${snapshot}) placed at ${TREE}, ${list.length} verified files; test data from the fixtures, never a publication`);
