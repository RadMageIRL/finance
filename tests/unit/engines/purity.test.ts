// The calculation engines stay separate from presentation: no DOM, no storage, no network,
// and no imports from outside src/lib/engines.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve('src/lib/engines');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

describe('engine purity', () => {
  const sources = files(ROOT);

  it('finds the engine sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(8);
  });

  it('uses no browser, storage or network globals', () => {
    const forbidden = /\b(document|window|localStorage|sessionStorage|navigator|fetch|XMLHttpRequest|Date\.now|Math\.random)\b/;
    for (const file of sources) {
      // Code only: drop comments and string contents ("discount window" is not `window`).
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
      expect(forbidden.exec(code)?.[0], relative(ROOT, file)).toBeUndefined();
    }
  });

  it('imports only other engine modules', () => {
    for (const file of sources) {
      for (const match of readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
        const target = resolve(join(file, '..'), match[1]!);
        expect(target.startsWith(ROOT), `${relative(ROOT, file)} imports ${match[1]}`).toBe(true);
      }
    }
  });
});
