// Where the data pipeline is (owner brief V item 3; ledger P80). The pipeline belongs to
// finance-data and the public site repository does not ship it, so the site's tests and fixture
// builds read it from a finance-data checkout, the one `pages.yml` already makes for the data
// steps (`econ-tools`):
//
//   ECON_TOOLS=<finance-data checkout> npx vitest run
//
// Without ECON_TOOLS, a tree that carries `pipeline/` itself (the development branch) is used.
// Neither: an error that says so, never a silent skip.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The root of the finance-data files: ECON_TOOLS, or the working directory when it has pipeline/. */
export function econToolsRoot(env = process.env, cwd = process.cwd()) {
  if (env.ECON_TOOLS) {
    const root = resolve(cwd, env.ECON_TOOLS);
    if (!existsSync(join(root, 'pipeline'))) throw new Error(`ECON_TOOLS=${env.ECON_TOOLS} has no pipeline/ (it must be a finance-data checkout)`);
    return root;
  }
  if (existsSync(join(cwd, 'pipeline'))) return resolve(cwd);
  throw new Error('the data pipeline is not in this tree: set ECON_TOOLS to a finance-data checkout');
}

/** A path inside the finance-data files, e.g. econToolsPath('pipeline', 'registry', 'econ.json'). */
export function econToolsPath(...parts) {
  return join(econToolsRoot(), ...parts);
}

/** Imports a pipeline module by its path inside finance-data, e.g. 'pipeline/bin/fixture-scenario.mjs'. */
export function importEconTool(rel) {
  return import(pathToFileURL(econToolsPath(rel)).href);
}

/** Whether this tree carries the pipeline itself (its own pipeline checks and mutants then run). */
export function treeHasPipeline(cwd = process.cwd()) {
  return existsSync(join(cwd, 'pipeline'));
}
