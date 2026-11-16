// npm run build:cli [-- <out file>]
//
// Bundles DTsanity's offline check (src/cli/check.ts) into one file that runs with Node 18+ and
// no dependencies: node dist-cli/dtsanity-check.mjs <folder> [--summary]. It reads token files
// and prints the report a fresh DTsanity tab gives; nothing is sent anywhere.
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

const git = (cmd) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};
const commit = git('git rev-parse --short HEAD') || 'unknown';
const dirty = git('git status --porcelain --untracked-files=no -- src') ? '+changes' : '';
const out = process.argv[2] ?? 'dist-cli/dtsanity-check.mjs';

await build({
  entryPoints: ['src/cli/check.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: out,
  define: { __VERSION__: JSON.stringify(`${commit}${dirty} (offline check)`) },
  banner: { js: '// DTsanity offline check. Reads token files and prints a report; sends nothing anywhere.' },
  logLevel: 'warning',
});
console.log(`Built ${out}`);
