import { describe, expect, it } from 'vitest';
import { colorInfo } from '../src/color/format';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { aliasCandidates, applyPairEdits, checkPair, colorTokenIds, describedSurface, detectPairs, glyphOf, isInactive, NO_PAIR_EDITS, over, pageBackground, pairId, pointColor, realias } from '../src/semantic/pairs';
import { analyze } from '../src/validate';
import { loadText } from './helpers';

const ids = (pairs: { fg: string; bg: string }[]) => pairs.map((p) => `${p.fg} on ${p.bg}`);

describe('pair detection', () => {
  it('pairs foregrounds with the backgrounds that share their modifiers', () => {
    const pairs = detectPairs(['color.bg.default', 'color.bg.danger', 'color.text.default', 'color.text.danger', 'color.icon.danger']);
    expect(ids(pairs)).toEqual([
      'color.text.default on color.bg.default',
      'color.text.danger on color.bg.danger',
      'color.icon.danger on color.bg.danger',
    ]);
    expect(pairs.find((p) => p.fg === 'color.icon.danger')!.kind).toBe('ui');
  });

  it('checks a foreground with no matching background on the default one', () => {
    expect(ids(detectPairs(['bg.default', 'surface', 'text.subtle.hover']))).toEqual(['text.subtle.hover on bg.default', 'text.subtle.hover on surface']);
  });

  it('pairs within the same naming shape when several backgrounds qualify', () => {
    // A modes file with color.fg/color.bg loaded beside color.fg.default/color.bg.default.
    expect(ids(detectPairs(['color.bg.default', 'color.fg.default', 'color.bg', 'color.fg']))).toEqual([
      'color.fg.default on color.bg.default',
      'color.fg on color.bg',
    ]);
  });

  it('reads a name by its last role word: what comes before names what it belongs to', () => {
    const pairs = detectPairs(['bgColor.default', 'button.default.bgColor.rest', 'button.outline.bgColor.rest', 'button.outline.fgColor.rest']);
    // The outline button's background is a background, and its text sits on it, not on the default button.
    expect(ids(pairs)).toEqual(['button.outline.fgColor.rest on button.outline.bgColor.rest']);
    expect(pairs[0]!.kind).toBe('text');
  });

  it('checks a border on what surrounds its shape, never on the fill it surrounds (WCAG 1.4.11)', () => {
    expect(ids(detectPairs(['bg.default', 'card.bg', 'card.border', 'card.text']))).toEqual(['card.border on bg.default', 'card.text on card.bg']);
  });

  it('tells disabled and inactive pairs apart: WCAG asks them for no contrast', () => {
    expect(isInactive({ fg: 'button.fgColor.disabled', bg: 'button.bgColor.disabled' })).toBe(true);
    expect(isInactive({ fg: 'tab.text.inactive', bg: 'bg.default' })).toBe(true);
    expect(isInactive({ fg: 'button.fgColor.rest', bg: 'button.bgColor.rest' })).toBe(false);
  });

  it('reads hyphenated and camelCase names', () => {
    expect(ids(detectPairs(['color.bg-warning', 'color.textWarning']))).toEqual(['color.textWarning on color.bg-warning']);
  });

  it('pairs on-X with X, keeping containers apart (Material)', () => {
    const pairs = detectPairs(['sys.primary', 'sys.on-primary', 'sys.primary-container', 'sys.on-primary-container', 'sys.surface', 'sys.on-surface']);
    expect(ids(pairs)).toEqual([
      'sys.on-primary on sys.primary',
      'sys.on-primary-container on sys.primary-container',
      'sys.on-surface on sys.surface',
    ]);
  });

  it('leaves palette steps and unrelated tokens alone', () => {
    expect(detectPairs(['color.gray.100', 'color.blue.500', 'color.accent'])).toEqual([]);
  });

  it('applies user additions, removals and kind changes', () => {
    const detected = detectPairs(['bg.default', 'text.default', 'border.default']);
    const border = pairId('border.default', 'bg.default');
    const added = { id: pairId('text.default', 'bg.raised'), fg: 'text.default', bg: 'bg.raised', kind: 'text' as const, source: 'user' as const };
    const out = applyPairEdits(detected, { added: [added], removed: [pairId('text.default', 'bg.default')], kinds: { [border]: 'text' } });
    expect(out.map((p) => [p.id, p.kind])).toEqual([
      [border, 'text'],
      [added.id, 'text'],
    ]);
    expect(applyPairEdits(detected, NO_PAIR_EDITS)).toEqual(detected);
  });
});

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return { colorSpace: 'srgb', components: [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], hex: h };
};

describe('pair checks', () => {
  const doc = {
    color: {
      $type: 'color',
      gray: {
        0: { $value: hex('#ffffff') },
        500: { $value: hex('#767676') },
        300: { $value: hex('#949494') },
      },
      bg: { default: { $value: '{color.gray.0}' } },
      text: { default: { $value: '{color.gray.500}' } },
      icon: { default: { $value: '{color.gray.300}' } },
    },
  };
  const model = analyze([loadText(JSON.stringify(doc))], DEFAULT_SETTINGS);
  const pairs = detectPairs(colorTokenIds([model]));

  it('holds text to the text level and UI parts to the non-text level', () => {
    const text = checkPair(pairs.find((p) => p.fg === 'color.text.default')!, model, ['wcag'])!;
    expect(text.values.wcag).toBeCloseTo(4.54, 2);
    expect(text.results.map((r) => [r.level.id, r.pass])).toEqual([['aa', true]]);
    const icon = checkPair(pairs.find((p) => p.fg === 'color.icon.default')!, model, ['wcag'])!;
    expect(icon.results.map((r) => r.level.id)).toEqual(['aa-large']);
    expect(icon.pass).toBe(true);
    // AAA is reported where reached, never required: 4.54 passes WCAG 2.2.
    expect(text.pass).toBe(true);
  });

  it('is undefined when a token is missing in the theme', () => {
    expect(checkPair({ id: 'x', fg: 'color.text.default', bg: 'color.bg.gone', kind: 'text', source: 'user' }, model, ['wcag'])).toBeUndefined();
  });

  it('measures a translucent background as it shows over the page background', () => {
    // A ghost button: light text on 16% white, on a dark page. On its own, white at full opacity would fail.
    const dark = {
      color: {
        $type: 'color',
        bg: { default: { $value: hex('#18171d') }, hover: { $value: { colorSpace: 'srgb', components: [1, 1, 1], alpha: 0.16 } } },
        text: { hover: { $value: hex('#ecebea') } },
      },
    };
    const m = analyze([loadText(JSON.stringify(dark))], DEFAULT_SETTINGS);
    const ids = colorTokenIds([m]);
    expect(pageBackground(ids)).toBe('color.bg.default');
    const pair = { id: 'p', fg: 'color.text.hover', bg: 'color.bg.hover', kind: 'text' as const, source: 'user' as const };
    expect(checkPair(pair, m, ['wcag'])!.pass).toBe(false);
    const seen = checkPair(pair, m, ['wcag'], 'normal', 'standard', pageBackground(ids))!;
    expect(seen.values.wcag).toBeGreaterThan(9);
    expect(seen.under?.bg.oklch.alpha).toBeCloseTo(0.16, 2);
    expect(seen.bg.oklch.alpha).toBe(1);
  });

  it('blends a translucent foreground over its background', () => {
    const half = colorInfo({ colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5 })!;
    const white = colorInfo({ colorSpace: 'srgb', components: [1, 1, 1] })!;
    const shown = over(half, white);
    expect(shown.oklch.alpha).toBe(1);
    expect(shown.oklch.l).toBeGreaterThan(0.55);
    expect(shown.oklch.l).toBeLessThan(0.65);
  });

  it('offers base colors as alias targets, grouped by palette', () => {
    expect(aliasCandidates(model)).toEqual([{ label: 'Base · color.gray', tokens: expect.any(Array) }]);
    expect(aliasCandidates(model)[0]!.tokens.map((t) => t.id)).toEqual(['color.gray.0', 'color.gray.300', 'color.gray.500']);
  });

  it('offers a semantic token base tokens only, never itself', () => {
    const groups = aliasCandidates(model, 'color.bg.default');
    expect(groups.map((g) => g.label)).toEqual(['Base · color.gray']);
    const ids = groups.flatMap((g) => g.tokens.map((t) => t.id));
    expect(ids).not.toContain('color.bg.default');
  });

  it('re-points an alias in its own file without writing a value', () => {
    const edit = realias(model, 'color.text.default', 'color.gray.300')!;
    expect(edit).toEqual({ fileId: model.files[0]!.id, path: ['color', 'text', 'default', '$value'], value: '{color.gray.300}' });
    expect(realias(model, 'color.gray.500', 'color.gray.0')).toBeUndefined();
  });

  it('points a color with a value of its own at a token, replacing the value', () => {
    expect(pointColor(model, 'color.gray.500', 'color.gray.0')).toEqual({ fileId: model.files[0]!.id, path: ['color', 'gray', '500', '$value'], value: '{color.gray.0}' });
  });
});

describe('composite border tokens', () => {
  const gray = (v: number) => ({ $value: { colorSpace: 'srgb', components: [v, v, v] } });
  const doc = {
    color: { $type: 'color', gray: { 0: gray(1), 200: gray(0.8), 600: gray(0.35) }, bg: { default: { $value: '{color.gray.0}' } } },
    border: {
      $type: 'border',
      input: { $value: { color: '{color.gray.200}', width: { value: 1, unit: 'px' }, style: 'solid' } },
      focus: { $value: '{border.input}' },
      raw: { $value: { color: { colorSpace: 'srgb', components: [0, 0, 0] }, width: { value: 1, unit: 'px' }, style: 'solid' } },
    },
  };
  const model = analyze([loadText(JSON.stringify(doc))], DEFAULT_SETTINGS);

  it('pairs a border by its color part, as a UI part', () => {
    const pairs = detectPairs(colorTokenIds([model]));
    const input = pairs.find((p) => p.fg === 'border.input')!;
    expect(input).toMatchObject({ bg: 'color.bg.default', kind: 'ui' });
    expect(checkPair(input, model, ['wcag'])!.values.wcag).toBeLessThan(3);
  });

  it('re-points only the color reference of a border', () => {
    expect(realias(model, 'border.input', 'color.gray.600')).toEqual({ fileId: model.files[0]!.id, path: ['border', 'input', '$value', 'color'], value: '{color.gray.600}' });
    // An alias of a whole border, or a literal color, has no color reference of its own.
    expect(realias(model, 'border.focus', 'color.gray.600')).toBeUndefined();
    expect(realias(model, 'border.raw', 'color.gray.600')).toBeUndefined();
  });
});

describe('glyphOf', () => {
  it('draws borders and outlines as a line around the background', () => {
    expect(glyphOf({ fg: 'color.border.danger', kind: 'ui' })).toBe('border');
    expect(glyphOf({ fg: 'button.primary.outline', kind: 'ui' })).toBe('border');
    expect(glyphOf({ fg: 'focusRing', kind: 'ui' })).toBe('border');
    expect(glyphOf({ fg: 'color.icon.danger', kind: 'ui' })).toBe('ui');
    expect(glyphOf({ fg: 'color.text.danger', kind: 'text' })).toBe('text');
    // Set to text by hand: drawn as text.
    expect(glyphOf({ fg: 'color.border.danger', kind: 'text' })).toBe('text');
  });
});

/**
 * What the reviewed sample systems taught pairing (corpus/README.md): a pair
 * is checked only where the system shows it is seen together.
 */
describe('pairing needs evidence of use', () => {
  it('reads the surface a description puts a token on', () => {
    expect(describedSurface('Use for blue text on subtle blue accent backgrounds when there is no meaning tied to the color.')).toEqual([['subtle', 'blue', 'accent']]);
    expect(describedSurface('Use for links on inverse or dark surfaces.')).toEqual([['inverse'], ['dark']]);
    expect(describedSurface('Border color for tiles on layer 01')).toEqual([['layer', '01']]);
    expect(describedSurface('Used for the label text color on a dark background color.')).toEqual([['dark']]);
    // What it isn't on, or no surface at all: nothing to require.
    expect(describedSurface('Use for blue borders on non-bold backgrounds.')).toBeUndefined();
    expect(describedSurface('Use for links in a default or hovered state.')).toBeUndefined();
  });

  it('pairs a foreground only with a background of the surface its description names', () => {
    const tokens = ['color.background.accent.blue.bolder', 'color.background.accent.blue.subtle', 'color.text.accent.blue.bolder', 'color.text.accent.blue.subtle'];
    const subtle = new Map([['color.text.accent.blue.bolder', 'Use for blue text on subtle blue accent backgrounds.']]);
    // By name alone, "bolder" text goes with the "bolder" background; its description says otherwise.
    expect(ids(detectPairs(tokens))).toContain('color.text.accent.blue.bolder on color.background.accent.blue.bolder');
    expect(ids(detectPairs(tokens, new Set(), subtle))).not.toContain('color.text.accent.blue.bolder on color.background.accent.blue.bolder');
    // Described for a surface that isn't among its candidates: not checked at all.
    const dark = new Map([['label.dark.text.color', 'Used for the label text color on a dark background color.']]);
    expect(ids(detectPairs(['background.color.default', 'label.dark.text.color'], new Set(), dark))).toEqual([]);
    // A described surface the background does have keeps the pair.
    const inverse = new Map([['link-inverse', 'Use for links on inverse or dark surfaces.']]);
    expect(ids(detectPairs(['background-inverse', 'link-inverse'], new Set(), inverse))).toEqual(['link-inverse on background-inverse']);
  });

  it('lists subtle, muted and decorative lines as exempt, not required (WCAG 1.4.11)', () => {
    expect(isInactive({ fg: 'border.muted', bg: 'bgColor.default' })).toBe(true);
    expect(isInactive({ fg: 'color.accent.border-subtle', bg: 'background-default' })).toBe(true);
    expect(isInactive({ fg: 'button-separator', bg: 'background' })).toBe(true);
    expect(isInactive({ fg: 'border.emphasis', bg: 'bgColor.default' })).toBe(false);
    // Subtle text is still text: only lines are exempt this way.
    expect(isInactive({ fg: 'text.subtle', bg: 'bg.default' })).toBe(false);
  });

  it('doesn’t check what can’t be seen: a transparent color, or a color the same as its background', () => {
    const c = (r: number, g: number, b: number, alpha?: number) => ({ $value: { colorSpace: 'srgb', components: [r, g, b], ...(alpha === undefined ? {} : { alpha }) } });
    const doc = {
      $type: 'color',
      bg: { default: c(1, 1, 1), clear: c(1, 1, 1, 0) },
      border: { gone: c(0.9, 0.9, 0.9, 0), faint: c(0.9, 0.9, 0.9) },
      text: { hidden: c(1, 1, 1), clear: c(0, 0, 0) },
    };
    const model = analyze([loadText(JSON.stringify(doc))], DEFAULT_SETTINGS);
    const pair = (fg: string, bg: string) => ({ id: pairId(fg, bg), fg, bg, kind: 'ui' as const, source: 'name' as const });
    expect(checkPair(pair('border.gone', 'bg.default'), model, ['wcag'])).toBeUndefined();
    expect(checkPair(pair('text.clear', 'bg.clear'), model, ['wcag'])).toBeUndefined();
    expect(checkPair(pair('text.hidden', 'bg.default'), model, ['wcag'])).toBeUndefined();
    // A visible border is still measured.
    expect(checkPair(pair('border.faint', 'bg.default'), model, ['wcag'])!.pass).toBe(false);
  });
});
