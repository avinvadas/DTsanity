// npm run audit -- <out.json>
// Counts every sample set's findings by rule, with examples, as the Issues page does. Runs on this machine only.
import { spawnSync } from 'node:child_process';

const [out] = process.argv.slice(2);
if (!out) {
  console.error('Usage: npm run audit -- <out.json>');
  process.exit(1);
}
const r = spawnSync('npx', ['vitest', 'run', 'tests/audit.test.ts', '--silent=false', '--reporter=dot'], { env: { ...process.env, AUDIT_OUT: out }, stdio: 'inherit' });
process.exit(r.status ?? 1);
