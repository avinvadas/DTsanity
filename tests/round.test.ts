import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { fixPrompt, type PromptScope } from '../src/io/prompt';
import { addFiles, clearAll, store, updateSettings } from '../src/state/app';
import { contrastRule } from '../src/state/pairs';
import { parse, SAMPLES, SETTINGS } from './oracle/samples';

/**
 * One test round of the findings report (docs/fix-prompt-iterations.md, steps 4 and 5), run only
 * when asked:
 *
 *   npm run round -- <set or folder> <out folder> [--brain] [--rules a,b]
 *
 * writes what the assistant is given: files/ (a copy of the set), prompt.md, BRIEF.md, check.mjs
 * (the offline check, built by scripts/round.mjs) and,
 * with --brain, reference-system.md, the stand-in for a design system's own rules. Without an
 * out folder it is the fresh check: the findings of the folder by rule, from the prompt built
 * from its files alone, as a fresh DTsanity tab builds it.
 */

const SRC = process.env.ROUND_SRC;
const OUT = process.env.ROUND_OUT;
const BRAIN = !!process.env.ROUND_BRAIN;
const RULES = (process.env.ROUND_RULES ?? '').split(',').filter(Boolean);
const ROOT = fileURLToPath(new URL('../', import.meta.url));

const walk = (d: string): string[] =>
  readdirSync(d)
    .sort()
    .flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.json[5c]?$/.test(n) ? [p] : [];
    });

/** The brief: what a person would say when handing the prompt over, and nothing about DTsanity's own idea of the fix. */
const brief = (brain: boolean, rules: string[]) =>
  [
    '# Brief',
    '',
    'The design token files of our design system are in `files/`. `prompt.md` reports what a checker found in them.',
    brain ? '`reference-system.md` holds our design system’s rules for changing tokens: follow them.' : '',
    `\`check.mjs\` is the checker that wrote the report. \`node check.mjs${rules.length ? ` --rules ${rules.join(',')}` : ''}\` checks \`files/\` again and prints a fresh report (add \`--summary\` for counts by rule). It only reads the files.`,
    '',
    'Work through the report. Change the files in place, under `files/`, keeping their paths and names. Write your report, as `prompt.md` asks for it, to `report.md`.',
    '',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');

(SRC ? describe : describe.skip)('round', () => {
  it(
    OUT ? 'writes a round' : 'checks a folder afresh',
    () => {
      const dir = existsSync(join(SAMPLES, SRC!)) ? join(SAMPLES, SRC!) : resolve(SRC!);
      const paths = walk(dir);
      clearAll();
      updateSettings(SETTINGS);
      addFiles(parse(paths.map((p) => ({ name: relative(dir, p), text: readFileSync(p, 'utf8') }))));
      const only = new Set(RULES);
      const scope: PromptScope | undefined = RULES.length
        ? { issue: (i) => only.has(i.code), pair: (r) => only.has(contrastRule(r.pair)) || only.has('cvd-pair'), sibling: () => only.has('cvd-siblings'), scales: [...only].some((r) => r.startsWith('scale-')), typography: [...only].some((r) => r.startsWith('type-')), files: only.has('unreadable-file') }
        : undefined;
      const p = fixPrompt(store.get(), scope);
      const byRule = [...p.text.matchAll(/^## .+ \[([a-z0-9-]+)\] \((\d+)\)$/gm)].map((m) => `${m[1]} ${m[2]}`);
      console.log(`\n${SRC}: ${p.count} counted + ${p.more} others, ${p.text.length} characters (~${Math.round(p.text.length / 4)} tokens)\n${byRule.join('\n') || 'nothing found'}`);
      if (!OUT) return;
      const out = resolve(OUT);
      for (const from of paths) {
        const to = join(out, 'files', relative(dir, from));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
      writeFileSync(join(out, 'prompt.md'), p.text);
      writeFileSync(join(out, 'BRIEF.md'), brief(BRAIN, RULES));
      if (BRAIN) copyFileSync(join(ROOT, 'docs/reference-system.md'), join(out, 'reference-system.md'));
      const cli = join(ROOT, 'dist-cli/dtsanity-check.mjs');
      if (existsSync(cli)) copyFileSync(cli, join(out, 'check.mjs'));
      writeFileSync(join(out, 'round.json'), `${JSON.stringify({ source: SRC, brain: BRAIN, rules: RULES, count: p.count, more: p.more, characters: p.text.length, byRule }, null, 2)}\n`);
      console.log(`Round written to ${out}`);
    },
    300_000,
  );
});
