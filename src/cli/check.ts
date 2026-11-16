import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isLoadError, parseSource } from '../io/load';
import { fixPrompt, type PromptScope } from '../io/prompt';
import { DEFAULT_SETTINGS } from '../model/defaults';
import type { SourceFile } from '../model/types';
import { addFiles, clearAll, store, updateSettings, type LoadError } from '../state/app';
import { contrastRule } from '../state/pairs';

/**
 * DTsanity's check, offline, for a folder of token files:
 *
 *   node dtsanity-check.mjs [folder] [--summary] [--rules a,b]
 *
 * Prints the report a fresh DTsanity tab gives for those files: the same
 * findings, numbered the same way. With --summary, only the counts by rule;
 * with --rules, only those rules' findings, as a group's findings report has them.
 * Reads the files and writes nothing; nothing is sent anywhere. Legacy formats
 * are accepted, as in the round tests.
 */

const args = process.argv.slice(2);
const summary = args.includes('--summary');
const rulesAt = args.indexOf('--rules');
const rules = rulesAt >= 0 ? (args[rulesAt + 1] ?? '').split(',').filter(Boolean) : [];
const dir = resolve(args.find((a, i) => !a.startsWith('--') && (rulesAt < 0 || i !== rulesAt + 1)) ?? 'files');
const only = new Set(rules);
const scope: PromptScope | undefined = rules.length
  ? {
      issue: (i) => only.has(i.code),
      pair: (r) => only.has(contrastRule(r.pair)) || only.has('cvd-pair'),
      sibling: () => only.has('cvd-siblings'),
      scales: rules.some((r) => r.startsWith('scale-')),
      typography: rules.some((r) => r.startsWith('type-')),
      files: only.has('unreadable-file'),
    }
  : undefined;

const walk = (d: string): string[] =>
  readdirSync(d)
    .sort()
    .flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.json[5c]?$/.test(n) ? [p] : [];
    });

const settings = { ...DEFAULT_SETTINGS, acceptLegacy: true };
const files: SourceFile[] = [];
const unreadable: LoadError[] = [];
for (const p of walk(dir)) {
  const name = relative(dir, p);
  const r = parseSource({ name, text: readFileSync(p, 'utf8'), origin: 'file' }, settings);
  if (isLoadError(r)) unreadable.push(r);
  else files.push(r);
}

clearAll();
updateSettings(settings);
// Files that aren't valid JSON are findings of their own, as in the app.
addFiles(files, unreadable);
const p = fixPrompt(store.get(), scope);
const byRule = [...p.text.matchAll(/^## .+ \[([a-z0-9-]+)\] \((\d+)\)$/gm)].map((m) => `${m[1]} ${m[2]}`);

if (summary) console.log(`${p.count} counted + ${p.more} others\n${byRule.join('\n') || 'nothing found'}`);
else console.log(p.text);
process.exitCode = p.count ? 1 : 0;
