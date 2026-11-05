import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { checkPair, detectPairs } from '../src/semantic/pairs';
import { checkSiblings, detectSiblings } from '../src/semantic/siblings';
import { analyze } from '../src/validate';
import { loadText } from './helpers';

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return { $value: { colorSpace: 'srgb', components: [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], hex: h } };
};

describe('sibling detection', () => {
  it('groups tokens that differ only in a status word, per role', () => {
    const groups = detectSiblings(['text.danger', 'text.success', 'text.warning', 'bg.danger', 'bg.success', 'text.default', 'icon.danger']);
    expect(groups).toEqual([
      { id: 'text.*', members: ['text.danger', 'text.success', 'text.warning'] },
      { id: 'bg.*', members: ['bg.danger', 'bg.success'] },
    ]);
  });

  it('keeps other modifiers apart and leaves palettes out', () => {
    expect(detectSiblings(['bg.danger.subtle', 'bg.success.subtle', 'bg.danger', 'danger.500', 'success.500']).map((g) => g.id)).toEqual(['bg.*.subtle']);
  });
});

describe('checks with color-vision deficiencies', () => {
  // A red and a green of similar lightness: distinct for typical vision, alike for deuteranopia.
  const doc = {
    color: {
      $type: 'color',
      bg: { default: hex('#ffffff'), danger: hex('#d23c3c'), success: hex('#3c8c3c') },
      text: { danger: hex('#d23c3c'), success: hex('#2e7d32') },
    },
  };
  const model = analyze([loadText(JSON.stringify(doc))], DEFAULT_SETTINGS);

  it('finds status colors that collapse for deuteranopia but not for tritanopia', () => {
    const [group] = detectSiblings(['color.bg.danger', 'color.bg.success']);
    const r = checkSiblings(group!, model, 0.1)!;
    const at = (v: string) => r.results.find((x) => x.vision === v)!;
    expect(at('normal').pass).toBe(true);
    expect(at('deutan').pass).toBe(false);
    expect(at('tritan').pass).toBe(true);
    expect(at('deutan').closest).toEqual(['color.bg.danger', 'color.bg.success']);
  });

  it('checks pair contrast on the simulated colors', () => {
    const pair = detectPairs(['color.bg.danger', 'color.text.danger', 'color.bg.default']).find((p) => p.fg === 'color.text.danger')!;
    // Same color on same color: 1:1 whatever the vision.
    for (const v of ['normal', 'protan', 'achroma'] as const) expect(checkPair(pair, model, ['wcag'], v)!.values.wcag).toBeCloseTo(1, 3);
  });
});
