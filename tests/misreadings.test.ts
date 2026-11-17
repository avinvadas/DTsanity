import { describe, expect, it } from 'vitest';
import { isLoadError, parseSource } from '../src/io/load';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { tiersOf } from '../src/model/tiers';
import { detectPalettes } from '../src/palette/detect';
import { detectPairs } from '../src/semantic/pairs';
import { contrastRule } from '../src/state/pairs';
import { analyze } from '../src/validate';
import { loadText } from './helpers';

/**
 * Misreadings the first fix-prompt rounds found: DTsanity reported something
 * the files don't say, and the assistants declined it. Each is written here
 * as a small file of its own shape, not as a sample.
 */

const ON = { ...DEFAULT_SETTINGS, acceptLegacy: true };
const legacy = (name: string, data: unknown) => {
  const r = parseSource({ name, text: JSON.stringify(data), origin: 'file' }, ON);
  if (isLoadError(r)) throw new Error(r.message);
  return analyze([r], ON);
};
const rules = (m: ReturnType<typeof analyze>) => m.issues.map((i) => i.code);

describe('older files with values written as DTCG writes them', () => {
  const dim = (value: number) => ({ value, unit: 'px' });
  const m = legacy('sd.json', {
    props: {
      SHADOW: {
        type: 'shadow',
        value: { color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.3 }, offsetX: dim(0), offsetY: dim(1), blur: dim(3), spread: dim(0) },
      },
      BORDER: { type: 'border', value: { color: '#C1C7CF', width: { value: 0.0625, unit: 'rem' }, style: 'solid' } },
    },
  });

  it('reads a composite holding unit objects as one token, not a group', () => {
    expect(m.tokens.get('props.SHADOW')).toMatchObject({ type: 'shadow', resolution: 'ok' });
    expect(m.tokens.has('props.SHADOW.value.offsetX')).toBe(false);
    expect(rules(m)).not.toContain('invalid-node');
  });

  it('keeps colors and dimensions already in DTCG form', () => {
    expect(rules(m)).not.toContain('legacy-conversion');
    expect(rules(m)).not.toContain('invalid-value');
  });
});

describe('tiers', () => {
  it('reads a raw palette that other tokens point at through originalValue as the base, whatever its group is called', () => {
    const m = legacy('raw.json', {
      aliases: { MONTEVERDE: { value: '#00a698' }, PANJIN: { value: '#d1435b' } },
      props: {
        COLOR_SYSTEM_GREEN: { type: 'color', value: 'rgb(0, 166, 152)', originalValue: '{!MONTEVERDE}' },
        COLOR_SYSTEM_RED: { type: 'color', value: 'rgb(209, 67, 91)', originalValue: '{!PANJIN}' },
      },
    });
    const tiers = tiersOf(m);
    expect(tiers.get('aliases.MONTEVERDE')).toBe('base');
    // "system" in a token's own name names no layer; the props point at the palette, so they read as semantic.
    expect(tiers.get('props.COLOR_SYSTEM_GREEN')).toBe('semantic');
    expect(rules(m)).not.toContain('tier-hardcoded');
    expect(rules(m)).not.toContain('tier-base-reference');
  });

  it('reads a group that points at another group of a base-named file as semantic', () => {
    const c = { $value: { colorSpace: 'srgb', components: [1, 1, 1] } };
    const m = analyze([loadText(JSON.stringify({ aliases: { $type: 'color', WHITE: c }, props: { $type: 'color', CANVAS_DAY: { $value: '{aliases.WHITE}' } } }), 'base.raw.json')], DEFAULT_SETTINGS);
    expect(tiersOf(m).get('aliases.WHITE')).toBe('base');
    expect(tiersOf(m).get('props.CANVAS_DAY')).toBe('semantic');
    expect(rules(m)).not.toContain('tier-base-reference');
  });

  it('still flags a token of a base-named file that points at another file', () => {
    const c = { $value: { colorSpace: 'srgb', components: [1, 1, 1] } };
    const m = analyze(
      [loadText(JSON.stringify({ gray: { $type: 'color', 0: c } }), 'palette.json'), loadText(JSON.stringify({ color: { $type: 'color', white: { $value: '{gray.0}' } } }), 'base.json')],
      DEFAULT_SETTINGS,
    );
    expect(rules(m)).toContain('tier-base-reference');
  });

  it('still reads an alias group of references as semantic', () => {
    const c = { $value: { colorSpace: 'srgb', components: [0, 0, 1] } };
    const m = analyze([loadText(JSON.stringify({ base: { $type: 'color', blue: c }, aliases: { $type: 'color', link: { $value: '{base.blue}' }, raw: c } }))], DEFAULT_SETTINGS);
    expect(tiersOf(m).get('aliases.raw')).toBe('semantic');
  });
});

describe('scales', () => {
  it('leaves state variants of a step out of the scale', () => {
    const g = (l: number) => ({ $value: { colorSpace: 'srgb', components: [l, l, l] } });
    const m = analyze(
      [loadText(JSON.stringify({ gray: { $type: 'color', 10: g(0.95), 50: g(0.6), 90: g(0.15), 100: g(0.05), '90Hover': g(0.25), '100Hover': g(0.2) } }))],
      DEFAULT_SETTINGS,
    );
    const set = detectPalettes(m, {}, 'srgb');
    expect(set.palettes.find((p) => p.id === 'gray')!.swatches.map((s) => s.step)).toEqual(['10', '50', '90', '100']);
    expect(set.palettes[0]!.flags.map((f) => f.kind)).not.toContain('inversion');
    expect(set.loose.map((s) => s.step)).toEqual(['90Hover', '100Hover']);
  });
});

describe('pairs', () => {
  const pairs = (ids: string[]) => detectPairs(ids).map((p) => `${p.fg} on ${p.bg}`);

  it('pairs no "on-color" token with the page: it names no fill', () => {
    expect(pairs(['background', 'text-primary', 'text-on-color', 'icon-on-color'])).toEqual(['text-primary on background']);
  });

  it('pairs states of an inverse foreground with the inverse background', () => {
    expect(pairs(['background', 'background-inverse', 'link-inverse', 'link-inverse-visited'])).toEqual([
      'link-inverse on background-inverse',
      'link-inverse-visited on background-inverse',
    ]);
  });

  it('leaves a component’s inverse text on the page default, not the inverse background', () => {
    expect(pairs(['background', 'background-inverse', 'notification-action-tertiary-inverse-text'])).toEqual(['notification-action-tertiary-inverse-text on background']);
  });

  it('reads a token its own description calls a background as one, whatever its name says', () => {
    const ids = ['background', 'text-primary', 'content-switcher-selected'];
    expect(pairs(ids)).toContain('content-switcher-selected on background');
    expect(detectPairs(ids, new Set(['content-switcher-selected'])).map((p) => `${p.fg} on ${p.bg}`)).not.toContain('content-switcher-selected on background');
  });

  it('checks separators and dividers as borders (advice), not as required UI parts', () => {
    const [pair] = detectPairs(['background', 'button-separator']);
    expect(contrastRule(pair!)).toBe('contrast-border');
  });
});
