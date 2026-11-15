import { describe, expect, it } from 'vitest';
import { changesMarkdown } from '../src/io/changes';
import { exportAs, exportText, FIXED_FOLDER, fixedSet } from '../src/io/export';
import type { Fix, SourceFile } from '../src/model/types';
import { addFiles, applyFixes, clearAll, store, updateSettings } from '../src/state/app';
import { issuesOf, parse, SETS, SETTINGS, setTexts } from './oracle/samples';
import { lineDiff, readDoc, strayLines, unzip, valueChanges } from './oracle/text';

/**
 * The fixed files as files, on every sample set (part A of the output test
 * plan). After every fix is applied:
 *
 * A1. The download: the zip holds every loaded file once, under its own path
 *     in one folder, with exactly the text the app exports for it, plus
 *     CHANGES.md; CHANGES.md lists each file's changes, measured here on its
 *     own, and calls the others unchanged.
 * A2. The smallest edit: every line a fix changes belongs to an entry whose
 *     value changed (or the line beside it, for a comma); files no fix
 *     touched come back byte for byte.
 *
 * Set SAMPLES_REPORT=1 to print, per set, the changed files, values and lines.
 */

const T = 120_000;
const json5 = (f: SourceFile) => f.syntax === 'json5';
const editFixes = (s = store.get()): Fix[] => issuesOf(s).flatMap((i) => (i.fix && 'edits' in i.fix ? [i.fix] : []));

/** Every file's exported text, by id. */
const texts = () => new Map(store.get().files.map((f) => [f.id, exportText(f)]));

/** Load a set and apply every fix until none is offered, checking each round's edits for stray lines. */
function fixAll(set: string) {
  clearAll();
  updateSettings(SETTINGS);
  addFiles(parse(setTexts(set)));
  const stray: string[] = [];
  let values = 0;
  for (let round = 0; round < 5; round++) {
    const fixes = editFixes();
    if (!fixes.length) break;
    const before = texts();
    applyFixes(fixes);
    for (const f of store.get().files) {
      const a = before.get(f.id)!;
      const b = exportText(f);
      if (a === b) continue;
      const s = strayLines(a, b, json5(f));
      values += s.changes.length;
      const show = (lines: string[]) => lines.slice(0, 4).map((l) => l.trim().slice(0, 80));
      if (s.removed.length || s.added.length) stray.push(`${f.name} (round ${round + 1}): -[${show(s.removed).join(' | ')}] +[${show(s.added).join(' | ')}]`);
    }
  }
  return { stray, values };
}

describe('lineDiff', () => {
  it('finds the shortest set of removed and added lines', () => {
    expect(lineDiff('a\nb\nc\nd', 'a\nx\nc\nd\ne')).toEqual({ removed: [1], added: [1, 4] });
    expect(lineDiff('a\nb', 'a\nb')).toEqual({ removed: [], added: [] });
    expect(lineDiff('', 'a')).toEqual({ removed: [0], added: [0] });
  });

  it('allows the entry that changed and the line beside it, nothing else', () => {
    const before = '{\n  "a": { "$value": 1 },\n  "b": {\n    "value": 2\n  }\n}';
    expect(strayLines(before, before.replace('"value"', '"$value"'), false)).toMatchObject({ removed: [], added: [] });
    // Removing an entry drops the comma before it; still only that entry.
    expect(strayLines(before, '{\n  "a": { "$value": 1 }\n}', false)).toMatchObject({ removed: [], added: [] });
    // A key order change moves lines whose values didn't change.
    const swapped = '{\n  "b": {\n    "value": 2\n  },\n  "a": { "$value": 1 }\n}';
    expect(strayLines(before, swapped, false).added.length).toBeGreaterThan(0);
  });
});

describe.each(SETS)('fixed files: %s', (set) => {
  it(
    'download the whole set, as exported, with an accurate CHANGES.md',
    () => {
      const { stray, values } = fixAll(set);
      const s = store.get();

      // A2: only the lines of what changed.
      expect(stray.slice(0, 10), 'fixes change only the lines of what they change').toEqual([]);

      // A1: the zip.
      const files = unzip(fixedSet(s, new Date('2026-01-01')));
      const paths = files.map((f) => f.path);
      expect(new Set(paths).size, 'no path twice').toBe(paths.length);
      expect(paths.sort()).toEqual([...s.files.map((f) => `${FIXED_FOLDER}/${f.name}`), `${FIXED_FOLDER}/CHANGES.md`].sort());
      const inZip = new Map(files.map((f) => [f.path, f.text]));
      for (const f of s.files) {
        const want = exportAs(f, f.converted ? 'original' : 'dtcg').text;
        expect(inZip.get(`${FIXED_FOLDER}/${f.name}`) === want, `${f.name} is in the zip as exported`).toBe(true);
        // Untouched files come back as loaded, byte for byte.
        if (!f.converted && exportText(f) === f.baseText) expect(want === f.text, `${f.name} unchanged`).toBe(true);
      }

      // CHANGES.md: per file, the token changes measured here (read in the file's own syntax).
      const md = inZip.get(`${FIXED_FOLDER}/CHANGES.md`)!;
      const sections = new Map<string, string[]>();
      let current = '';
      for (const line of md.split('\n')) {
        if (line.startsWith('## ')) sections.set((current = line.slice(3)), []);
        else if (line.startsWith('- ') && current) sections.get(current)!.push(line);
      }
      const unchanged = new Set((sections.get('Unchanged') ?? []).map((l) => l.slice(2)));
      const report: string[] = [];
      let changedFiles = 0;
      let lines = 0;
      for (const f of s.files) {
        const before = f.converted ? f.baseText : f.text;
        const after = exportText(f);
        const measured = valueChanges(readDoc(before, json5(f)), readDoc(after, json5(f)));
        if (!measured.length) {
          expect(unchanged.has(f.name) || before === after, `${f.name}: listed as unchanged`).toBe(true);
          continue;
        }
        changedFiles++;
        // The lines of the entries that changed (a line diff of a large file can't tell moved lines from changed ones).
        const span = strayLines(before, after, json5(f)).lines;
        lines += span.before + span.after;
        const listed = sections.get(f.name) ?? [];
        expect(listed.length, `${f.name}: CHANGES.md lists its changes`).toBeGreaterThan(0);
        // Each measured change sits under a token CHANGES.md names (a token is listed whole when several of its properties change).
        const named = listed.map((l) => /`([^`]+)`/.exec(l)?.[1] ?? '');
        const missing = measured.filter((c) => !named.some((n) => n === '(root)' || c.path.join('.') === n || c.path.join('.').startsWith(`${n}.`)));
        expect(missing.map((c) => c.path.join('.')).slice(0, 5), `${f.name}: every change is listed`).toEqual([]);
        report.push(`  ${f.name}: ${measured.length} values, ${span.before} lines → ${span.after}`);
      }
      expect(md).toContain(changesMarkdown(s, new Map(), new Date('2026-01-01')).split('\n')[4]!);

      if (process.env.SAMPLES_REPORT) console.log(`\n${set}: ${changedFiles} of ${s.files.length} files changed, ${values} values, ${lines} lines\n${report.slice(0, 12).join('\n')}`);
    },
    T,
  );
});
