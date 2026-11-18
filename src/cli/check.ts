import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isLoadError, parseSource } from '../io/load';
import { fixPrompt, type PromptScope } from '../io/prompt';
import { DEFAULT_SETTINGS } from '../model/defaults';
import type { SourceFile } from '../model/types';
import { addFiles, clearAll, store, updateSettings, type LoadError } from '../state/app';
import { settingsFrom } from '../state/settings';
import { contrastRule } from '../state/pairs';

/**
 * DTsanity's check, offline, for a folder of token files:
 *
 *   node dtsanity-check.mjs [folder] [--summary | --json] [--rules a,b] [--config file]
 *
 * Prints the report a fresh DTsanity tab gives for those files: the same
 * findings, numbered the same way. With --summary, only the counts by rule;
 * with --rules, only those rules' findings, as a group's findings report has them;
 * with --json, each finding as data (rule, the report's line, how many places,
 * whether it is counted), numbered as the report numbers them.
 *
 * Settings come from a configuration file: --config, or dtsanity.config.json
 * in the folder (the same settings the page keeps: contrast target, the
 * color-vision distance, legacy formats, and each check's level). See
 * docs/how-dtsanity-reads.md.
 * Reads the files and writes nothing; nothing is sent anywhere. Legacy formats
 * are accepted, as in the round tests.
 */

const args = process.argv.slice(2);
const summary = args.includes('--summary');
const json = args.includes('--json');
const rulesAt = args.indexOf('--rules');
const configAt = args.indexOf('--config');
const rules = rulesAt >= 0 ? (args[rulesAt + 1] ?? '').split(',').filter(Boolean) : [];
const valueAt = new Set([rulesAt + 1, configAt + 1].filter((i) => i > 0));
const dir = resolve(args.find((a, i) => !a.startsWith('--') && !valueAt.has(i)) ?? 'files');
/** The configuration file: named with --config, or dtsanity.config.json in the folder. */
const CONFIG = 'dtsanity.config.json';
const configPath = configAt >= 0 ? resolve(args[configAt + 1] ?? CONFIG) : existsSync(join(dir, CONFIG)) ? join(dir, CONFIG) : undefined;
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
      return statSync(p).isDirectory() ? walk(p) : /\.json[5c]?$/.test(n) && n !== CONFIG ? [p] : [];
    });

// Legacy formats are accepted unless the configuration says otherwise.
const settings = settingsFrom({ ...DEFAULT_SETTINGS, acceptLegacy: true, ...(configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : {}) });
const files: SourceFile[] = [];
const unreadable: LoadError[] = [];
for (const p of walk(dir)) {
  const name = relative(dir, p);
  const r = parseSource({ name, text: readFileSync(p, 'utf8'), origin: 'file' }, settings);
  // A file with no design tokens in it is set aside, as on the page: not a finding.
  if (isLoadError(r)) {
    if (!r.skipped) unreadable.push(r);
  }
  else files.push(r);
}

clearAll();
updateSettings(settings);
// Files that aren't valid JSON are findings of their own, as in the app.
addFiles(files, unreadable);
const p = fixPrompt(store.get(), scope);
const byRule = [...p.text.matchAll(/^## .+ \[([a-z0-9-]+)\] \((\d+)\)$/gm)].map((m) => `${m[1]} ${m[2]}`);

if (json) console.log(JSON.stringify({ build: __VERSION__, count: p.count, more: p.more, findings: p.entries.map((e, i) => ({ no: i + 1, ...e })) }, null, 2));
else if (summary) console.log(`${p.count} counted + ${p.more} others\n${byRule.join('\n') || 'nothing found'}`);
else console.log(p.text);
process.exitCode = p.count ? 1 : 0;
