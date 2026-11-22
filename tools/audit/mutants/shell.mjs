// Mutants of the shared dashboard shell (brief Q, agent 4), run by tools/audit/mutate.mjs with the
// rest: the chart rules (src/lib/data/line-chart.ts C2 to C10), the status rules
// (src/lib/data/status.ts S1 to S5), the text rules (src/lib/data/shell-text.ts T1 to T7) and the
// economic data rules of dist-check (src/lib/data/shell-dist.ts D1 to D4). Each `find` occurs
// exactly once in its file; the unit tests under tests/unit/data/shell/ must fail for every one.
const C = 'src/lib/data/line-chart.ts';
const S = 'src/lib/data/status.ts';
const T = 'src/lib/data/shell-text.ts';
const D = 'src/lib/data/shell-dist.ts';

export const MUTANTS = [
  // Chart: screen resolution and reading (C5, C6).
  ['data-shell-chart-draw-columns', C, 'export const DRAW_COLUMNS = 500;', 'export const DRAW_COLUMNS = 1000;'],
  ['data-shell-chart-read-columns', C, 'export const READ_COLUMNS = 125;', 'export const READ_COLUMNS = 250;'],
  ['data-shell-chart-min-tie-latest', C, 'if (compareDecimal(p.y as string, cur.min.y as string) < 0) cur.min = p;', 'if (compareDecimal(p.y as string, cur.min.y as string) <= 0) cur.min = p;'],
  ['data-shell-chart-keep-small-columns', C, 'if (all.length <= 2) kept.push(...all);', 'if (all.length <= 1) kept.push(...all);'],
  ['data-shell-chart-gap-bridged', C, '    if (p.y === null) flush();\n    else run.push(p);', '    if (p.y !== null) run.push(p);'],
  ['data-shell-chart-run-ends-dropped', C, 'const ends = [points[0], points[points.length - 1]]', 'const ends = [points[0]]'],
  // Chart: the value axis (C2, C3).
  ['data-shell-chart-axis-without-zero', C, '  let lo = 0n;\n  let hi = 0n;', '  let lo = values.length ? toUnits(values[0] as string, scale) : 0n;\n  let hi = lo;'],
  ['data-shell-chart-axis-four-steps', C, 'span <= 5n * s', 'span <= 4n * s'],
  ['data-shell-chart-axis-no-quarter-step', C, '...(p >= 10n ? [(25n * p) / 10n] : [])', '...[]'],
  ['data-shell-chart-trillions-shift', C, "[shift, title] = [12, 'Trillions of U.S. dollars']", "[shift, title] = [9, 'Trillions of U.S. dollars']"],
  // Chart: period labels, steps and reading (C4, C6, C7, C8, C10).
  ['data-shell-chart-wide-labels', C, 'export const WIDE_LABELS = 8;', 'export const WIDE_LABELS = 10;'],
  ['data-shell-chart-step-to-edge', C, 'const x1 = x(pts[i + 1]?.at ?? last);', 'const x1 = x(pts[i + 1]?.at ?? p.at);'],
  ['data-shell-chart-in-effect-strict', C, '    if (p.at <= at) found = p;', '    if (p.at < at) found = p;'],
  ['data-shell-chart-null-as-zero', C, "v === null ? 'Not available' : valueText(v, d.unitLabel)", "v === null ? valueText('0', d.unitLabel) : valueText(v, d.unitLabel)"],
  ['data-shell-chart-describe-max-tie', C, '    if (compareDecimal(p.y, max.y) > 0) max = p;', '    if (compareDecimal(p.y, max.y) >= 0) max = p;'],
  ['data-shell-chart-annotation-range', C, 'inRange: at >= first && at <= last', 'inRange: at > first && at <= last'],
  // Status at view time and the newer-data check (S1, S3, S5).
  ['data-shell-status-stale-boundary', S, 'now >= s.stale_at', 'now > s.stale_at'],
  ['data-shell-status-due-boundary', S, 'now > s.deadline', 'now >= s.deadline'],
  ['data-shell-status-frozen-unknown', S, "if (s.status === 'held' || s.status === 'frozen' ||", "if (s.status === 'held' ||"],
  ['data-shell-status-due-labeled-fresh', S, "  due: 'Update pending',", "  due: 'Up to date',"],
  ['data-shell-status-rollback-wording', S, "reason.startsWith('rolled back')", "reason.startsWith('rejected')"],
  ['data-shell-refresh-older-is-newer', S, "return id > buildSnapshot ? 'newer' : 'changed';", "return 'newer';"],
  ['data-shell-refresh-any-status', S, "if (status !== 200 || !body ||", 'if (!body ||'],
  // Text rules (T1, T4, T6).
  ['data-shell-text-seconds-always', T, "${m[4] === '00' ? '' : `:${m[4]}`}", ':${m[4]}'],
  ['data-shell-text-first-seen-as-release', T, 'return `First seen by RadMage Finance on ${formatDay(date)} (Eastern Time date)`;', 'return `Released on ${formatDay(date)}`;'],
  ['data-shell-text-first-seen-unlabeled', T, 'return `First seen by RadMage Finance on ${formatDay(date)} (Eastern Time date)`;', 'return `First seen by RadMage Finance on ${formatDay(date)}`;'],
  ['data-shell-text-negative-dollars', T, "if (unitLabel === 'U.S. dollars') return `${neg ? '-' : ''}$${groupDigits(abs)}`;", "if (unitLabel === 'U.S. dollars') return `$${groupDigits(abs)}`;"],
  // dist-check rules (D1 to D4).
  ['data-shell-dist-data-pages-chrome-budget', D, '|| /^\\/finance\\/data\\/([a-z0-9-]+\\/)?$/.test(page) ||', '||'],
  ['data-shell-dist-verified-any-link', D, 'if (verified) return verified.has(rest) ? null :', 'if (verified) return true ? null :'],
  ['data-shell-dist-no-dataset-allowed', D, 'return `links to the data file ${rest}, but this build has no dataset`;', 'return null;'],
  ['data-shell-dist-query-allowed', D, "if (search || rest === '' ||", "if (rest === '' ||"],
  ['data-shell-dist-tree-without-list', D, "return present === null ? [] : ['dist/data/econ/ is present without a verified list (ECON_VERIFIED)'];", 'return [];'],
  ['data-shell-dist-tree-extra-file', D, 'for (const p of have) if (!want.has(p)) problems.push(', 'for (const p of have) if (false) problems.push('],
  ['data-shell-dist-tree-hash', D, 'else if (hashOf(v.path) !== v.sha256)', 'else if (false)'],
  ['data-shell-dist-fixture-indexed', D, "return env.ECON_SOURCE === 'release' && Boolean(env.ECON_DIR);", 'return Boolean(env.ECON_DIR);'],
];
