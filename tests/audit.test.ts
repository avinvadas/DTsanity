import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { isLoadError, parseSource } from '../src/io/load';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import type { Issue, SourceFile } from '../src/model/types';
import { addFiles, clearAll, store, updateSettings } from '../src/state/app';
import { findings, findingTotal } from '../src/ui/findings';
import type { PairRow } from '../src/state/pairs';

/**
 * The counted findings of every sample set, by rule, with examples: the
 * instrument for auditing whether a rule reads valid sets wrongly. Runs only
 * when asked, and writes JSON to AUDIT_OUT:
 *
 *   npm run audit -- <out.json>
 *
 * Counts as the Issues page does, with legacy formats accepted.
 */

const OUT = process.env.AUDIT_OUT;
const ROOT = fileURLToPath(new URL('../samples/', import.meta.url));

const walk = (d: string): string[] =>
  readdirSync(d)
    .sort()
    .flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.json[5c]?$/.test(n) ? [p] : [];
    });

interface RuleCount {
  n: number;
  /** Every finding of the rule, as a line. */
  examples: string[];
}

(OUT ? describe : describe.skip)('audit', () => {
  it('counts every sample by rule', () => {
    updateSettings({ ...DEFAULT_SETTINGS, acceptLegacy: true });
    const sets = readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory()).sort();
    const out: Record<string, { total: number; themes: string[]; rules: Record<string, RuleCount> }> = {};
    for (const set of sets) {
      const dir = join(ROOT, set);
      const files = walk(dir).map((p) => {
        const r = parseSource({ name: relative(dir, p), text: readFileSync(p, 'utf8'), origin: 'file' }, store.get().settings);
        if (isLoadError(r)) throw new Error(`${set}/${relative(dir, p)}: ${r.message}`);
        return r as SourceFile;
      });
      clearAll();
      addFiles(files);
      const s = store.get();
      const f = findings(s);
      const names = new Map(s.files.map((x) => [x.id, x.name]));
      const rules: Record<string, RuleCount> = {};
      const add = (rule: string, example: string) => {
        const r = (rules[rule] ??= { n: 0, examples: [] });
        r.n++;
        r.examples.push(example);
      };
      const at = (i: Issue) => `${names.get(i.fileId ?? '') ?? ''} › ${i.target ?? ''}${i.themes?.length ? ` [${i.themes.join(',')}]` : ''}: ${i.message}`;
      for (const i of [...f.format, ...f.tiers]) add(i.code, at(i));
      const theme = (k: number) => s.themes[k]?.name ?? 'all';
      const checks = (r: PairRow) =>
        r.seen.normal
          .map((c, k) => (c && !c.pass ? `${theme(k)} ${c.results.filter((x) => !x.pass).map((x) => `${x.level.id ?? x.level}: ${x.value.toFixed(2)}`).join('/')}` : ''))
          .filter(Boolean)
          .join('; ');
      for (const r of f.contrast) add(`contrast (${r.pair.kind}, ${r.pair.source})`, `${r.pair.fg} on ${r.pair.bg}: ${checks(r)}`);
      for (const r of f.vision) add(`vision (${r.pair.kind}, ${r.pair.source})`, `${r.pair.fg} on ${r.pair.bg}: ${r.cvdFails.join(',')}`);
      for (const g of f.groups) add('status-group', `${g.group.id}: ${g.group.members.join(', ')}`);
      out[set] = { total: findingTotal(f), themes: s.themes.map((t) => t.name), rules };
    }
    writeFileSync(OUT!, JSON.stringify(out, null, 2));
    for (const [set, o] of Object.entries(out))
      console.log(`${set}: ${o.total} [${o.themes.join(', ')}] ${Object.entries(o.rules).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k}×${v.n}`).join(', ')}`);
  }, 600_000);
});
