import { beforeEach, describe, expect, it } from 'vitest';
import { fixPrompt } from '../src/io/prompt';
import { addFiles, clearAll, store } from '../src/state/app';
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
    expect(text).toContain('dtcg-broken.tokens.json › `');
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

  it('is empty when every check passes', () => {
    addFiles([loadText(JSON.stringify({ color: { $type: 'color', $description: 'Base', white: { ...ok(1, 0, 0), $description: 'White' } } }), 'primitives.tokens.json')]);
    const p = fixPrompt(store.get());
    if (p.count) console.log(p.text);
    expect(p).toEqual({ text: '', count: 0 });
  });
});
