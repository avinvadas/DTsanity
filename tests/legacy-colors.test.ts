import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { addFiles, clearAll, store, updateSettings } from '../src/state/app';
import { pairsOf } from '../src/state/pairs';
import { palettesOf } from '../src/state/palettes';
import { loadText } from './helpers';

/**
 * Colors written as CSS strings ("#0c1927") are a legacy form: read as colors
 * exactly when legacy formats are accepted, as legacy files are, and reported
 * as legacy values either way.
 */

const file = () =>
  loadText(
    JSON.stringify({
      base: { $type: 'color', blue: { '100': { $value: '#dbeafe' }, '500': { $value: '#3b82f6' }, '900': { $value: '#1e3a8a' } } },
      color: { $type: 'color', bg: { default: { $value: '{base.blue.100}' } }, text: { default: { $value: '{base.blue.500}' } } },
    }),
    'tokens.json',
  );

function load(acceptLegacy: boolean) {
  clearAll();
  updateSettings({ ...DEFAULT_SETTINGS, acceptLegacy });
  addFiles([file()]);
  return store.get();
}

describe('colors written as CSS strings', () => {
  it('are left out, and counted, with legacy formats off', () => {
    const s = load(false);
    const set = palettesOf(s);
    expect([set.palettes.length, set.legacySkipped]).toEqual([0, 3]);
    expect(pairsOf(s).rows.every((r) => r.seen.normal.every((c) => !c))).toBe(true);
    expect(s.model.issues.filter((i) => i.code === 'legacy-value')).toHaveLength(3);
  });

  it('are read as colors with legacy formats on, and still reported', () => {
    const s = load(true);
    const set = palettesOf(s);
    expect([set.palettes.map((p) => p.id), set.legacySkipped]).toEqual([['base.blue'], 0]);
    expect(pairsOf(s).rows.find((r) => r.pair.fg === 'color.text.default')?.seen.normal[0]).toBeTruthy();
    expect(s.model.issues.filter((i) => i.code === 'legacy-value')).toHaveLength(3);
  });
});
