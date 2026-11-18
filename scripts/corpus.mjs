// node scripts/corpus.mjs [set …] [--check]
//
// The maturity record: runs the offline check on every sample set, matches each
// finding to its reviewed verdict in corpus/verdicts/<set>.json, and writes
//   corpus/report.md    — the grades, for people
//   corpus/report.json  — the same, for tools
//   corpus/queue/<set>.json — the findings of each set still waiting for a verdict
// With --check, exits 1 when a finding reviewed as right is no longer found
// (a regression), so a change can't quietly lose what DTsanity got right.
//
// The score is about precision: how often a check is right when it speaks.
// Misses are recorded, but don't hold a check back. See corpus/README.md.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyOf } from './corpus-key.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SAMPLES = join(ROOT, 'samples');
const CORPUS = join(ROOT, 'corpus');
const CLI = join(ROOT, 'dist-cli', 'dtsanity-check.mjs');

/** Findings reviewed per check and set: enough to judge, not so many that one big set outweighs the rest. */
const SAMPLE = 20;
/** The grades, from least to most trusted; the first a check meets, from the top, is its grade. */
const GRADES = [
  { grade: 'Stable', systems: 6, precision: 0.95, reviewed: 100, human: 0.3 },
  { grade: 'Beta', systems: 3, precision: 0.8, reviewed: 30, human: 0 },
];

const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.filter((a) => !a.startsWith('--'));
const sets = (only.length ? only : readdirSync(SAMPLES).filter((d) => statSync(join(SAMPLES, d)).isDirectory())).sort();

const run = (set) =>
  new Promise((resolve, reject) => {
    let out = '';
    const p = spawn('node', [CLI, join(SAMPLES, set), '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`${set}: the check gave no JSON`));
      }
    });
  });

if (!existsSync(CLI)) execFileSync('node', [join(ROOT, 'scripts/build-cli.mjs'), CLI], { stdio: 'inherit' });
const results = await Promise.all(sets.map(async (set) => ({ set, ...(await run(set)) })));

const read = (set) => {
  const p = join(CORPUS, 'verdicts', `${set}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { set, verdicts: {}, misses: [] };
};

// Per check: what each set found and how it was reviewed.
const checks = new Map();
const stat = (rule, set) => {
  if (!checks.has(rule)) checks.set(rule, new Map());
  const m = checks.get(rule);
  if (!m.has(set)) m.set(set, { found: 0, reviewed: 0, right: 0, misreading: 0, depends: 0, human: 0, misses: 0 });
  return m.get(set);
};
const regressions = [];
const fixed = [];
const setRows = [];
mkdirSync(join(CORPUS, 'queue'), { recursive: true });

for (const r of results) {
  const record = read(r.set);
  const found = new Map();
  for (const f of r.findings) found.set(keyOf(f.rule, f.line), f);
  // Each check's sample: the first SAMPLE findings by key, so it stays the same run to run.
  const byRule = new Map();
  for (const [key, f] of [...found].sort(([a], [b]) => a.localeCompare(b))) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), [key, f]]);
  const queue = [];
  for (const [rule, xs] of byRule) {
    const s = stat(rule, r.set);
    s.found = xs.length;
    for (const [key, f] of xs) {
      const v = record.verdicts[key];
      if (v) {
        s.reviewed++;
        s[v.verdict]++;
        if (v.by === 'human') s.human++;
      }
    }
    for (const [key, f] of xs.slice(0, SAMPLE)) if (!record.verdicts[key]) queue.push({ key, rule, line: f.line });
  }
  for (const m of record.misses ?? []) stat(m.rule, r.set).misses++;
  // Verdicts whose finding is gone: a misreading fixed, or something right lost.
  for (const [key, v] of Object.entries(record.verdicts)) {
    if (found.has(key)) continue;
    (v.verdict === 'right' ? regressions : fixed).push({ set: r.set, key, verdict: v.verdict });
  }
  writeFileSync(join(CORPUS, 'queue', `${r.set}.json`), JSON.stringify({ set: r.set, build: r.build, waiting: queue }, null, 2) + '\n');
  setRows.push({ set: r.set, findings: found.size, reviewed: Object.keys(record.verdicts).filter((k) => found.has(k)).length, waiting: queue.length });
}

const pct = (x) => (x === undefined ? '–' : `${Math.round(x * 100)}%`);
const grades = [...checks].map(([rule, bySet]) => {
  const rows = [...bySet.values()];
  const decided = [...bySet].filter(([, s]) => s.right + s.misreading > 0);
  // Precision per system, then averaged: each design system counts once, whatever its size.
  const precision = decided.length ? decided.reduce((n, [, s]) => n + s.right / (s.right + s.misreading), 0) / decided.length : undefined;
  const sum = (k) => rows.reduce((n, s) => n + s[k], 0);
  const reviewed = sum('reviewed');
  const g = {
    rule,
    systems: decided.length,
    foundIn: rows.filter((s) => s.found).length,
    found: sum('found'),
    reviewed,
    right: sum('right'),
    misreading: sum('misreading'),
    depends: sum('depends'),
    contested: reviewed ? sum('depends') / reviewed : undefined,
    human: reviewed ? sum('human') / reviewed : undefined,
    misses: sum('misses'),
    precision,
  };
  const met = GRADES.find((x) => g.systems >= x.systems && (precision ?? 0) >= x.precision && reviewed >= x.reviewed && (g.human ?? 0) >= x.human && (x.grade !== 'Stable' || !g.misses));
  g.grade = met ? met.grade : 'Experimental';
  return g;
});
grades.sort((a, b) => b.reviewed - a.reviewed || b.found - a.found || a.rule.localeCompare(b.rule));

// Economy: how many checks DTsanity needs for the systems it covers. It should flatten as systems grow.
const ruleCount = (readFileSync(join(ROOT, 'src/policy/rules.ts'), 'utf8').match(/^\s*rule\('/gm) ?? []).length;
const build = results[0]?.build ?? 'unknown';

const report = { build, systems: sets.length, checks: ruleCount, grades, sets: setRows, regressions, fixed };
writeFileSync(join(CORPUS, 'report.json'), JSON.stringify(report, null, 2) + '\n');

const md = [
  '# DTsanity maturity report',
  '',
  `Generated by \`node scripts/corpus.mjs\` from build ${build}. Don't edit by hand; see [README.md](README.md) for how the score works.`,
  '',
  `**${sets.length} design systems · ${ruleCount} checks · ${grades.reduce((n, g) => n + g.reviewed, 0)} reviewed findings**`,
  '',
  regressions.length ? `## Regressions (${regressions.length})\n\nFindings reviewed as right that the check no longer finds:\n\n${regressions.map((x) => `- ${x.set}: ${x.key}`).join('\n')}\n` : '',
  '## Checks',
  '',
  'Precision is how often a check is right when it speaks, per design system, then averaged. Contested is the share reviewed as “depends”.',
  '',
  '| Check | Grade | Precision | Systems reviewed | Found in | Reviewed (right / misreading / depends) | Contested | Misses |',
  '|---|---|---|---|---|---|---|---|',
  ...grades.map((g) => `| ${g.rule} | ${g.grade} | ${pct(g.precision)} | ${g.systems} | ${g.foundIn} | ${g.reviewed} (${g.right} / ${g.misreading} / ${g.depends}) | ${pct(g.contested)} | ${g.misses} |`),
  '',
  '## Systems',
  '',
  '| System | Findings | Reviewed | Waiting in its sample |',
  '|---|---|---|---|',
  ...setRows.map((s) => `| ${s.set} | ${s.findings} | ${s.reviewed} | ${s.waiting} |`),
  '',
  fixed.length ? `## Gone since reviewed (${fixed.length})\n\nFindings reviewed as misreading or depends that are no longer found:\n\n${fixed.map((x) => `- ${x.set} (${x.verdict}): ${x.key}`).join('\n')}\n` : '',
]
  .filter((l, i, all) => l !== '' || all[i - 1] !== '')
  .join('\n');
writeFileSync(join(CORPUS, 'report.md'), md.trimEnd() + '\n');

console.log(`${sets.length} systems, ${grades.length} checks with findings, ${setRows.reduce((n, s) => n + s.waiting, 0)} findings waiting for a verdict${regressions.length ? `, ${regressions.length} regressions` : ''}.`);
if (check && regressions.length) process.exitCode = 1;
