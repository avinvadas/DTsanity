import { describe, expect, it } from 'vitest';
import { fileNameOf } from '../src/io/export';
import { isLoadError, parseSource, pastedSource } from '../src/io/load';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import type { SourceFile } from '../src/model/types';
import { analyze } from '../src/validate';

/** Pasted code is checked like a file; references outside it are one note, not broken references. */

const load = (text: string, taken: string[] = []) => {
  const r = parseSource(pastedSource(text, taken), DEFAULT_SETTINGS);
  if (isLoadError(r)) throw new Error(r.message);
  return r as SourceFile;
};

describe('pasted JSON', () => {
  it('is named Pasted code, then Pasted code 2 and so on, and downloads as a file', () => {
    expect(pastedSource('{}').name).toBe('Pasted code');
    expect(pastedSource('{}', ['Pasted code']).name).toBe('Pasted code 2');
    expect(pastedSource('{}', ['Pasted code', 'Pasted code 2']).name).toBe('Pasted code 3');
    expect(pastedSource('{}').origin).toBe('paste');
    expect(fileNameOf(pastedSource('{}', ['Pasted code']))).toBe('pasted-code-2.json');
  });

  it('reads a bare token, and a group copied without its braces', () => {
    const token = load('{"$type": "color", "$value": "#ff0000"}');
    expect([...analyze([token], DEFAULT_SETTINGS).tokens.keys()]).toEqual(['pasted']);
    const group = load('"text": { "$type": "color", "primary": { "$value": "#111111" } }');
    expect([...analyze([group], DEFAULT_SETTINGS).tokens.keys()]).toEqual(['text.primary']);
  });

  it('says once that references point outside what was pasted, instead of a broken reference each', () => {
    const f = load('{"text": {"$type": "color", "a": {"$value": "{color.gray.900}"}, "b": {"$value": "{color.gray.600}"}}}');
    const codes = analyze([f], DEFAULT_SETTINGS).issues.map((i) => i.code);
    expect(codes).not.toContain('unresolved-reference');
    const note = analyze([f], DEFAULT_SETTINGS).issues.find((i) => i.code === 'outside-reference')!;
    expect(note.severity).toBe('info');
    expect(note.message).toBe('2 references point to tokens outside what was pasted. Paste or load those too.');
  });

  it('still reports a broken reference in a file that was loaded, not pasted', () => {
    const r = parseSource({ name: 'tokens.json', text: '{"a": {"$type": "color", "$value": "{missing}"}}', origin: 'file' }, DEFAULT_SETTINGS) as SourceFile;
    expect(analyze([r], DEFAULT_SETTINGS).issues.map((i) => i.code)).toContain('unresolved-reference');
  });
});
