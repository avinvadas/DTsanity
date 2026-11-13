import { beforeEach, describe, expect, it } from 'vitest';
import { fixPrompt } from '../src/io/prompt';
import { addFiles, clearAll, setLoadErrors, store } from '../src/state/app';
import { loadFixture, loadText } from './helpers';

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

  it('states only the rules that apply to what it lists', () => {
    addFiles([loadFixture('dtcg-broken.tokens.json')]);
    const format = fixPrompt(store.get()).text;
    expect(format).toContain('Rules (DTsanity changes the format, never the design):');
    expect(format).toContain('- List every change you make, per file.');
    expect(format).not.toContain('To fix contrast');
    clearAll();
    addFiles([
      loadText(JSON.stringify({ color: { $type: 'color', gray: { 100: ok(0.95), 300: ok(0.85) } } }), 'primitives.tokens.json'),
      loadText(JSON.stringify({ color: { $type: 'color', bg: { default: { $value: '{color.gray.100}' } }, text: { default: { $value: '{color.gray.300}' } } } }), 'semantic.tokens.json'),
    ]);
    expect(fixPrompt(store.get()).text).toContain('- To fix contrast, prefer pointing');
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
    expect(fixPrompt(store.get(), { typography: true }).count).toBe(1);
    expect(fixPrompt(store.get(), { files: true }).count).toBe(1);
  });

  it('is empty when every check passes', () => {
    addFiles([loadText(JSON.stringify({ color: { $type: 'color', $description: 'Base', white: { ...ok(1, 0, 0), $description: 'White' } } }), 'primitives.tokens.json')]);
    const p = fixPrompt(store.get());
    if (p.count) console.log(p.text);
    expect(p).toEqual({ text: '', count: 0 });
  });
});
