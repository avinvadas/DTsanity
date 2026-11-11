import { describe, expect, it } from 'vitest';
import { isLoadError, parseSource } from '../src/io/load';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { pointColor } from '../src/semantic/pairs';
import { addFiles, applyEdits, clearAll, store } from '../src/state/app';

const doc = {
  color: {
    $type: 'color',
    a: { $value: '#000000' },
    b: { $value: '#ffffff' },
    c: { $value: '#ff0000' },
    // Its modes make Desktop and Mobile themes.
    size: { $value: '{color.a}', $extensions: { mode: { desktop: '{color.a}', mobile: '{color.b}' } } },
    // Read as the plain $value by both modes.
    text: { $value: '{color.a}' },
    line: { $type: 'border', $value: { color: '{color.a}', width: { value: 1, unit: 'px' }, style: 'solid' } },
  },
};

describe('a pick in one mode', () => {
  const load = () => {
    clearAll();
    const src = parseSource({ name: 'modes.tokens.json', text: JSON.stringify(doc), origin: 'file' }, DEFAULT_SETTINGS);
    if (isLoadError(src)) throw new Error(src.message);
    addFiles([src]);
    const tms = store.get().themeModels;
    expect(tms.map((t) => t.theme.scope.mode)).toEqual(['desktop', 'mobile']);
    return tms;
  };
  const valueIn = (mode: string, id: string) => store.get().themeModels.find((t) => t.theme.scope.mode === mode)!.model.tokens.get(id)!.rawValue;

  it('goes into that mode’s entry when the modes share $value, leaving the other mode alone', () => {
    const tms = load();
    const edit = pointColor(tms[1]!.model, 'color.text', 'color.c', 'mobile')!;
    expect(edit.path).toEqual(['color', 'text', '$extensions', 'mode', 'mobile']);
    applyEdits('test', [edit]);
    expect(valueIn('mobile', 'color.text')).toBe('{color.c}');
    expect(valueIn('desktop', 'color.text')).toBe('{color.a}');
  });

  it('writes a whole border into the mode entry, with its color changed', () => {
    const tms = load();
    const edit = pointColor(tms[0]!.model, 'color.line', 'color.c', 'desktop')!;
    expect(edit).toMatchObject({ path: ['color', 'line', '$extensions', 'mode', 'desktop'], value: { color: '{color.c}', style: 'solid' } });
  });

  it('edits a mode entry that already exists in place', () => {
    const tms = load();
    expect(pointColor(tms[1]!.model, 'color.size', 'color.c', 'mobile')!.path).toEqual(['color', 'size', '$extensions', 'mode', 'mobile']);
  });
});
