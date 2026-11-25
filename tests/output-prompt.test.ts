import { describe, expect, it } from 'vitest';
import { getIn, parseJson } from '../src/json/cst';
import { fixPrompt, PLACES_TITLE, issuesScope, pairsScope, type PromptScope } from '../src/io/prompt';
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
    // The number, and the pointer to its places at the end, count from 1 in every prompt: left out.
    else if (rule && line.startsWith('- #')) out.push(`[${rule}] ${line.replace(/^- #\d+ /, '').replace(/ under Places #\d+ at the end\. /, ' under Places #n at the end. ')}`);
  }
  return out;
}

/** How many findings a line stands for: one, or the places a grouped line names. */
const weight = (line: string) => Number(/ In (\d+) places[:,] /.exec(line)?.[1] ?? 1);
const findingsIn = (lines: string[]) => lines.reduce((n, l) => n + weight(l), 0);

/**
 * The token paths a written path stands for: `a.b.{c, d}` is `a.b.c` and `a.b.d`; `{a, b}.{c, d}`
 * is `a.c`, `a.d`, `b.c` and `b.d`.
 */
function expand(name: string): string[] {
  const list = (x: string) => (x.startsWith('{') && x.endsWith('}') ? x.slice(1, -1).split(', ') : [x]);
  if (name.startsWith('{')) {
    const close = name.indexOf('}');
    const leaves = list(name.slice(close + 2));
    return list(name.slice(0, close + 1)).flatMap((p) => leaves.map((l) => `${p}.${l}`));
  }
  const m = /^(.*)\.\{(.*)\}$/.exec(name);
  return m ? m[2]!.split(', ').map((l) => `${m[1]}.${l}`) : [name];
}

/** Every key path in a parsed file whose last key is `key`, dot-joined. */
function keyPathsNamed(root: unknown, key: string): string[] {
  const out: string[] = [];
  const walk = (node: { kind?: string; entries?: { key: string; value: unknown }[] } | undefined, path: string) => {
    if (node?.kind !== 'object') return;
    for (const e of node.entries!) {
      const at = path ? `${path}.${e.key}` : e.key;
      if (e.key === key) out.push(at);
      walk(e.value as never, at);
    }
  };
  walk(root as never, '');
  return out;
}

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
      // The findings' sections, up to the places part at the end (reference data, not rules).
      const sections = full.text.split(`\n# ${PLACES_TITLE}\n`)[0]!.split('\n## ').slice(1);
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
          const parts = expand(name!).flatMap((x) => x.split(/[./]/)).filter((k) => k && k !== '*' && k !== '…');
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

      // B6: the places at the end. The part is last and marked as reference data, and lists every
      // place of each finding that points to it (as many as the prompt counts), each name from the loaded files.
      const pointers = [...full.text.matchAll(/^- #(\d+) .* In (\d+) places, every one listed under Places #\1 at the end\. /gm)];
      const at = full.text.indexOf(`\n# ${PLACES_TITLE}\n`);
      expect(at >= 0, 'a places part exactly when a finding points to it').toBe(pointers.length > 0);
      // Its guardrails (reference data, examples aren't the list, decline only what a rule covers) exactly then too.
      for (const rule of ['every one listed under Places #n at the end” has', 'aren’t its whole list', 'Decline by value or by group only'])
        expect(full.text.includes(rule), `guardrail: ${rule}`).toBe(at >= 0);
      if (at >= 0) {
        const tail = full.text.slice(at);
        expect(/^- #\d+ /m.test(tail), 'no finding after the places part begins').toBe(false);
        const sections = new Map(tail.split('\n## ').slice(1).map((sec) => [Number(/^Places #(\d+): /.exec(sec)?.[1]), sec]));
        const short: string[] = [];
        for (const [, no, count] of pointers) {
          const sec = sections.get(Number(no));
          if (!sec) {
            short.push(`#${no}: no section`);
            continue;
          }
          let listed = 0;
          // A place in several files counts once for each: “In all 4 files:”, “Only in 2 files (…):”.
          let times = 1;
          for (const l of sec.split('\n')) {
            const label = /^(?:In all (\d+) files|Only in (\d+) files \(.*\)|Only in .*):$/.exec(l);
            if (label) times = Number(label[1] ?? label[2] ?? 1);
            if (!l.startsWith('- ')) continue;
            const where = l.replace(/^- (“.*?”(, (“.*?”|\{.*?\}))*|\{.*?\}(, \{.*?\})*): /, '');
            for (const [, name] of where.matchAll(/`([^`]+)`/g)) {
              listed += expand(name!).length * times;
              const parts = expand(name!).flatMap((x) => x.split(/[./]/)).filter((k) => k && k !== '*');
              for (const k of parts) if (!loadedText.includes(k.toLowerCase())) foreign.push(`places #${no} ${name}`);
            }
            const found = /every “[^”]+” key \(([\d,]+)\)/.exec(where)?.[1];
            if (found) listed += Number(found.replace(/,/g, '')) * times;
            const lineList = /lines? ([\d, ]+)$/.exec(where)?.[1];
            if (lineList) listed += lineList.split(', ').length * times;
          }
          if (listed !== Number(count)) short.push(`#${no}: ${listed} of ${count}`);
        }
        expect(short.slice(0, 5), 'every place of each finding is in the places part').toEqual([]);
        expect(foreign.slice(0, 8), 'every name in the places part comes from the loaded files').toEqual([]);
      }

      // B7: nothing lost. Rebuilt from the prompt (each path expanded, each “every “k” key” searched
      // in its file, a place in several files counted once for each), every rule's places are exactly
      // the places of its findings.
      {
        const findingsPart = at >= 0 ? full.text.slice(0, at) : full.text;
        const placesPart = at >= 0 ? full.text.slice(at) : '';
        const ruleOf = new Map<number, string>();
        const rebuilt = new Map<string, string[]>();
        const put = (rule: string | undefined, xs: string[]) => rule && rebuilt.set(rule, [...(rebuilt.get(rule) ?? []), ...xs]);
        // A file named in a head: a whole name, not part of a longer one (color-palette.json in semantic-color-palette.json).
        const named = (text: string) => s.files.filter((f) => new RegExp(`(^|[\\s(,])${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`).test(text));
        // The files a finding is about: those its head opens with, before the message.
        const of = (head: string) => named(head.slice(0, head.indexOf(': ') < 0 ? undefined : head.indexOf(': ')));
        const labelled = (m: RegExpExecArray, head: string) =>
          m[4] !== undefined ? s.files.filter((f) => f.name === m[4]) : m[3] !== undefined ? s.files.filter((f) => m[3]!.split(', ').includes(f.name)) : of(head);
        const collect = (text: string, rule: string | undefined, files: typeof s.files) => {
          const times = Math.max(1, files.length);
          const xs: string[] = [];
          for (const [, name] of text.matchAll(/`([^`]+)`/g)) for (const x of expand(name!)) for (let k = 0; k < times; k++) xs.push(`n:${x}`);
          for (const [, key] of text.matchAll(/every “([^”]+)” key \(/g)) for (const f of files) xs.push(...keyPathsNamed(f.doc.root, key!).map((x) => `n:${x}`));
          for (const [, list] of text.matchAll(/\blines? ((?:\d+, )*\d+)/g)) for (const x of list!.split(', ')) for (let k = 0; k < times; k++) xs.push(`l:${x}`);
          put(rule, xs);
        };
        let rule: string | undefined;
        for (const l of findingsPart.split('\n')) {
          if (l.startsWith('## ')) rule = /\[([a-z0-9-]+)\] \(\d+\)$/.exec(l)?.[1];
          const m = /^- #(\d+) (.*)$/.exec(l);
          if (!rule || !m) continue;
          ruleOf.set(Number(m[1]), rule);
          const body = m[2]!;
          const grouped = / In (\d+) places([:,]) /.exec(body);
          if (!grouped) {
            const target = /^(?:[^`]*? › )?`([^`]+)`/.exec(body)?.[1];
            const line = /^[^`]*?:(\d+)(?: \(|:)/.exec(body)?.[1];
            put(rule, target ? [`n:${target}`] : line ? [`l:${line}`] : []);
            continue;
          }
          if (grouped[2] === ',') continue; // listed at the end
          const head = body.slice(0, grouped.index);
          for (const part of body.slice(grouped.index + grouped[0].length).split(' | ')) {
            const label = /^(?:in all (\d+) files|only in (\d+) files \((.*?)\)|only in (.*?)), /.exec(part);
            collect(label ? part.slice(label[0].length) : part, rule, label ? labelled(label, head) : of(head));
          }
        }
        let no = 0;
        let head = '';
        let files: typeof s.files = [];
        for (const l of placesPart.split('\n')) {
          const h = /^## Places #(\d+): (.*)$/.exec(l);
          if (h) {
            no = Number(h[1]);
            head = h[2]!;
            files = of(head);
            continue;
          }
          const label = /^(?:In all (\d+) files|Only in (\d+) files \((.*)\)|Only in (.*)):$/.exec(l);
          if (label) files = labelled(label, head);
          else if (l.startsWith('- ')) collect(l.replace(/^- (“.*?”(, (“.*?”|\{.*?\}))*|\{.*?\}(, \{.*?\})*): /, ''), ruleOf.get(no), files);
        }
        const actual = new Map<string, string[]>();
        for (const i of issuesOf(s)) if (i.target || i.pos) actual.set(i.code, [...(actual.get(i.code) ?? []), i.target ? `n:${i.target}` : `l:${i.pos!.line}`]);
        const lost: string[] = [];
        for (const [code, xs] of actual) {
          if (!rebuilt.has(code)) continue; // a rule this prompt doesn't list (B1 covers coverage)
          const a = [...xs].sort();
          const b = [...rebuilt.get(code)!].sort();
          if (a.join('\n') !== b.join('\n')) {
            const missing = a.filter((x) => !b.includes(x)).slice(0, 2);
            const extra = b.filter((x) => !a.includes(x)).slice(0, 2);
            lost.push(`${code}: ${b.length} rebuilt of ${a.length}; missing ${missing.join(', ')}; extra ${extra.join(', ')}`);
          }
        }
        expect(lost.slice(0, 5), 'every place rebuilt from the prompt, no more and no fewer').toEqual([]);
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
