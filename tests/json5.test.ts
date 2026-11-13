import { describe, expect, it } from 'vitest';
import { deleteIn, parseJson, renameIn, serialize, setIn, toJS } from '../src/json/cst';
import { addFiles, clearAll, store } from '../src/state/app';
import { loadText } from './helpers';

/** JSON5 (and JSONC) files read as they are, and saved in their own syntax. */

const PRIMER_LIKE = `// Primer writes its tokens in JSON5
{
  label: {
    /* the green label */
    green: {
      bgColor: {
        $value: '{base.color.green.0}', // a reference
        $type: 'color',
        $extensions: {
          'org.primer.figma': { scopes: ['bgColor',], },
        },
      },
    },
  },
  size: { $value: { value: .5, unit: 'rem' }, $type: 'dimension' },
  hex: 0xff,
  big: +Infinity,
  quote: 'it\\'s "here"',
  multi: 'one \\
two',
}
`;

describe('JSON5', () => {
  it('reads every JSON5 form and gives back every byte', () => {
    const { doc } = parseJson(PRIMER_LIKE, { json5: true });
    expect(serialize(doc)).toBe(PRIMER_LIKE);
    expect(toJS(doc.root)).toEqual({
      label: { green: { bgColor: { $value: '{base.color.green.0}', $type: 'color', $extensions: { 'org.primer.figma': { scopes: ['bgColor'] } } } } },
      size: { $value: { value: 0.5, unit: 'rem' }, $type: 'dimension' },
      hex: 255,
      big: Infinity,
      quote: `it's "here"`,
      multi: 'one two',
    });
  });

  it('is not JSON: strict reading still refuses it', () => {
    expect(() => parseJson(PRIMER_LIKE)).toThrow();
    expect(() => parseJson('{"a": 1,}')).toThrow(/Trailing commas/);
  });

  it('writes new keys and strings the way the file does, keeping comments and trailing commas', () => {
    const { doc } = parseJson(PRIMER_LIKE, { json5: true });
    const added = serialize(setIn(doc, ['label', 'green', 'bgColor', '$description'], 'Green label'));
    expect(added).toContain(`$description: 'Green label',`);
    expect(added).toContain('// a reference');
    expect(added).toContain('/* the green label */');

    const renamed = serialize(renameIn(doc, ['label', 'green'], 'success-green'));
    expect(renamed).toContain(`'success-green': {`);

    const removed = serialize(deleteIn(doc, ['multi']));
    expect(removed.trimEnd().endsWith(`quote: 'it\\'s "here"',\n}`)).toBe(true);
  });

  it('keeps a JSONC file in double quotes', () => {
    const jsonc = '{\n  // colors\n  "a": { "$value": "#fff", "$type": "color" },\n}\n';
    const { doc } = parseJson(jsonc, { json5: true });
    expect(serialize(doc)).toBe(jsonc);
    expect(serialize(setIn(doc, ['a', '$description'], 'White'))).toContain('"$description": "White"');
  });
});

describe('loading JSON5 and JSONC files', () => {
  it('reads .json5 and .jsonc files as they are', () => {
    clearAll();
    addFiles([loadText(PRIMER_LIKE, 'label.json5'), loadText('{\n  // c\n  "x": { "$value": 1, "$type": "number" },\n}', 'x.jsonc')]);
    const s = store.get();
    expect(s.files.map((f) => f.syntax)).toEqual(['json5', 'json5']);
    expect(s.model.tokens.get('label.green.bgColor')?.rawValue).toBe('{base.color.green.0}');
    expect(s.model.issues.filter((i) => i.code === 'json5-syntax')).toEqual([]);
  });

  it('reads a .json file that isn’t strict JSON, and says so', () => {
    clearAll();
    addFiles([loadText('{\n  // a comment\n  "x": { "$value": 1, "$type": "number" },\n}', 'tokens.json')]);
    const s = store.get();
    expect(s.model.tokens.has('x')).toBe(true);
    expect(s.model.issues.map((i) => i.code)).toContain('json5-syntax');
  });
});
