// SHA-256 of every file in dist/, sorted by path, plus one hash over the whole list.
// Used to show that a release build is reproducible and to publish its checksums:
//   node tools/dist-manifest.mjs > SHA256SUMS.txt
// Two builds from the same commit in the same calendar month give the same output (the loan
// calculators' default first payment is the month after the build).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = new URL('../dist/', import.meta.url);
const root = DIST.pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const lines = walk(root)
  .map((file) => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${relative(root, file).split('\\').join('/')}`)
  .sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
const body = lines.join('\n') + '\n';
process.stdout.write(body);
process.stderr.write(`${lines.length} files, manifest sha256 ${createHash('sha256').update(body).digest('hex')}\n`);
