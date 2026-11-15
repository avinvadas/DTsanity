import { beforeEach, describe, expect, it } from 'vitest';
import { fixPrompt } from '../src/io/prompt';
import { addFiles, clearAll, setLoadErrors, store } from '../src/state/app';
import { loadFixture, loadText } from './helpers';
import { findings, findingTotal } from '../src/ui/findings';
import { copiedLabel } from '../src/ui/prompt-link';

beforeEach(() => clearAll());

const ok = (l: number, h = 250, c = 0.05) => ({ $value: { colorSpace: 'oklch', components: [l, c, h] } });

describe('fix prompt', () => {
  it('lists format issues with their file, token and suggested fix', () => {
    addFiles([loadFixture('dtcg-broken.tokens.json')]);
    const { text, count } = fixPrompt(store.get());
    expect(count).toBeGreaterThan(0);
    expect(text).toMatch(/^# Corrections for design token files/);
    expect(text).toContain('## Errors');
    expect(text).toMatch(/dtcg-broken\.tokens\.json:\d+ › `[^`]+`: Broken reference \[unresolved-reference\]\. \{/);
  });

  it('lists failing contrast pairs with the levels they miss', () => {
    addFiles([
      loadText(JSON.stringify({ color: { $type: 'color', gray: { 100: ok(0.95), 300: ok(0.85) } } }), 'primitives.tokens.json'),
      loadText(JSON.stringify({ color: { $type: 'color', bg: { default: { $value: '{color.gray.100}' } }, text: { default: { $value: '{color.gray.300}' } } } }), 'semantic.tokens.json'),
    ]);
    const { text } = fixPrompt(store.get());
    expect(text).toContain('## Contrast (1)');
    expect(text).toMatch(/`color\.text\.default` on `color\.bg\.default` \(text\): below AA text \(4\.5\), has \d/);
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
    expect(p.text).toContain('## Contrast (1)');
    const lines = p.text.split('\n').filter((l) => l.startsWith('- `color.text.default` on `color.bg.default`'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/: below AA text \(4\.5\) in (light|dark) \(has [^)]+\) and (dark|light) \(has [^)]+\)\.$/);
    expect(p.count).toBe(findingTotal(findings(store.get())));
  });

  it('says what it copied in the page’s units, with the rest apart', () => {
    expect(copiedLabel({ text: 'x', count: 591, more: 78 })).toBe('Copied 591 corrections, plus 78 other findings');
    expect(copiedLabel({ text: 'x', count: 1, more: 0 })).toBe('Copied 1 correction');
    expect(copiedLabel({ text: 'x', count: 0, more: 2 })).toBe('Copied 2 other findings');
    expect(copiedLabel({ text: '', count: 0, more: 0 }, 'Nothing to fix')).toBe('Nothing to fix');
  });

  it('states only the rules that apply to what it lists', () => {
    addFiles([loadFixture('dtcg-broken.tokens.json')]);
    const format = fixPrompt(store.get()).text;
    expect(format).toContain('Rules (DTsanity changes the format, never the design):');
    expect(format).not.toContain('To fix contrast');
    clearAll();
    addFiles([
      loadText(JSON.stringify({ color: { $type: 'color', gray: { 100: ok(0.95), 300: ok(0.85) } } }), 'primitives.tokens.json'),
      loadText(JSON.stringify({ color: { $type: 'color', bg: { default: { $value: '{color.gray.100}' } }, text: { default: { $value: '{color.gray.300}' } } } }), 'semantic.tokens.json'),
    ]);
    const contrast = fixPrompt(store.get()).text;
    expect(contrast).toContain('- To fix contrast, prefer pointing');
    expect(contrast, 'no property findings, no property rule').not.toContain('Keep what a property does');
  });

  it('asks every time for changes that keep the design and add nothing new, with a report', () => {
    addFiles([loadFixture('dtcg-broken.tokens.json')]);
    const text = fixPrompt(store.get()).text;
    for (const rule of [
      '- Change only what the corrections below list.',
      'every token must resolve to the same value in every theme',
      '- A correction must not create a new problem',
      '- End with a report, per file: the changes you made; the corrections you didn’t make, and why; and every token whose value changed',
    ])
      expect(text).toContain(rule);
  });

  it('says where a property beside “$value” belongs when it changes the value', () => {
    const t = { color: { $type: 'color', veil: { $value: { colorSpace: 'srgb', components: [0, 0, 0] }, alpha: 0.4 } } };
    addFiles([loadText(JSON.stringify(t, null, 2), 'alpha.tokens.json')]);
    const text = fixPrompt(store.get()).text;
    expect(text).toContain('- Keep what a property does.');
    expect(text).toMatch(/\[token-has-children\]\. “alpha” sits beside “\$value”.* it belongs inside “\$value”/);
  });

  it('lists one rule broken in several places of a file once, naming each place', () => {
    const text = '{\n  "size": {\n    "a": { "$value": "1px" },\n    "b": { "$value": "2px" },\n    "c": { "$value": "3px" }\n  },\n  "color": { "$type": "color", "x": { "$value": "{size.zz}" }, "y": { "$value": "{size.yy}" } }\n}\n';
    addFiles([loadText(text, 'set.tokens.json')]);
    const p = fixPrompt(store.get());
    const missing = p.text.split('\n').filter((l) => l.includes('[missing-type]'));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/^- set\.tokens\.json: .*\[missing-type\]\. .* In 3 places: `size\.a` \(line 3\), `size\.b` \(line 4\), `size\.c` \(line 5\)\.$/);
    // Messages that differ only in what they quote: one line, each place with its own quote.
    const broken = p.text.split('\n').filter((l) => l.includes('[unresolved-reference]'));
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatch(/\{…\}.* In 2 places: `color\.x` \(line 7; \{size\.zz\} → \{size\.a\}\), `color\.y` \(line 7; \{size\.yy\} → \{size\.a\}\)\.$/);
    expect(p.text).toMatch(/## Errors \(5\)/);
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
    expect(all).toContain("## Files that couldn't be read (1)\n\n- `broken.json` (line 3, column 1): Unexpected end of file.");
    expect(all).toContain('## Typography (1)');
    expect(all).toMatch(/semantic\.type\.body, semantic\.type\.copy look the same/);
    expect(all).toContain('First make the files that couldn’t be read valid');
    // Nothing in them was checked, so they come before every other correction.
    expect(all.indexOf("## Files that couldn't be read")).toBeLessThan(all.indexOf('## Typography'));
    expect(all.indexOf("## Files that couldn't be read")).toBeLessThan(all.indexOf('## Warnings') === -1 ? Infinity : all.indexOf('## Warnings'));
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
