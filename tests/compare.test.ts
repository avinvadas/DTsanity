import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it } from 'vitest';
import { isLoadError, parseSource } from '../src/io/load';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import type { Issue, Settings, SourceFile } from '../src/model/types';
import { addFiles, clearAll, store, updateSettings, type AppState } from '../src/state/app';
import { findings, findingTotal, issuesOf } from '../src/ui/findings';
import { meaningOf, tokensOf, type TokenView } from './oracle/samples';
import { same, show } from './oracle/meaning';

/**
 * Compare two loads of a token set, finding by finding: what a round of
 * corrections fixed, what it broke and what it left. Runs only when asked:
 *
 *   npm run compare -- <before folder> <after folder>
 *
 * Everything stays on this machine. The report goes to the terminal and, with
 * COMPARE_OUT set, to that file as Markdown. COMPARE_SETTINGS takes the app's
 * settings as JSON (as it saves them), to count exactly as the app did.
 *
 * Besides findings, it lists every token whose resolved value changed in any
 * theme: corrections are meant to change the format, never the design.
 */

const BEFORE = process.env.COMPARE_BEFORE;
const AFTER = process.env.COMPARE_AFTER;

function files(dir: string): { name: string; text: string }[] {
  const walk = (d: string): string[] =>
    readdirSync(d)
      .sort()
      .flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : /\.json[5c]?$/.test(n) ? [p] : [];
      });
  return walk(dir).map((p) => ({ name: relative(dir, p), text: readFileSync(p, 'utf8') }));
}

interface Finding {
  key: string;
  kind: string;
  rule: string;
  severity: string;
  file: string;
  place: string;
  message: string;
}

/** Every finding the app shows, with a key that survives a reload: rule, file and place, not line numbers. */
function load(dir: string, settings: Settings): { s: AppState; total: number; all: Finding[]; unread: string[]; values: Map<string, Map<string, TokenView>> } {
  clearAll();
  updateSettings(settings);
  const unread: string[] = [];
  const loaded: SourceFile[] = [];
  for (const f of files(dir)) {
    const r = parseSource({ name: f.name, text: f.text, origin: 'file' }, settings);
    if (isLoadError(r)) unread.push(`${f.name}: ${r.message} (${r.line}:${r.col})`);
    else loaded.push(r);
  }
  addFiles(loaded);
  const s = store.get();
  const name = new Map(s.files.map((f) => [f.id, f.name]));
  const all: Finding[] = [];
  const issue = (i: Issue): Finding => {
    const file = (i.fileId && name.get(i.fileId)) || '';
    const place = i.target ?? i.keyPath?.join('.') ?? '';
    return { key: [i.code, file, place, i.message].join(' | '), kind: i.code.startsWith('tier-') ? 'tiers' : 'format', rule: i.code, severity: i.severity, file, place, message: i.message ?? '' };
  };
  for (const i of issuesOf(s)) all.push(issue(i));
  const f = findings(s);
  for (const r of f.contrast) all.push({ key: `contrast | ${r.pair.fg} | ${r.pair.bg}`, kind: 'contrast', rule: 'contrast', severity: r.tone ?? '', file: '', place: `${r.pair.fg} on ${r.pair.bg}`, message: '' });
  for (const r of f.vision) all.push({ key: `vision | ${r.pair.fg} | ${r.pair.bg}`, kind: 'vision', rule: 'color-vision', severity: r.cvdTone ?? '', file: '', place: `${r.pair.fg} on ${r.pair.bg}`, message: '' });
  for (const g of f.groups) all.push({ key: `status | ${g.group.id}`, kind: 'vision', rule: 'status-colors', severity: g.tone ?? '', file: '', place: g.group.id, message: '' });
  const names = s.themeModels.length ? s.themeModels.map((m) => m.theme.name) : ['(no themes)'];
  const values = new Map(tokensOf(s).map((m, i) => [names[i]!, m]));
  return { s, total: findingTotal(f), all, unread, values };
}

const countBy = <T,>(xs: T[], by: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(by(x), (m.get(by(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

describe.skipIf(!BEFORE || !AFTER)('compare two loads', () => {
  it(
    'reports what changed, finding by finding',
    () => {
      const out: string[] = [`# Findings: ${BEFORE} → ${AFTER}`, ''];
      const configs: [string, Settings][] = process.env.COMPARE_SETTINGS
        ? [['The app’s settings', { ...DEFAULT_SETTINGS, ...JSON.parse(process.env.COMPARE_SETTINGS) }]]
        : [
            ['Default settings', DEFAULT_SETTINGS],
            ['Legacy formats accepted', { ...DEFAULT_SETTINGS, acceptLegacy: true }],
          ];
      for (const [label, settings] of configs) {
        const a = load(resolve(BEFORE!), settings);
        const b = load(resolve(AFTER!), settings);
        const keysA = new Set(a.all.map((x) => x.key));
        const keysB = new Set(b.all.map((x) => x.key));
        const fixed = a.all.filter((x) => !keysB.has(x.key));
        const added = b.all.filter((x) => !keysA.has(x.key));
        const kept = b.all.filter((x) => keysA.has(x.key));
        const counted = (xs: Finding[]) => xs.filter((x) => x.severity !== 'info').length;
        out.push(
          `## ${label}`,
          '',
          `Issues found (as the app counts them): ${a.total} → ${b.total}`,
          `All findings, info included: ${a.all.length} → ${b.all.length}`,
          `Fixed: ${fixed.length} (${counted(fixed)} counted) · New: ${added.length} (${counted(added)} counted) · Still there: ${kept.length}`,
          ...(b.unread.length ? ['', `Files that couldn't be read after: ${b.unread.join('; ')}`] : []),
          '',
          '### Fixed, by rule',
          ...countBy(fixed, (x) => `${x.rule} (${x.severity})`).map(([k, n]) => `- ${k}: ${n}`),
          '',
          '### New, by rule',
          ...countBy(added, (x) => `${x.rule} (${x.severity})`).map(([k, n]) => `- ${k}: ${n}`),
          '',
          '### New, by rule and file',
          ...countBy(added, (x) => `${x.rule} · ${x.file || '(set)'}`).map(([k, n]) => `- ${k}: ${n}`),
          '',
          '### New, examples (up to 5 per rule)',
        );
        const seen = new Map<string, number>();
        for (const x of added) {
          const n = seen.get(x.rule) ?? 0;
          if (n >= 5) continue;
          seen.set(x.rule, n + 1);
          out.push(`- [${x.rule}] ${x.file} › \`${x.place}\`: ${x.message}`);
        }
        // Tokens whose value means something else now, per theme; and tokens that came or went.
        const changed = new Map<string, string[]>();
        const gone = new Set<string>();
        const fresh = new Set<string>();
        for (const [theme, before] of a.values) {
          const after = b.values.get(theme);
          if (!after) continue;
          for (const [id, v] of before) {
            const w = after.get(id);
            if (!w) {
              gone.add(id);
              continue;
            }
            if (!v.ok || !w.ok) continue;
            const m = meaningOf(v.type, v);
            const n = meaningOf(w.type ?? v.type, w);
            if (!same(m, n)) changed.set(id, [...(changed.get(id) ?? []), `${theme}: ${show(m)} → ${show(n)}`]);
          }
          for (const id of after.keys()) if (!before.has(id)) fresh.add(id);
        }
        out.push(
          '',
          `### Values changed (${changed.size} tokens)`,
          ...[...changed].slice(0, 40).map(([id, ts]) => `- \`${id}\`: ${ts.slice(0, 2).join('; ')}${ts.length > 2 ? ` (+${ts.length - 2} themes)` : ''}`),
          ...(changed.size > 40 ? [`- … and ${changed.size - 40} more`] : []),
          '',
          `Tokens removed: ${gone.size}${gone.size ? ` (${[...gone].slice(0, 10).join(', ')}${gone.size > 10 ? ', …' : ''})` : ''}`,
          `Tokens added: ${fresh.size}${fresh.size ? ` (${[...fresh].slice(0, 10).join(', ')}${fresh.size > 10 ? ', …' : ''})` : ''}`,
          '',
        );
      }
      const text = out.join('\n');
      console.log(text);
      if (process.env.COMPARE_OUT) writeFileSync(process.env.COMPARE_OUT, text);
    },
    600_000,
  );
});
