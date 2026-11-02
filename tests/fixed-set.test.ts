import { beforeEach, describe, expect, it } from 'vitest';
import { changesMarkdown, diffTokens } from '../src/io/changes';
import { fixedSet } from '../src/io/export';
import { crc32 } from '../src/io/zip';
import { addFiles, applyEdits, clearAll, store, undo } from '../src/state/app';
import { loadText } from './helpers';

beforeEach(() => clearAll());

describe('token diff', () => {
  it('reports a changed value, an added and a removed token by path', () => {
    const before = { color: { $type: 'color', red: { $value: '#f00' }, old: { $value: '#000' } } };
    const after = { color: { $type: 'color', red: { $value: '#e00' }, fresh: { $value: '#fff' } } };
    expect(diffTokens(before, after)).toEqual([
      { path: 'color.red', kind: 'changed', before: '#f00', after: '#e00' },
      { path: 'color.old', kind: 'removed', before: { $value: '#000' } },
      { path: 'color.fresh', kind: 'added', after: { $value: '#fff' } },
    ]);
  });
});

describe('fixed set', () => {
  const setup = () =>
    addFiles([
      loadText(JSON.stringify({ color: { $type: 'color', blue: { 500: { $value: '#2563eb' } } } }, null, 2), 'primitives.tokens.json'),
      loadText(JSON.stringify({ color: { $type: 'color', link: { $value: '{color.blue.500}' } } }, null, 2), 'semantic.tokens.json'),
    ]);

  it('lists only real changes per file, and the actions in order', () => {
    setup();
    const prim = store.get().files[0]!;
    applyEdits('Darken blue 500', [{ fileId: prim.id, path: ['color', 'blue', '500', '$value'], value: '#1d4ed8' }]);
    const md = changesMarkdown(store.get(), new Map(), new Date('2026-11-02'));
    expect(md).toContain('1 change in 1 of 2 files.');
    expect(md).toContain('## primitives.tokens.json\n\n- `color.blue.500`: `#2563eb` → `#1d4ed8`');
    expect(md).toContain('## Unchanged\n\n- semantic.tokens.json');
    expect(md).toContain('1. Darken blue 500');
    undo();
    expect(changesMarkdown(store.get())).toContain('0 changes in 0 of 2 files.');
  });

  it('packs every file and CHANGES.md into one folder', () => {
    setup();
    const bytes = fixedSet(store.get());
    const text = new TextDecoder().decode(bytes);
    for (const name of ['tokens-fixed/primitives.tokens.json', 'tokens-fixed/semantic.tokens.json', 'tokens-fixed/CHANGES.md']) expect(text).toContain(name);
    // End of central directory: three entries.
    const end = new DataView(bytes.buffer, bytes.length - 22);
    expect(end.getUint32(0, true)).toBe(0x06054b50);
    expect(end.getUint16(10, true)).toBe(3);
  });

  it('checksums like zip tools do', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
