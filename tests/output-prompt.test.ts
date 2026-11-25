import { describe, expect, it } from 'vitest';
import { getIn, parseJson } from '../src/json/cst';
import { fixPrompt, issuesScope, pairsScope, type PromptScope } from '../src/io/prompt';
import type { Issue } from '../src/model/types';
import { addFiles, allModels, clearAll, store, updateSettings } from '../src/state/app';
import { findings, findingTotal } from '../src/ui/findings';
import { issuesOf, parse, SETS, SETTINGS, setTexts } from './oracle/samples';
import { BASIS } from '../src/policy/basis';
import { CRITERIA } from '../src/policy/criteria';
import { PRESCRIBES } from './prompt-words';

/**
 * The findings report on every sample set (part B of the output test plan).
 *
 * B1. Coverage: every finding is in the full prompt once; each group's
 *     button (as the views build them) copies exactly that group, the
 *     groups don't overlap, and together they make the whole "Copy fix
 *     prompt" one.
 * B2. Accuracy: every correction names a loaded file, a line that holds the
 *     key it is about, and a token or group that exists.
 * B4. Lint: every rule's section has its basis, problem, check and (for advice) a way to
 *     decline; findings are numbered 1, 2… in order; nothing steers the fix.
 * B3. The same files give the same prompt; set SAMPLES_REPORT=1 to print
 *     each prompt's size.
 */

const T = 120_000;

/**
 * The findings a prompt lists: its "- #n " lines under a rule's "## … [rule] (n)" heading, as
 * "[rule] line". The number is left out: it counts from 1 in every prompt, so a group's
 * prompt numbers its findings differently from the full one.
 */
function items(text: string): string[] {
  const out: string[] = [];
  let rule: string | undefined;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) rule = /\[([a-z0-9-]+)\] \(\d+\)$/.exec(line)?.[1];
    else if (line.startsWith('# ')) rule = undefined;
    // The number, and the places file's pointer to it, count from 1 in every prompt: left out.
    else if (rule && line.startsWith('- #')) out.push(`[${rule}] ${line.replace(/^- #\d+ /, '').replace(/ under #\d+\. /, ' under #n. ')}`);
  }
  return out;
}

/** How many findings a line stands for: one, or the places a grouped line names. */
const weight = (line: string) => Number(/ In (\d+) places[:,] /.exec(line)?.[1] ?? 1);
const findingsIn = (lines: string[]) => lines.reduce((n, l) => n + weight(l), 0);

const isTier = (i: Issue) => i.code.startsWith('tier-');

/** Every group that has a findings report button, scoped as its view scopes it. */
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

describe.each(SETS)('findings report: %s', (set) => {
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

      // B4: each rule's section is whole, findings are numbered in order, and nothing steers the fix.
      const lines = full.text.split('\n');
      const sections = full.text.split('\n## ').slice(1);
      const broken: string[] = [];
      for (const sec of sections) {
        const id = /^.+ \[([a-z0-9-]+)\] \(\d+\)\n/.exec(sec)?.[1];
        if (!id || !CRITERIA[id]) {
          broken.push(`no rule: ${sec.slice(0, 60)}`);
          continue;
        }
        for (const field of ['Basis: ', 'Problem: ', 'Done when: ']) if (!sec.includes(`\n${field}`)) broken.push(`${id}: no ${field}`);
        if (BASIS[id]?.standing === 'advice' && !sec.includes('\nDecline if: ')) broken.push(`${id}: advice without "Decline if"`);
      }
      expect(broken.slice(0, 5), 'every section whole').toEqual([]);
      const numbers = lines.filter((l) => l.startsWith('- #')).map((l) => Number(/^- #(\d+) /.exec(l)?.[1]));
      expect(numbers.every((n, k) => n === k + 1), 'numbered 1, 2… in order').toBe(true);
      const steers = lines.filter((l) => l.startsWith('- #') && PRESCRIBES.test(l));
      const around = (l: string) => new RegExp(`.{0,80}(${PRESCRIBES.source}).{0,40}`, 'i').exec(l)?.[0];
      expect(steers.slice(0, 3).map(around), 'no finding steers the fix').toEqual([]);

      // B5: provenance. Everything the prompt names comes from the files loaded for this check:
      // each `name` in a finding is a key in them (a `*` stands for the members of a group), each
      // file named is a loaded one, and no other sample set's name appears unless these files hold it.
      const loadedText = s.files.map((f) => `${f.name}\n${f.text}`).join('\n').toLowerCase();
      const foreign: string[] = [];
      for (const l of lines.filter((x) => x.startsWith('- #'))) {
        for (const [, name] of l.matchAll(/`([^`]+)`/g)) {
          // `a.b.{c, d}` is `a.b.c` and `a.b.d`: each part checked.
          const parts = name!.replace(/\.\{(.*)\}$/, '.$1').split(/[./]|, /).filter((k) => k && k !== '*' && k !== '…');
          for (const k of parts) if (!loadedText.includes(k.toLowerCase())) foreign.push(`${name} (“${k}”)`);
        }
        for (const [file] of l.matchAll(/[\w$@ .\-/]+\.json\b/g)) {
          const f = file!.trim().replace(/^- #\d+ /, '');
          if (!s.files.some((x) => x.name === f || x.name.endsWith(`/${f}`) || f.endsWith(x.name))) foreign.push(`file ${f}`);
        }
      }
      for (const other of SETS.filter((x) => x !== set)) {
        const word = other.toLowerCase();
        if (full.text.toLowerCase().includes(word) && !loadedText.includes(word)) foreign.push(`set name ${other}`);
      }
      expect(foreign.slice(0, 8), 'every name comes from the loaded files').toEqual([]);

      // B6: the places file. It carries the prompt's fingerprint, and lists every place of each
      // finding that points to it (as many as the prompt counts), each name from the loaded files.
      const pointers = [...full.text.matchAll(/^- #(\d+) .* In (\d+) places, every one listed in dtsanity-places\.md under #\1\. /gm)];
      expect(!!full.places, 'a places file exactly when a finding points to it').toBe(pointers.length > 0);
      // Its guardrails (open it before editing, examples aren't the list, decline only what a rule covers) exactly then too.
      for (const rule of ['every one listed in dtsanity-places.md” keep', 'aren’t its whole list', 'Decline by value or by group only'])
        expect(full.text.includes(rule), `guardrail: ${rule}`).toBe(!!full.places);
      if (full.places) {
        const print = /^Fingerprint ([0-9a-f]{8}),/m.exec(full.places.text)?.[1];
        expect(full.text, 'the prompt names the same fingerprint').toContain(`fingerprint ${print}`);
        const sections = new Map(full.places.text.split('\n## ').slice(1).map((sec) => [Number(/^#(\d+) /.exec(sec)?.[1]), sec]));
        const short: string[] = [];
        for (const [, no, count] of pointers) {
          const sec = sections.get(Number(no));
          if (!sec) {
            short.push(`#${no}: no section`);
            continue;
          }
          let listed = 0;
          for (const l of sec.split('\n').filter((x) => x.startsWith('- '))) {
            const where = l.replace(/^- (“.*?”(, (“.*?”|\{.*?\}))*|\{.*?\}(, \{.*?\})*): /, '');
            for (const [, name] of where.matchAll(/`([^`]+)`/g)) {
              const leaves = /\.\{(.*)\}$/.exec(name!)?.[1];
              listed += leaves ? leaves.split(', ').length : 1;
              const parts = name!.replace(/\.\{(.*)\}$/, '.$1').split(/[./]|, /).filter((k) => k && k !== '*');
              for (const k of parts) if (!loadedText.includes(k.toLowerCase())) foreign.push(`places #${no} ${name}`);
            }
            const lineList = /lines? ([\d, ]+)$/.exec(where)?.[1];
            if (lineList) listed += lineList.split(', ').length;
          }
          if (listed !== Number(count)) short.push(`#${no}: ${listed} of ${count}`);
        }
        expect(short.slice(0, 5), 'every place of each finding is in the places file').toEqual([]);
        expect(foreign.slice(0, 8), 'every name in the places file comes from the loaded files').toEqual([]);
      }

      // B3: the same files, loaded again, give the same prompt.
      expect(fixPrompt(store.get()).text === full.text, 'built twice, the same').toBe(true);
      clearAll();
      updateSettings(SETTINGS);
      addFiles(parse(texts));
      expect(fixPrompt(store.get()).text === full.text, 'loaded again, the same').toBe(true);

      if (process.env.SAMPLES_REPORT) {
        const chars = full.text.length;
        console.log(`\n${set}: findings report ${full.count} corrections + ${full.more} others on ${listed.length} lines, ${chars} characters (~${Math.round(chars / 4)} tokens, ~${Math.round(chars / 4 / Math.max(1, full.count + full.more))} per finding)`);
      }
    },
    T,
  );
});
