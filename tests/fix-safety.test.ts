import { describe, expect, it } from 'vitest';
import { exportAs, exportText, isUnchanged } from '../src/io/export';
import type { Fix, Issue } from '../src/model/types';
import { addFiles, applyFixes, clearAll, redo, store, undo, updateSettings } from '../src/state/app';
import { same, show } from './oracle/meaning';
import { issueKey, issuesOf, meaningOf, parse, SETS, SETTINGS, setTexts, tokensOf, type TokenView } from './oracle/samples';

/**
 * Fix safety, on every sample set: applying every fix DTsanity offers must
 * change the format of the files, never what their tokens mean. For each set:
 *
 * - untouched files export exactly as loaded;
 * - fixes settle: applying them all leaves none to apply after two passes;
 * - every token keeps its meaning (colors in OKLab within ΔE 0.002, lengths
 *   in px, line heights as multipliers…), and no token stops resolving;
 * - no token is lost, except one whose name had to change (a “.” in it);
 * - every fixed issue is gone, and no new error appears;
 * - undoing everything gives back the loaded files byte for byte, and redo
 *   brings the fixes back;
 * - the fixed files, exported and loaded again, read the same, with the same
 *   issues; legacy files exported back to their own format read the same too.
 */

const T = 120_000;

/** Fixes that edit files (setting fixes are checked on their own below), with the issues they fix. */
function editFixes(issues: Issue[]): { fixes: Fix[]; keys: string[] } {
  const withFix = issues.filter((i) => i.fix && 'edits' in i.fix);
  return { fixes: withFix.map((i) => i.fix!), keys: withFix.map(issueKey) };
}

/** Tokens whose names had to change: a “.”, “{” or “}” in a name (invalid-name), renamed with the fix. */
const renamed = (id: string, renames: string[]) => renames.some((r) => id.includes(r));

function compare(before: Map<string, TokenView>[], after: Map<string, TokenView>[], renames: string[]) {
  const lost: string[] = [];
  const broke: string[] = [];
  const changed: string[] = [];
  before.forEach((m, i) => {
    const a = after[i]!;
    for (const [id, b] of m) {
      const x = a.get(id);
      if (!x) {
        if (!renamed(id, renames)) lost.push(id);
        continue;
      }
      if (!b.ok) continue; // a broken token may be repaired by a fix; nothing to keep
      if (!x.ok) {
        broke.push(id);
        continue;
      }
      const type = x.type ?? b.type;
      const mb = meaningOf(type, b);
      const ma = meaningOf(type, x);
      if (!same(mb, ma)) changed.push(`${id} (${type}): ${show(mb)} → ${show(ma)}`);
    }
  });
  return { lost, broke, changed };
}

describe.each(SETS)('fix safety: %s', (set) => {
  it(
    'fixes change the format, never the meaning',
    () => {
      clearAll();
      updateSettings(SETTINGS);
      addFiles(parse(setTexts(set)));
      const loaded = store.get();
      expect(loaded.files.filter((f) => !isUnchanged(f)).map((f) => f.name), 'untouched files export as loaded').toEqual([]);

      const before = tokensOf(loaded);
      const errorsBefore = new Set(issuesOf(loaded).filter((i) => i.severity === 'error').map(issueKey));

      // Apply every fix, then whatever is offered after, until nothing is.
      const fixedKeys: string[] = [];
      const renames: string[] = [];
      let passes = 0;
      for (; passes < 5; passes++) {
        const { fixes, keys } = editFixes(issuesOf(store.get()));
        if (!fixes.length) break;
        fixedKeys.push(...keys);
        for (const f of fixes) if ('edits' in f) for (const e of f.edits) if ('rename' in e && !String(e.path.at(-1)).startsWith('$') && /[.{}]/.test(String(e.path.at(-1)))) renames.push(String(e.path.at(-1)).replace(/[{}]/g, ''));
        applyFixes(fixes);
      }
      expect(passes, 'fixes settle within two passes').toBeLessThanOrEqual(2);

      const fixed = store.get();
      const after = tokensOf(fixed);
      const { lost, broke, changed } = compare(before, after, renames);
      expect(lost, 'no token is lost').toEqual([]);
      expect(broke, 'no token stops resolving').toEqual([]);
      expect(changed.slice(0, 20), 'every token keeps its meaning').toEqual([]);

      const issuesAfter = issuesOf(fixed);
      const left = new Set(issuesAfter.map(issueKey));
      // A fix whose change was undone by a later one in the same batch can't count as applied; a key still present is a fix that didn't fix.
      expect(fixedKeys.filter((k) => left.has(k)).slice(0, 20), 'every fixed issue is gone').toEqual([]);
      // New errors count on tokens that were there and resolving before; a fix that turns a group into a token, or repairs a reference, may reveal what was hidden.
      const wasFine = (id: string) => before.some((m) => m.get(id)?.ok);
      const newErrors = issuesAfter.filter((i) => i.severity === 'error' && !errorsBefore.has(issueKey(i)) && !renamed(i.target ?? '', renames) && (!i.target || wasFine(i.target)));
      expect(newErrors.map((i) => `${issueKey(i)}: ${i.message}`).slice(0, 20), 'no new error appears').toEqual([]);

      // Undo everything: the files are as loaded, byte for byte. Redo brings the fixes back.
      const exported = fixed.files.map((f) => exportText(f));
      const commands = fixed.past.length;
      for (let i = 0; i < commands; i++) undo();
      expect(store.get().files.filter((f) => !isUnchanged(f)).map((f) => f.name), 'undo restores every file').toEqual([]);
      for (let i = 0; i < commands; i++) redo();
      expect(store.get().files.map((f) => exportText(f)), 'redo brings the fixes back').toEqual(exported);

      // The fixed files, loaded again as DTCG, read the same and report the same.
      // A legacy-conversion note stands for what it notes: loaded again as DTCG, the note goes and the issue it covered shows.
      const noted = new Set(issuesAfter.filter((i) => i.code === 'legacy-conversion').map((i) => i.target));
      const counts = (xs: Issue[]) => {
        const kept = xs.filter((i) => i.code !== 'legacy-conversion' && !noted.has(i.target));
        return Object.fromEntries([...new Set(kept.map((i) => i.code))].sort().map((c) => [c, kept.filter((i) => i.code === c).length]));
      };
      const names = fixed.files.map((f) => f.name);
      clearAll();
      addFiles(parse(exported.map((text, i) => ({ name: names[i]!, text }))));
      const reloaded = store.get();
      const again = compare(after, tokensOf(reloaded), []);
      expect([again.lost, again.broke, again.changed.slice(0, 20)], 'the fixed files read the same when loaded again').toEqual([[], [], []]);
      expect(counts(issuesOf(reloaded)), 'and report the same issues').toEqual(counts(issuesAfter));
    },
    T,
  );

  it(
    'legacy files exported back to their format read the same',
    () => {
      clearAll();
      updateSettings(SETTINGS);
      addFiles(parse(setTexts(set)));
      const s = store.get();
      const legacy = s.files.filter((f) => f.converted && f.legacyKind);
      if (!legacy.length) return;
      const before = tokensOf(s);
      const texts = s.files.map((f) => ({ name: f.name, text: f.converted ? exportAs(f, 'original').text : f.text }));
      const notes = s.files.flatMap((f) => (f.converted ? exportAs(f, 'original').notes : []));
      clearAll();
      addFiles(parse(texts));
      const { lost, broke, changed } = compare(before, tokensOf(store.get()), []);
      // Notes name what the original format can't hold; those may differ, nothing else.
      const unexplained = (xs: string[]) => xs.filter((x) => !notes.some((n) => n.includes(x.split(' ')[0]!)));
      expect([unexplained(lost), unexplained(broke), unexplained(changed).slice(0, 20)]).toEqual([[], [], []]);
    },
    T,
  );
});

describe('the legacy-format fix', () => {
  it.each(SETS)(
    '%s: turning legacy support on reads every legacy file',
    (set) => {
      clearAll();
      updateSettings({ ...SETTINGS, acceptLegacy: false });
      const texts = setTexts(set);
      addFiles(parse(texts, { ...SETTINGS, acceptLegacy: false }));
      const offer = issuesOf(store.get()).filter((i) => i.code === 'legacy-format');
      if (!offer.length) return;
      applyFixes([offer[0]!.fix!]);
      expect(issuesOf(store.get()).filter((i) => i.code === 'legacy-format')).toEqual([]);
      const on = store.get().model.tokens.size;
      clearAll();
      updateSettings(SETTINGS);
      addFiles(parse(texts));
      expect(on).toBe(store.get().model.tokens.size);
    },
    T,
  );
});
