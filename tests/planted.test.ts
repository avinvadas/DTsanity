import { describe, expect, it } from 'vitest';
import { exportText } from '../src/io/export';
import { parseJson, toJS } from '../src/json/cst';
import type { Issue } from '../src/model/types';
import { addFiles, applyFixes, clearAll, store, updateSettings } from '../src/state/app';
import { meaning, same } from './oracle/meaning';
import { issuesOf, parse, SETTINGS, setTexts } from './oracle/samples';

/**
 * Planted defects: real token files with one known problem put in at a
 * seeded-random place. Each must be caught by the right check. Where a
 * one-click fix is offered, applying it must give back the file as it was
 * (or, for a value, what it meant), with nothing else changed. A fix that
 * "repairs" to something else is a wrong fix, and there must be none.
 *
 * Runs on the sample sets whose files are all DTCG, so a token's id is its
 * path in its file. Set SAMPLES_REPORT=1 to print the catch and repair rates.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isToken = (v: Json): boolean => '$value' in v;
const alias = (v: unknown) => (typeof v === 'string' ? /^\{([^{}]+)\}$/.exec(v)?.[1] : undefined);

/** A small seeded random generator (mulberry32), so every failure can be repeated. */
function rng(seed: string) {
  let a = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1779033703) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Node {
  path: string[];
  node: Json;
  /** A $type on a parent group. */
  inherited: boolean;
}

/**
 * Tokens worth planting in: “file|id” of each token a theme reads from that
 * file (not a copy another file overrides) and that resolves as loaded.
 */
let OK = new Set<string>();
/** The file being walked. */
let FILE = '';

function walk(doc: Json): { tokens: Node[]; groups: Node[] } {
  const tokens: Node[] = [];
  const groups: Node[] = [];
  const visit = (n: Json, path: string[], inherited: boolean) => {
    if (isToken(n)) return void (OK.has(`${FILE}|${path.join('.')}`) && tokens.push({ path, node: n, inherited }));
    if (path.length) groups.push({ path, node: n, inherited });
    const typed = inherited || typeof n.$type === 'string';
    for (const [k, v] of Object.entries(n)) if (!k.startsWith('$') && isObj(v)) visit(v, [...path, k], typed);
  };
  visit(doc, [], false);
  return { tokens, groups };
}

const at = (doc: Json, path: string[]) => path.reduce<Json>((n, k) => n[k] as Json, doc);

interface Planted {
  /** The check that must catch it. */
  code: string;
  /** The changed document. */
  doc: Json;
  /** The duplicate-key case: the text itself, since JSON objects can't hold a key twice. */
  text?: string;
  /** What a fix must give back: the whole file, or the meaning of one token's value. */
  restore: 'file' | { path: string[]; type: string; value: unknown } | 'none';
}

type Op = (doc: Json, all: Set<string>, pick: <T>(xs: T[]) => T | undefined) => Planted | undefined;

const COLOR_HEX = (v: unknown) => (isObj(v) && typeof v.hex === 'string' && (v.alpha === undefined || v.alpha === 1) ? v.hex : undefined);

/** One kind of defect each: how to plant it, given a file and every token id in the set. */
const OPS: Record<string, Op> = {
  'broken reference': (doc, _all, pick) => {
    const t = pick(walk(doc).tokens.filter((x) => alias(x.node.$value)));
    if (!t) return;
    t.node.$value = '{zz-planted.missing.token}';
    return { code: 'unresolved-reference', doc, restore: 'none' };
  },
  'typo in a reference': (doc, all, pick) => {
    const t = pick(walk(doc).tokens.filter((x) => (alias(x.node.$value)?.split('.').at(-1)?.length ?? 0) >= 4));
    if (!t) return;
    const target = alias(t.node.$value)!;
    const parts = target.split('.');
    const last = parts.at(-1)!;
    // Swap two letters in the middle of the last name.
    const i = Math.floor(last.length / 2) - 1;
    parts[parts.length - 1] = last.slice(0, i) + last[i + 1] + last[i] + last.slice(i + 2);
    const typo = parts.join('.');
    if (typo === target || all.has(typo)) return;
    t.node.$value = `{${typo}}`;
    return { code: 'unresolved-reference', doc, restore: 'file' };
  },
  'missing type': (doc, _all, pick) => {
    const t = pick(walk(doc).tokens.filter((x) => !x.inherited && typeof x.node.$type === 'string' && !alias(x.node.$value)));
    if (!t) return;
    delete t.node.$type;
    return { code: 'missing-type', doc, restore: 'file' };
  },
  'color as a hex string': (doc, _all, pick) => {
    const t = pick(walk(doc).tokens.filter((x) => COLOR_HEX(x.node.$value)));
    if (!t) return;
    const value = t.node.$value;
    t.node.$value = COLOR_HEX(value);
    return { code: 'legacy-value', doc, restore: { path: t.path, type: 'color', value } };
  },
  '"value" without the "$"': (doc, _all, pick) => {
    // In a file of one token, "value" makes it a Style Dictionary file, read as one: plant it among DTCG tokens.
    const tokens = walk(doc).tokens;
    const t = tokens.length >= 3 ? pick(tokens) : undefined;
    if (!t) return;
    // Rebuild the token with "value" where "$value" was, keeping the key order.
    const rebuilt = Object.fromEntries(Object.entries(t.node).map(([k, v]) => [k === '$value' ? 'value' : k, v]));
    const parent = t.path.length > 1 ? at(doc, t.path.slice(0, -1)) : doc;
    parent[t.path.at(-1)!] = rebuilt;
    return { code: 'legacy-property', doc, restore: 'file' };
  },
  'typo in a type': (doc, _all, pick) => {
    const t = pick(walk(doc).tokens.filter((x) => typeof x.node.$type === 'string' && (x.node.$type as string).length >= 5));
    if (!t) return;
    const type = t.node.$type as string;
    t.node.$type = type.slice(0, 2) + type.slice(3);
    return { code: 'unknown-type', doc, restore: 'file' };
  },
  'duplicate key': (doc, _all, pick) => {
    const t = pick(walk(doc).tokens.filter((x) => x.path.length > 1));
    if (!t) return;
    const parent = at(doc, t.path.slice(0, -1));
    const key = t.path.at(-1)!;
    // Write the token twice by name: a marker key next to it becomes the same name in the text.
    const rebuilt = Object.fromEntries(Object.entries(parent).flatMap(([k, v]) => (k === key ? [[k, v], [`${k}\u0000dup`, v]] : [[k, v]])));
    Object.keys(parent).forEach((k) => delete parent[k]);
    Object.assign(parent, rebuilt);
    const text = JSON.stringify(doc, null, 2).replaceAll('\\u0000dup', '');
    return { code: 'duplicate-key', doc, text, restore: 'none' };
  },
  'reference loop': (doc, all, pick) => {
    const tokens = walk(doc).tokens;
    const byId = new Map(tokens.map((x) => [x.path.join('.'), x]));
    const t = pick(tokens.filter((x) => { const to = alias(x.node.$value); return to && byId.has(to) && !alias(byId.get(to)!.node.$value); }));
    if (!t) return;
    byId.get(alias(t.node.$value)!)!.node.$value = `{${t.path.join('.')}}`;
    void all;
    return { code: 'circular-reference', doc, restore: 'none' };
  },
  'reference to a group': (doc, all, pick) => {
    const { tokens, groups } = walk(doc);
    const g = pick(groups.filter((x) => !all.has(`${x.path.join('.')}.$root`)));
    const t = pick(tokens.filter((x) => alias(x.node.$value)));
    if (!g || !t) return;
    t.node.$value = `{${g.path.join('.')}}`;
    return { code: 'reference-to-group', doc, restore: 'none' };
  },
  'a “.” in a name': (doc, _all, pick) => {
    const t = pick(walk(doc).tokens.filter((x) => x.path.length > 1));
    if (!t) return;
    const parent = at(doc, t.path.slice(0, -1));
    const key = t.path.at(-1)!;
    const rebuilt = Object.fromEntries(Object.entries(parent).map(([k, v]) => [k === key ? `${k}.planted` : k, v]));
    Object.keys(parent).forEach((k) => delete parent[k]);
    Object.assign(parent, rebuilt);
    return { code: 'invalid-name', doc, restore: 'none' };
  },
  'empty group': (doc, _all, pick) => {
    const g = pick(walk(doc).groups) ?? { path: [], node: doc, inherited: false };
    g.node['zz-planted-empty'] = {};
    return { code: 'empty-group', doc, restore: 'file' };
  },
};

/**
 * Sets whose files are all DTCG: a token's id is its path in its file.
 * (Cloudscape's values are {light, dark} pairs, not DTCG values, so it is left out.)
 */
const DTCG_SETS = ['carbon', 'gitlab', 'primer'];
const PER_OP = 4;

/** An issue's place, the same across loads (file ids change from load to load). */
/** JSON with keys sorted: two documents that differ only in key order read the same. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

const place = (i: Issue, names: Map<string, string>) => [i.code, names.get(i.fileId ?? '') ?? '', i.target ?? ''].join(' | ');

function analyze(texts: { name: string; text: string }[]) {
  clearAll();
  updateSettings(SETTINGS);
  addFiles(parse(texts));
  const s = store.get();
  const names = new Map(s.files.map((f) => [f.id, f.name]));
  return { issues: issuesOf(s), names };
}

interface Outcome {
  set: string;
  op: string;
  caught: boolean;
  fix: 'none' | 'restored' | 'wrong';
  detail: string;
}

const results: Outcome[] = [];

describe.each(DTCG_SETS)('planted defects: %s', (set) => {
  const texts = setTexts(set);
  // Plant only where a check would look: tokens that resolve, in files some theme reads.
  clearAll();
  updateSettings(SETTINGS);
  addFiles(parse(texts));
  const loaded = store.get();
  const read = new Set((loaded.themeModels.length ? loaded.themeModels.flatMap((m) => m.model.files) : loaded.files).map((f) => f.name));
  const fileName = new Map(loaded.files.map((f) => [f.id, f.name]));
  const models = loaded.themeModels.length ? loaded.themeModels.map((m) => m.model) : [loaded.model];
  const ok = new Set(models.flatMap((m) => [...m.tokens.values()]).filter((t) => t.resolution === 'ok' && !t.extendedFrom).map((t) => `${fileName.get(t.fileId)}|${t.id}`));
  const all = new Set(loaded.model.tokens.keys());
  OK = ok;
  // JSON5 files (Primer) are read as such; planted copies are written as JSON, which JSON5 also is.
  const files = texts.map((t, i) => ({ i, name: t.name, doc: toJS(parseJson(t.text, { json5: /\.json[5c]$/i.test(t.name) }).doc.root) as Json })).filter((f) => read.has(f.name) && ((FILE = f.name), walk(f.doc).tokens.length > 0));

  it.each(Object.keys(OPS))(
    '%s is caught, and its fix gives back what was there',
    (op) => {
      OK = ok;
      const pick = rng(`${set}/${op}`);
      const choose = <T>(xs: T[]) => (xs.length ? xs[Math.floor(pick() * xs.length)] : undefined);
      let tried = 0;
      for (let attempt = 0; attempt < PER_OP * 4 && tried < PER_OP; attempt++) {
        const file = choose(files)!;
        FILE = file.name;
        const planted = OPS[op]!(structuredClone(file.doc), all, choose);
        if (!planted) continue;
        tried++;
        const base = texts.map((t, i) => (i === file.i ? { name: t.name, text: JSON.stringify(file.doc, null, 2) } : t));
        const changed = base.map((t, i) => (i === file.i ? { name: t.name, text: planted.text ?? JSON.stringify(planted.doc, null, 2) } : t));

        const before = analyze(base);
        const known = new Set(before.issues.map((i) => place(i, before.names)));
        const after = analyze(changed);
        const fresh = after.issues.filter((i) => !known.has(place(i, after.names)) && i.code === planted.code && after.names.get(i.fileId ?? '') === file.name);
        const caught = fresh.length > 0;
        const where = `${file.name}: ${fresh[0]?.target ?? '?'}`;
        if (!caught) {
          // What the checks did see, to tell a missed defect from a planting mistake.
          const other = after.issues.filter((i) => !known.has(place(i, after.names)) && after.names.get(i.fileId ?? '') === file.name).map((i) => `${i.code} ${i.target}: ${i.message.slice(0, 100)}`);
          const diff = JSON.stringify(planted.doc).length - JSON.stringify(file.doc).length;
          expect.soft(other, `${set} › ${op} in ${file.name}: new issues (size change ${diff})`).toEqual(['(none expected besides the defect)']);
        }
        expect(caught, `${set} › ${op} in ${file.name} is caught by ${planted.code}`).toBe(true);

        const fixable = fresh.find((i) => i.fix && 'edits' in i.fix);
        if (!fixable || planted.restore === 'none') {
          results.push({ set, op, caught, fix: 'none', detail: where });
          continue;
        }
        applyFixes([fixable.fix!]);
        const s = store.get();
        const out = toJS(parseJson(exportText(s.files.find((f) => f.name === file.name)!), { json5: true }).doc.root) as Json;
        let restored: boolean;
        if (planted.restore === 'file') restored = canonical(out) === canonical(file.doc);
        else {
          const { path, type, value } = planted.restore;
          restored = same(meaning(type, at(out, path).$value), meaning(type, value));
        }
        results.push({ set, op, caught, fix: restored ? 'restored' : 'wrong', detail: `${where} (${fixable.fix!.label})` });
        expect(restored, `${set} › ${op} in ${where}: “${fixable.fix!.label}” gives back what was there`).toBe(true);
      }
      // Some defects can't be planted in some sets (no references inside one file, say); the summary checks each is planted somewhere.
    },
    60_000,
  );
});

describe('planted defects: summary', () => {
  it('catches every planted defect and makes no wrong fix', () => {
    const ops = [...new Set(results.map((r) => r.op))];
    expect(Object.keys(OPS).filter((op) => !ops.includes(op)), 'every kind of defect is planted in some set').toEqual([]);
    const rows = ops.map((op) => {
      const rs = results.filter((r) => r.op === op);
      return `${op.padEnd(24)} caught ${rs.filter((r) => r.caught).length}/${rs.length}  fixed back ${rs.filter((r) => r.fix === 'restored').length}  wrong ${rs.filter((r) => r.fix === 'wrong').length}`;
    });
    if (process.env.SAMPLES_REPORT) console.log(`\n${rows.join('\n')}`);
    expect(results.filter((r) => r.fix === 'wrong').map((r) => `${r.op}: ${r.detail}`)).toEqual([]);
    expect(results.every((r) => r.caught)).toBe(true);
  });
});
