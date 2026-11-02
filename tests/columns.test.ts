import { describe, expect, it } from 'vitest';
import { looksLikeRamp, type Palette, type Swatch } from '../src/palette/detect';
import { columnOf, stacks, stepGroups } from '../src/palette/columns';
import type { OrderKind } from '../src/palette/order';

const pal = (id: string, order: OrderKind, steps: string[], included = true) => ({ id, order, included, swatches: steps.map((step) => ({ step })) }) as unknown as Palette;
const shape = (ps: Palette[]) => stepGroups(ps).map((g) => ({ columns: g.columns, ids: g.palettes.map((p) => p.id) }));

describe('step groups', () => {
  it('lines up palettes on one scale and leaves gaps for missing steps', () => {
    const groups = shape([pal('blue', 'numeric', ['50', '100', '500', '900']), pal('red', 'numeric', ['100', '300', '500', '900', '950'])]);
    expect(groups).toEqual([{ columns: ['50', '100', '300', '500', '900', '950'], ids: ['blue', 'red'] }]);
  });

  it('keeps unrelated schemes in separate groups', () => {
    const groups = shape([pal('blue', 'numeric', ['100', '200', '300']), pal('gray', 'numeric', ['1', '2', '3', '4']), pal('accent', 'named', ['light', 'base', 'dark'])]);
    expect(groups.map((g) => g.ids)).toEqual([['blue'], ['gray'], ['accent']]);
  });

  it('orders named steps by their scale and appends off-scale names', () => {
    const groups = shape([pal('a', 'named', ['light', 'dark']), pal('b', 'named', ['light', 'base', 'dark', 'muted'])]);
    expect(groups[0]!.columns).toEqual(['light', 'base', 'dark', 'muted']);
  });
});

describe('stacks with hidden palettes', () => {
  const ids = (ps: Palette[]) => ps.map((p) => p.id);
  it('keeps a hidden palette in file order inside the grid it matches', () => {
    const { stacks: s } = stacks([pal('blue', 'numeric', ['100', '200']), pal('teal', 'numeric', ['100', '200'], false), pal('red', 'numeric', ['100', '200'])]);
    expect(s).toHaveLength(1);
    expect(ids(s[0]!.members)).toEqual(['blue', 'teal', 'red']);
    expect(ids(s[0]!.palettes)).toEqual(['blue', 'red']);
  });

  it('puts a hidden palette that matches no grid after the palette before it, without adding columns', () => {
    const { stacks: s } = stacks([pal('blue', 'numeric', ['100', '200']), pal('misc', 'file', ['sky', 'sun'], false)]);
    expect(ids(s[0]!.members)).toEqual(['blue', 'misc']);
    expect(s[0]!.columns).toEqual(['100', '200']);
  });

  it('returns hidden palettes as orphans when nothing is shown', () => {
    expect(ids(stacks([pal('misc', 'file', ['a'], false)]).orphans)).toEqual(['misc']);
  });
});

describe('placing named steps by lightness', () => {
  const lit = (id: string, order: OrderKind, steps: [string, number][]) =>
    ({ id, order, included: true, swatches: steps.map(([step, l]) => ({ step, info: { oklch: { l, c: 0.1, h: 300, alpha: 1 } } })) }) as unknown as Palette;
  const ramp: [string, number][] = [['100', 0.95], ['300', 0.8], ['500', 0.6], ['700', 0.42], ['900', 0.25]];

  it('puts each named step under the numbered column closest in lightness', () => {
    const groups = stepGroups([lit('violet', 'numeric', ramp), lit('accent', 'named', [['light', 0.83], ['base', 0.6], ['dark', 0.4]])]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.palettes.map((p) => p.id)).toEqual(['violet', 'accent']);
    expect(columnOf(groups[0]!, 'accent', 'light')).toBe('300');
    expect(columnOf(groups[0]!, 'accent', 'base')).toBe('500');
    expect(columnOf(groups[0]!, 'accent', 'dark')).toBe('700');
    expect(columnOf(groups[0]!, 'violet', '500')).toBe('500');
  });

  it('keeps steps in order, even when two are closest to the same column', () => {
    const g = stepGroups([lit('violet', 'numeric', ramp), lit('accent', 'named', [['light', 0.62], ['base', 0.58]])])[0]!;
    expect(new Set([columnOf(g, 'accent', 'light'), columnOf(g, 'accent', 'base')]).size).toBe(2);
  });

  it('leaves a palette in its own grid when its lightness fits no columns', () => {
    const groups = stepGroups([lit('violet', 'numeric', ramp), lit('odd', 'named', [['light', 0.5], ['base', 0.51], ['dark', 0.52], ['darker', 0.53], ['darkest', 0.54]])]);
    expect(groups.map((g) => g.palettes.map((p) => p.id))).toEqual([['violet'], ['odd']]);
  });
});

describe('file-order ramps', () => {
  const sw = (l: number, h: number) => ({ info: { oklch: { l, c: Number.isNaN(h) ? 0 : 0.1, h, alpha: 1 } } }) as unknown as Pick<Swatch, 'info'>;
  it('counts one hue going one way in lightness as a ramp', () => {
    expect(looksLikeRamp([sw(0.9, 250), sw(0.7, 255), sw(0.5, 260)])).toBe(true);
    expect(looksLikeRamp([sw(0.2, NaN), sw(0.5, NaN), sw(0.9, NaN)])).toBe(true);
    // Hue spread across 0°.
    expect(looksLikeRamp([sw(0.9, 350), sw(0.7, 10), sw(0.5, 20)])).toBe(true);
  });
  it('rejects unrelated colors such as white, black and an accent', () => {
    expect(looksLikeRamp([sw(1, NaN), sw(0, NaN), sw(0.55, 260)])).toBe(false);
    expect(looksLikeRamp([sw(0.8, 30), sw(0.6, 140), sw(0.4, 260)])).toBe(false);
  });
});
