import { beforeEach, describe, expect, it } from 'vitest';
import { isUnchanged } from '../src/io/export';
import { addFiles, addPair, adjustments, applyEdits, clearAll, revertAll, setPins, store } from '../src/state/app';
import { loadText } from './helpers';

/**
 * Reload files either keeps everything changed in the tool or reverts all of
 * it. Reverting leaves nothing behind: file edits and their history, pair
 * changes, palette choices. Settings are preferences and stay.
 */

beforeEach(() => clearAll());

const text = JSON.stringify({
  color: {
    $type: 'color',
    gray: { '0': { $value: '#ffffff' }, '900': { $value: '#111111' } },
    text: { default: { $value: '{color.gray.900}' } },
    bg: { default: { $value: '{color.gray.0}' } },
  },
});

describe('reverting on reload', () => {
  it('lists what was changed in the tool, and nothing when nothing was', () => {
    addFiles([loadText(text, 'set.tokens.json')]);
    expect(adjustments(store.get())).toEqual([]);
    const f = store.get().files[0]!;
    applyEdits('Point text at white', [{ fileId: f.id, path: ['color', 'text', 'default', '$value'], value: '{color.gray.0}' }]);
    addPair('color.gray.900', 'color.gray.0', 'text');
    setPins('color.gray', ['900']);
    expect(adjustments(store.get())).toHaveLength(3);
  });

  it('reverts every change: files, history, pairs and palette choices; settings stay', () => {
    addFiles([loadText(text, 'set.tokens.json')]);
    const f = store.get().files[0]!;
    const settings = store.get().settings;
    applyEdits('Point text at white', [{ fileId: f.id, path: ['color', 'text', 'default', '$value'], value: '{color.gray.0}' }]);
    addPair('color.gray.900', 'color.gray.0', 'text');
    setPins('color.gray', ['900']);
    revertAll([{ ...loadText(text, 'set.tokens.json'), id: f.id }]);
    const s = store.get();
    expect(s.files.every(isUnchanged)).toBe(true);
    expect(s.past).toEqual([]);
    expect(adjustments(s)).toEqual([]);
    expect(s.settings).toBe(settings);
  });
});
