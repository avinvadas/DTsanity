// npm run compare -- <before folder> <after folder> [report.md]
// Loads both folders as DTsanity does and reports what changed, finding by finding and value by value.
// Runs on this machine only. Set COMPARE_SETTINGS to the app's saved settings JSON to count as the app does.
import { spawnSync } from 'node:child_process';

const [before, after, out] = process.argv.slice(2);
if (!before || !after) {
  console.error('Usage: npm run compare -- <before folder> <after folder> [report.md]');
  process.exit(1);
}
const env = { ...process.env, COMPARE_BEFORE: before, COMPARE_AFTER: after, ...(out ? { COMPARE_OUT: out } : {}) };
const r = spawnSync('npx', ['vitest', 'run', 'tests/compare.test.ts', '--silent=false', '--reporter=dot'], { env, stdio: 'inherit' });
process.exit(r.status ?? 1);
