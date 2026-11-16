// npm run round -- <set or folder> [<out folder>] [--brain] [--rules a,b]
//
// With an out folder: writes what one test round of the fix prompt gives an assistant (the
// files, the prompt, a short brief, check.mjs (the offline check) and, with --brain,
// docs/reference-system.md). --rules keeps
// only those rules' findings, as a group's prompt does.
// Without one: a fresh check of the folder, listing the findings by rule.
// Runs on this machine only; nothing is sent anywhere.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a === '--brain'));
const rulesAt = args.indexOf('--rules');
const rules = rulesAt >= 0 ? args[rulesAt + 1] : '';
const [src, out] = args.filter((a, i) => !a.startsWith('--') && (rulesAt < 0 || i !== rulesAt + 1));
if (!src) {
  console.error('Usage: npm run round -- <set or folder> [<out folder>] [--brain] [--rules a,b]');
  process.exit(1);
}
// A round folder gets the offline check too, so the assistant can run it on its own work.
if (out) {
  const b = spawnSync('node', ['scripts/build-cli.mjs', 'dist-cli/dtsanity-check.mjs'], { stdio: 'inherit' });
  if (b.status) process.exit(b.status);
}
const env = { ...process.env, ROUND_SRC: src, ROUND_OUT: out ?? '', ROUND_BRAIN: flags.has('--brain') ? '1' : '', ROUND_RULES: rules ?? '' };
const r = spawnSync('npx', ['vitest', 'run', 'tests/round.test.ts', '--silent=false', '--reporter=dot'], { env, stdio: 'inherit' });
process.exit(r.status ?? 1);
