import { beforeEach, describe, expect, it } from 'vitest';
import { fixPrompt } from '../src/io/prompt';
import { addFiles, clearAll, setLoadErrors, store } from '../src/state/app';
import { loadFixture, loadText } from './helpers';
import { findings, findingTotal } from '../src/ui/findings';
import { copiedLabel } from '../src/ui/prompt-link';
import { pairsOf } from '../src/state/pairs';

beforeEach(() => clearAll());

const ok = (l: number, h = 250, c = 0.05) => ({ $value: { colorSpace: 'oklch', components: [l, c, h] } });

describe('fix prompt', () => {
  it('lists format issues by rule, with the rule’s basis, problem and check, and each place numbered', () => {
    addFiles([loadFixture('dtcg-broken.tokens.json')]);
    const { text, count } = fixPrompt(store.get());
    expect(count).toBeGreaterThan(0);
    expect(text).toMatch(/^# Findings in design token files/);
    expect(text).toMatch(/\n# Required \(\d+\)\n/);
    expect(text).toMatch(/## Broken reference \[unresolved-reference\] \(\d+\)\n\nBasis: Required · DTCG Format 7\.2 Reference Resolution\nProblem: .+\nDone when: .+\n/);
    expect(text).toMatch(/\n- #\d+ dtcg-broken\.tokens\.json(:\d+ › `[^`]+`)?: /);
    // It reports; the fix is the design system's: no one-click fix is offered as the answer.
    expect(text).not.toMatch(/Fix:|Did you mean/);
    expect(text).toContain('Closest existing name: {color.base}.');
  });

  it('lists failing contrast pairs with the levels they miss', () => {
    addFiles([
      loadText(JSON.stringify({ color: { $type: 'color', gray: { 100: ok(0.95), 300: ok(0.85) } } }), 'primitives.tokens.json'),
      loadText(JSON.stringify({ color: { $type: 'color', bg: { default: { $value: '{color.gray.100}' } }, text: { default: { $value: '{color.gray.300}' } } } }), 'semantic.tokens.json'),
    ]);
    const { text } = fixPrompt(store.get());
    expect(text).toContain('## Low text contrast [contrast-text] (1)');
    // The evidence: the ratio, both colors, and the references each token follows to its value.
    expect(text).toMatch(/- #1 `color\.text\.default` on `color\.bg\.default` \(text\): below AA text \(4\.5\): has \d\.\d\d, #[0-9a-f]{6} on #[0-9a-f]{6}\. References: `color\.text\.default` → `color\.gray\.300`; `color\.bg\.default` → `color\.gray\.100`\.$/m);
  });

  it('lists a pair that fails in several themes once, naming each theme, as the page counts it', () => {
    const base = (hi: number, lo: number) => JSON.stringify({ color: { $type: 'color', gray: { 100: ok(hi), 300: ok(lo) } } });
    addFiles([
      loadText(base(0.95, 0.85), 'light.tokens.json'),
      loadText(base(0.2, 0.3), 'dark.tokens.json'),
      loadText(JSON.stringify({ color: { $type: 'color', bg: { default: { $value: '{color.gray.100}' } }, text: { default: { $value: '{color.gray.300}' } } } }), 'semantic.tokens.json'),
    ]);
    expect(store.get().themes.length).toBe(2);
    const p = fixPrompt(store.get());
    expect(p.text).toContain('## Low text contrast [contrast-text] (1)');
    const lines = p.text.split('\n').filter((l) => l.startsWith('- #1 `color.text.default` on `color.bg.default`'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/: below AA text \(4\.5\) in (light|dark) \(has [^)]+\) and (dark|light) \(has [^)]+\)\. References: /);
    expect(p.count).toBe(findingTotal(findings(store.get())));
  });

  it('lists a disabled pair below its level without counting it, as WCAG asks it for no contrast', () => {
    addFiles([
      loadText(JSON.stringify({ color: { $type: 'color', gray: { 100: ok(0.95), 300: ok(0.85) } } }), 'primitives.tokens.json'),
      loadText(JSON.stringify({ color: { $type: 'color', bg: { disabled: { $value: '{color.gray.100}' } }, text: { disabled: { $value: '{color.gray.300}' } } } }), 'semantic.tokens.json'),
    ]);
    const rows = pairsOf(store.get()).rows;
    expect(rows.map((r) => [r.pair.fg, r.pass, r.tone])).toEqual([['color.text.disabled', false, 'info']]);
    expect(findings(store.get()).contrast).toEqual([]);
    expect(fixPrompt(store.get()).text).not.toContain('contrast-');
  });

  it('says what it copied in the page’s units, with the rest apart', () => {
    expect(copiedLabel({ text: 'x', count: 591, more: 78 })).toBe('Copied 591 corrections, plus 78 other findings');
    expect(copiedLabel({ text: 'x', count: 1, more: 0 })).toBe('Copied 1 correction');
    expect(copiedLabel({ text: 'x', count: 0, more: 2 })).toBe('Copied 2 other findings');
    expect(copiedLabel({ text: '', count: 0, more: 0 }, 'Nothing to fix')).toBe('Nothing to fix');
  });

  it('states only the rules that apply to what it lists, and puts advice after what is required', () => {
    addFiles([
      loadText(JSON.stringify({ color: { $type: 'color', gray: { 100: ok(0.95, 250, 0.02), 300: ok(0.85, 250, 0.02) } } }), 'primitives.tokens.json'),
      loadText(JSON.stringify({ color: { $type: 'color', bg: { default: { $value: '{color.gray.100}' } }, text: { default: { $value: '{color.gray.300}' } } } }), 'semantic.tokens.json'),
    ]);
    const required = fixPrompt(store.get()).text;
    expect(required).toContain('How to work through it:');
    expect(required, 'nothing advisory listed, no advice rule').not.toContain('Advice comes from');
    expect(required).not.toContain('# Advice');
    clearAll();
    addFiles([loadText(JSON.stringify({ base: { $type: 'color', a: { $value: '{base.b}' }, b: ok(0.5) }, color: { $type: 'color', x: { $value: '{color.missing}' } } }), 'base.tokens.json')]);
    const both = fixPrompt(store.get()).text;
    expect(both).toContain('- Advice comes from common conventions');
    expect(both.indexOf('# Required')).toBeLessThan(both.indexOf('# Advice'));
    expect(both).toMatch(/## Base token is an alias \[tier-base-reference\] \(2\)\n\nBasis: Advice · DTsanity convention: .+\nProblem: .+\nDone when: .+\nDecline if: .+\n/);
  });

  it('asks every time for changes that keep the design and add nothing new, with a report', () => {
    addFiles([loadFixture('dtcg-broken.tokens.json')]);
    const text = fixPrompt(store.get()).text;
    for (const rule of [
      'How to get there is yours to decide, by your design system’s own rules',
      'the value every other token resolves to in every theme',
      '- A change must not cause a finding of its own',
      '- End with a report that lists every finding by its number (#1, #2…): done, or declined and why.',
    ])
      expect(text).toContain(rule);
  });

  it('says where a property beside “$value” belongs when it changes the value', () => {
    const t = { color: { $type: 'color', veil: { $value: { colorSpace: 'srgb', components: [0, 0, 0] }, alpha: 0.4 } } };
    addFiles([loadText(JSON.stringify(t, null, 2), 'alpha.tokens.json')]);
    const text = fixPrompt(store.get()).text;
    expect(text).toMatch(/## Token contains children \[token-has-children\] \(1\)\n\nBasis: .+\nProblem: .+\nDone when: .*inside “\$value” if it changes the value/);
    expect(text).toMatch(/- #1 alpha\.tokens\.json:\d+ › `color\.veil\.alpha`: “alpha” sits beside “\$value”/);
  });

  it('lists one rule broken in several places of a file once, naming each place', () => {
    const text = '{\n  "size": {\n    "a": { "$value": "1px" },\n    "b": { "$value": "2px" },\n    "c": { "$value": "3px" }\n  },\n  "color": { "$type": "color", "x": { "$value": "{size.zz}" }, "y": { "$value": "{size.yy}" } }\n}\n';
    addFiles([loadText(text, 'set.tokens.json')]);
    const p = fixPrompt(store.get());
    const section = (rule: string) => p.text.split('\n## ').find((x) => x.includes(`[${rule}]`))!.split('\n').filter((l) => l.startsWith('- #'));
    const missing = section('missing-type');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/^- #\d+ set\.tokens\.json: .* In 3 places: `size\.a` \(line 3\), `size\.b` \(line 4\), `size\.c` \(line 5\)\.$/);
    // Messages that differ only in what they quote: one line, each place with its own quote, and no fix offered.
    const broken = section('unresolved-reference');
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatch(/\{…\}.* In 2 places: `color\.x` \(line 7; \{size\.zz\}, \{size\.a\}\), `color\.y` \(line 7; \{size\.yy\}, \{size\.a\}\)\.$/);
    expect(p.text).toMatch(/# Required \(6\)/);
  });

  it('covers only the findings in its scope', () => {
    addFiles([loadFixture('dtcg-broken.tokens.json')]);
    const all = fixPrompt(store.get());
    const first = store.get().model.issues.find((i) => i.severity !== 'info')!;
    const one = fixPrompt(store.get(), { issue: (i) => i.code === first.code && i.target === first.target && i.message === first.message });
    expect(one.count).toBe(1);
    expect(all.count).toBeGreaterThan(1);
    expect(fixPrompt(store.get(), {}).count).toBe(0);
  });

  it('lists typography alerts and files that couldn’t be read, each in their own scope', () => {
    const style = { fontFamily: ['Inter'], fontSize: { value: 16, unit: 'px' }, fontWeight: 400, lineHeight: 1.5, letterSpacing: { value: 0, unit: 'px' } };
    addFiles([loadText(JSON.stringify({ semantic: { type: { $type: 'typography', body: { $value: style }, copy: { $value: style } } } }), 'semantic.tokens.json')]);
    setLoadErrors([{ name: 'broken.json', message: 'Unexpected end of file.', line: 3, col: 1 }]);
    const all = fixPrompt(store.get()).text;
    expect(all).toMatch(/## File couldn't be read \[unreadable-file\] \(1\)\n\nBasis: .+\nProblem: .+\nDone when: .+\n\n- #1 `broken\.json` \(line 3, column 1\): Unexpected end of file\./);
    expect(all).toContain('## Styles look the same [type-same] (1)');
    expect(all).toMatch(/semantic\.type\.body, semantic\.type\.copy look the same/);
    expect(all).toContain('First make the files that couldn’t be read valid');
    // Nothing in them was checked, so they come before every other correction.
    expect(all.indexOf("## File couldn't be read")).toBeLessThan(all.indexOf('## Styles look the same'));
    // Not counted on the Issues page, so counted apart.
    expect(fixPrompt(store.get(), { typography: true })).toMatchObject({ count: 0, more: 1 });
    expect(fixPrompt(store.get(), { files: true })).toMatchObject({ count: 0, more: 1 });
  });

  it('is empty when every check passes', () => {
    addFiles([loadText(JSON.stringify({ color: { $type: 'color', $description: 'Base', white: { ...ok(1, 0, 0), $description: 'White' } } }), 'primitives.tokens.json')]);
    const p = fixPrompt(store.get());
    if (p.count + p.more) console.log(p.text);
    expect(p).toEqual({ text: '', count: 0, more: 0 });
  });
});
