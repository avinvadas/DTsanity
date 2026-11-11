import { describe, expect, it } from 'vitest';
import { isLoadError, parseSource } from '../src/io/load';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { partCandidates, pointPart, rangeNotes, sameValue, sizePx, styleCss, typeStyle, typographyIds, typographyIdsIn } from '../src/semantic/typography';
import { addFiles, allModels, clearAll, store } from '../src/state/app';
import { analyze } from '../src/validate';
import { readFixture } from './helpers';

const ON = { ...DEFAULT_SETTINGS, acceptLegacy: true };
const load = (name: string) => {
  const r = parseSource({ name: name.split('/').at(-1)!, text: readFixture(`typography/${name}`), origin: 'file' }, ON);
  if (isLoadError(r)) throw new Error(r.message);
  return r;
};
const split = analyze([load('split/primitives.tokens.json'), load('split/semantic.tokens.json')], ON);

describe('typography styles of a tier', () => {
  it('lists the semantic styles, not the base parts', () => {
    expect(typographyIds(split, 'semantic')).toEqual(['text.display', 'text.heading', 'text.body', 'text.label', 'text.code']);
    expect(typographyIds(split, 'base')).toEqual([]);
  });

  it('reads each part as a reference or a value of its own', () => {
    const label = typeStyle(split.tokens.get('text.label')!);
    expect(label.parts.find((p) => p.key === 'fontSize')).toMatchObject({ ref: 'font.size.200', value: { value: 0.875, unit: 'rem' } });
    expect(label.parts.find((p) => p.key === 'lineHeight')).toMatchObject({ literal: '20px' });
  });

  it('offers tokens of the part type only, by type rather than name', () => {
    const ids = (key: Parameters<typeof partCandidates>[2]) => partCandidates(split, 'text.body', key).flatMap((g) => g.tokens.map((t) => t.id));
    expect(ids('fontWeight')).toEqual(['font.weight.regular', 'font.weight.medium', 'font.weight.semibold', 'font.weight.bold']);
    expect(ids('lineHeight')).toEqual(['font.line-height.tight', 'font.line-height.snug', 'font.line-height.normal']);
    // Dimensions: sizes and tracking alike, both groups.
    expect(ids('fontSize')).toContain('font.tracking.none');
    expect(ids('fontSize')[0]).toBe('font.size.100');
  });

  it('puts the group other styles use for the part first', () => {
    expect(partCandidates(split, 'text.label', 'letterSpacing')[0]!.label).toContain('font.tracking');
  });

  it('marks tokens with the same value as a part of its own', () => {
    const own = { semantic: { text: { $type: 'typography', caption: { $value: { fontFamily: '{font.family.sans}', fontSize: '{font.size.100}', fontWeight: 400, letterSpacing: '0px', lineHeight: 1.5 } } } } };
    const src = parseSource({ name: 'own.tokens.json', text: JSON.stringify(own), origin: 'file' }, ON);
    if (isLoadError(src)) throw new Error(src.message);
    const m = analyze([load('split/primitives.tokens.json'), src], ON);
    const same = (key: Parameters<typeof partCandidates>[2]) => partCandidates(m, 'semantic.text.caption', key).flatMap((g) => g.tokens).filter((t) => t.same).map((t) => t.id);
    expect(same('lineHeight')).toEqual(['font.line-height.normal']);
    expect(same('fontWeight')).toEqual(['font.weight.regular']);
    expect(same('letterSpacing')).toEqual(['font.tracking.none']);
    expect(sameValue('fontSize', '16px', { value: 16, unit: 'px' })).toBe(true);
    expect(sameValue('fontWeight', 'bold', 700)).toBe(true);
    expect(sameValue('fontFamily', 'Inter, sans-serif', ['Inter', 'sans-serif'])).toBe(true);
    expect(sameValue('letterSpacing', { value: 0, unit: 'rem' }, { value: 0, unit: 'px' })).toBe(true);
  });

  it('writes only the reference of the part, in the file it is read from', () => {
    const edits = pointPart([split], 'text.body', 'fontWeight', 'font.weight.medium');
    const t = split.tokens.get('text.body')!;
    expect(edits).toEqual([{ fileId: t.fileId, path: ['text', 'body', '$value', 'fontWeight'], value: '{font.weight.medium}' }]);
  });

  it('writes the edit once when several themes read the same file', () => {
    expect(pointPart([split, split], 'text.body', 'fontSize', 'font.size.400')).toHaveLength(1);
  });

  it('renders a resolved style as CSS', () => {
    expect(styleCss(split.tokens.get('text.display')!.value as Record<string, unknown>)).toEqual({
      fontFamily: '"Source Serif 4", "Georgia", serif',
      fontSize: '2.441rem',
      fontWeight: '700',
      lineHeight: '1.2',
      letterSpacing: '-0.02rem',
    });
  });
});

describe('modes', () => {
  it('shows a style in every mode and writes one reference when the style itself has no modes', () => {
    clearAll();
    addFiles([load('modes/typography.modes.tokens.json')]);
    const models = allModels(store.get());
    expect(models.length).toBe(2);
    expect(typographyIdsIn(models, 'semantic')).toEqual(['text.body', 'text.heading']);
    const sizes = models.map((m) => (m.tokens.get('text.body')!.value as { fontSize: unknown }).fontSize);
    expect(sizes).toEqual([{ value: 1, unit: 'rem' }, { value: 0.9375, unit: 'rem' }]);
    expect(pointPart(models, 'text.body', 'fontSize', 'font.size.heading')).toHaveLength(1);
  });
});

describe('range checks', () => {
  const st = (id: string, size: number, weight = 400, extra: Record<string, unknown> = {}) => ({
    id,
    value: { fontFamily: ['Inter', 'sans-serif'], fontSize: { value: size, unit: 'px' }, fontWeight: weight, lineHeight: 1.5, letterSpacing: { value: 0, unit: 'px' }, ...extra },
  });
  const codes = (notes: ReturnType<typeof rangeNotes>) => notes.map((n) => `${n.code} ${n.ids.join(',')}`);

  it('reads sizes in px and rem', () => {
    expect(sizePx({ value: 0.875, unit: 'rem' })).toBe(14);
    expect(sizePx('18px')).toBe(18);
    expect(sizePx({ value: 1, unit: 'em' })).toBeUndefined();
  });

  it('flags styles that look the same, but not an alias of another', () => {
    expect(codes(rangeNotes([st('a', 16), st('b', 16)]))).toEqual(['same a,b']);
    expect(rangeNotes([st('a', 16), { ...st('b', 16), aliasOf: 'a' }])).toEqual([]);
  });

  it('flags neighbouring sizes too close with the same weight only', () => {
    expect(codes(rangeNotes([st('a', 16), st('b', 15)]))).toEqual(['close a,b']);
    expect(rangeNotes([st('a', 16), st('b', 15, 700)])).toEqual([]);
    expect(rangeNotes([st('a', 20), st('b', 16)])).toEqual([]);
  });

  it('flags text under 12px', () => {
    expect(codes(rangeNotes([st('tiny', 11)]))).toEqual(['small tiny']);
    expect(rangeNotes([st('ok', 12)])).toEqual([]);
  });
});

describe('a style that aliases another', () => {
  it('reads its parts from the style it leads to', () => {
    const own = { semantic: { text: { $type: 'typography', base: { $value: { fontFamily: '{font.family.sans}', fontSize: '{font.size.300}', fontWeight: '{font.weight.regular}', letterSpacing: '{font.tracking.none}', lineHeight: '{font.line-height.normal}' } }, copy: { $value: '{semantic.text.base}' }, copy2: { $value: '{semantic.text.copy}' } } } };
    const src = parseSource({ name: 'own.tokens.json', text: JSON.stringify(own), origin: 'file' }, ON);
    if (isLoadError(src)) throw new Error(src.message);
    const m = analyze([load('split/primitives.tokens.json'), src], ON);
    const st = typeStyle(m.tokens.get('semantic.text.copy2')!, m);
    expect(st.inherited).toBe(true);
    expect(st.parts.find((p) => p.key === 'fontSize')?.ref).toBe('font.size.300');
    // Changing one part gives the style its own parts, with that one changed.
    const [edit] = pointPart([m], 'semantic.text.copy2', 'fontSize', 'font.size.400');
    expect(edit).toMatchObject({ path: ['semantic', 'text', 'copy2', '$value'], value: { fontFamily: '{font.family.sans}', fontSize: '{font.size.400}', lineHeight: '{font.line-height.normal}' } });
  });
});
