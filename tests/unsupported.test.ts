import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S } from '../src/model/defaults';
import { parseSource } from '../src/io/load';
import { analyze } from '../src/validate';
import { loadText } from './helpers';

/** A file in neither DTCG nor a supported legacy format is flagged once, for the file, saying why. */

const flags = (text: string, name = 'x.json') => analyze([loadText(text, name)], S).issues.filter((i) => i.code === 'unsupported-format' || i.code === 'no-tokens');
const c = (hex: string) => ({ colorSpace: 'srgb', components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), hex });
const five = <T>(make: (i: number) => T) => Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`t${i}`, make(i)]));

describe('unsupported formats', () => {
  it('flags values per mode inside "$value", and names them', () => {
    const [issue] = flags(JSON.stringify({ color: five(() => ({ $type: 'color', $value: { light: '#ffffff', dark: '#000000' } })) }));
    expect(issue?.code).toBe('unsupported-format');
    expect(issue?.message).toMatch(/5 of the 5 tokens .* one value per mode inside “\$value” \(“light”, “dark”\)/);
  });

  it('flags a file with values but no tokens', () => {
    const [issue] = flags(JSON.stringify({ primary: '#0055ff', secondary: '#ff5500' }));
    expect([issue?.code, issue?.severity]).toEqual(['unsupported-format', 'warning']);
  });

  it('keeps "No tokens" for a file with nothing in it', () => {
    expect(flags('{"$description": "empty"}').map((i) => i.code)).toEqual(['no-tokens']);
  });

  it('leaves DTCG files alone, even with a few problems, and Tokens Studio types too', () => {
    expect(flags(JSON.stringify({ color: { ...five((i) => ({ $type: 'color', $value: c(`#00000${i}`) })), bad: { $type: 'color', $value: 'nope' } } }))).toEqual([]);
    expect(flags(JSON.stringify({ size: five((i) => ({ $type: 'fontSizes', $value: `${i * 4}px` })) }))).toEqual([]);
  });
});

describe('JSON that isn’t design tokens', () => {
  const read = (text: string, name = 'x.json') => parseSource({ name, text, origin: 'file' });
  it('is set aside, not checked: a translation file, a config, a form with “value” fields', () => {
    for (const text of ['{"greeting": "Hello", "bye": "Bye"}', '{"port": 8080, "debug": true}', '{"field": {"value": "Your name", "label": "Name"}}', '{}', '[1, 2]']) {
      expect(read(text)).toMatchObject({ skipped: true });
    }
  });
  it('is kept when it looks meant as tokens: any DTCG key, a misspelled one too, or design values', () => {
    for (const text of ['{"a": {"$valeu": 1}}', '{"$description": "empty"}', '{"primary": "#0055ff"}', '{"space": {"value": "4px"}}', '{"c": {"value": "x", "type": "color"}}']) {
      expect('skipped' in read(text)).toBe(false);
    }
  });
  it('keeps the files that describe a set: Tokens Studio metadata and resolvers', () => {
    expect('skipped' in read('{"tokenSetOrder": []}', '$metadata.json')).toBe(false);
    expect('skipped' in read('{"resolutionOrder": []}', 'themes.resolver.json')).toBe(false);
  });
});
