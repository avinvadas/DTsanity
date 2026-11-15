import { describe, expect, it } from 'vitest';
import { getIn, parseJson } from '../src/json/cst';
import { fixPrompt, issuesScope, pairsScope, type PromptScope } from '../src/io/prompt';
import type { Issue } from '../src/model/types';
import { addFiles, allModels, clearAll, store, updateSettings } from '../src/state/app';
import { findings, findingTotal } from '../src/ui/findings';
import { issuesOf, parse, SETS, SETTINGS, setTexts } from './oracle/samples';

/**
 * The fix prompt on every sample set (part B of the output test plan).
 *
 * B1. Coverage: every finding is in the full prompt once; each group's
 *     button (as the views build them) copies exactly that group, the
 *     groups don't overlap, and together they make the whole "Copy fix
 *     prompt" one.
 * B2. Accuracy: every correction names a loaded file, a line that holds the
 *     key it is about, and a token or group that exists.
 * B3. The same files give the same prompt; set SAMPLES_REPORT=1 to print
 *     each prompt's size.
 */

const T = 120_000;

/** The corrections a prompt lists: its "- " lines under a "## " heading, past the rules. */
function items(text: string): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) inSection = true;
    else if (line.startsWith('# ')) inSection = false;
    else if (inSection && line.startsWith('- ')) out.push(line);
  }
  return out;
}

/** How many findings a line stands for: one, or the places a grouped line names. */
const weight = (line: string) => Number(/ In (\d+) places: /.exec(line)?.[1] ?? 1);
const findingsIn = (lines: string[]) => lines.reduce((n, l) => n + weight(l), 0);

const isTier = (i: Issue) => i.code.startsWith('tier-');

/** Every group that has a fix prompt button, scoped as its view scopes it. */
function groups(): { name: string; scope: PromptScope; size: number }[] {
  const s = store.get();
  const all = issuesOf(s);
  const f = findings(s);
  const out: { name: string; scope: PromptScope; size: number }[] = [];
  // Issues page: each Format category, Tiers and Info, the cluster of issues with no one-click fix.
  const clusters = new Map<string, Issue[]>();
  for (const i of all) {
    if (i.fix) continue;
    const key = i.severity === 'info' ? 'Info' : isTier(i) ? 'Tiers' : `Format · ${i.category}`;
    clusters.set(key, [...(clusters.get(key) ?? []), i]);
  }
  for (const [name, issues] of clusters) out.push({ name, scope: issuesScope(issues), size: issues.length });
  // A pair or status group counts once, however many themes it fails in, as on the page.
  if (f.contrast.length) out.push({ name: 'Contrast', scope: pairsScope(f.contrast), size: f.contrast.length });
  if (f.vision.length + f.groups.length) out.push({ name: 'Color blindness', scope: pairsScope(f.vision, f.groups), size: f.vision.length + f.groups.length });
  out.push({ name: 'Typography', scope: { typography: true }, size: -1 }, { name: 'Scales', scope: { scales: true }, size: -1 }, { name: 'Files', scope: { files: true }, size: -1 });
  return out;
}

describe.each(SETS)('fix prompt: %s', (set) => {
  it(
    'lists every finding once, in the right group, at the right place',
    () => {
      clearAll();
      updateSettings(SETTINGS);
      const texts = setTexts(set);
      addFiles(parse(texts));
      const s = store.get();
      const full = fixPrompt(s);
      const listed = items(full.text);
      const inFull = new Set(listed);
      expect(findingsIn(listed), 'the counts add up to the findings listed').toBe(full.count + full.more);
      // The button says what the page says: "Copied 591 corrections" under "591 issues found".
      expect(full.count, 'counted as the Issues page counts').toBe(findingTotal(findings(s)));

      // B1: every issue once, by its rule.
      const all = issuesOf(s);
      const byCode = new Map<string, number>();
      for (const i of all) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);
      const perCode = new Map<string, number>();
      for (const l of listed) {
        const code = /\[([a-z0-9-]+)\]/.exec(l)?.[1];
        if (code) perCode.set(code, (perCode.get(code) ?? 0) + weight(l));
      }
      const wrong = [...byCode].filter(([code, n]) => (perCode.get(code) ?? 0) !== n);
      expect(wrong.map(([c, n]) => `${c}: ${n} found, ${perCode.get(c) ?? 0} listed`), 'each issue listed once').toEqual([]);

      // B1: each group's button copies only its group; together they make the whole prompt, less what has a one-click fix.
      const owner = new Map<string, string>();
      const overlaps: string[] = [];
      let total = 0;
      for (const g of groups()) {
        const p = fixPrompt(s, g.scope);
        const mine = items(p.text);
        expect(findingsIn(mine), `${g.name}: count`).toBe(p.count + p.more);
        if (g.size >= 0) expect(p.count + p.more, `${g.name}: one per finding, as the page counts`).toBe(g.size);
        for (const line of mine) {
          if (owner.has(line)) overlaps.push(`${line.slice(0, 100)} (in ${owner.get(line)} and ${g.name})`);
          owner.set(line, g.name);
          if (!inFull.has(line)) expect.fail(`${g.name}: ${line.slice(0, 80)} is not in the full prompt`);
        }
        total += p.count + p.more;
      }
      expect(overlaps.slice(0, 5), 'no correction is in two groups').toEqual([]);
      const fixable = all.filter((i) => i.fix).length;
      expect(total, 'the groups add up to the full prompt, less one-click fixes').toBe(full.count + full.more - fixable);

      // B2: each issue's place: a loaded file, a line that holds the key, a token or group that exists.
      const files = new Map(s.files.map((f) => [f.id, f]));
      const models = allModels(s);
      const docs = new Map<string, ReturnType<typeof parseJson>['doc']>();
      const docOf = (f: (typeof s.files)[number]) => {
        if (!docs.has(f.id)) docs.set(f.id, parseJson(f.text.replace(/^\ufeff/, ''), { json5: f.syntax === 'json5' }).doc);
        return docs.get(f.id)!;
      };
      const textLines = new Map<string, string[]>();
      const misplaced: string[] = [];
      const unknown: string[] = [];
      for (const i of all) {
        const f = i.fileId ? files.get(i.fileId) : undefined;
        if (i.fileId) expect(f, `${i.code}: its file is loaded`).toBeDefined();
        if (!f || f.converted) continue;
        const key = (i.keyPath?.at(-1) ?? i.target?.split('.').at(-1)) as string | number | undefined;
        if (i.pos && typeof key === 'string') {
          if (!textLines.has(f.id)) textLines.set(f.id, f.text.replace(/^﻿/, '').split('\n'));
          const line = textLines.get(f.id)![i.pos.line - 1] ?? '';
          if (!line.includes(key)) misplaced.push(`${f.name}:${i.pos.line} ${i.code} "${key}": ${line.trim().slice(0, 60)}`);
        }
        if (i.keyPath) {
          if (!getIn(docOf(f).root, i.keyPath)) unknown.push(`${f.name} ${i.code} ${i.keyPath.join('.')}`);
        } else if (i.target && !models.some((m) => m.tokens.has(i.target!))) {
          if (!i.target.split('.').every((k) => k)) unknown.push(`${f.name} ${i.code} ${i.target}`);
        }
      }
      expect(misplaced.slice(0, 8), 'each line number points at its key').toEqual([]);
      expect(unknown.slice(0, 8), 'each key path is in its file').toEqual([]);

      // B3: the same files, loaded again, give the same prompt.
      expect(fixPrompt(store.get()).text === full.text, 'built twice, the same').toBe(true);
      clearAll();
      updateSettings(SETTINGS);
      addFiles(parse(texts));
      expect(fixPrompt(store.get()).text === full.text, 'loaded again, the same').toBe(true);

      if (process.env.SAMPLES_REPORT) {
        const chars = full.text.length;
        console.log(`\n${set}: fix prompt ${full.count} corrections + ${full.more} others on ${listed.length} lines, ${chars} characters (~${Math.round(chars / 4)} tokens)`);
      }
    },
    T,
  );
});
