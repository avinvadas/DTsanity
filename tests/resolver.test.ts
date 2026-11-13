import { describe, expect, it } from 'vitest';
import { readFiles } from '../src/io/load';
import { findFile, resolvePath } from '../src/model/build';
import { addFiles, clearAll, store } from '../src/state/app';
import { loadText } from './helpers';

/** DTCG resolver documents, "$ref" pointers across files, and files read from folders by path. */

const c = (hex: string) => ({ colorSpace: 'srgb', components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), hex });
const json = (v: unknown) => JSON.stringify(v, null, 2);

/** A set laid out like Carbon's: a palette package next to a themes package with a resolver. */
function carbonLike() {
  const palette = { gray: { $type: 'color', '10': { $value: c('#f4f4f4') }, '100': { $value: c('#161616') } }, white: { $type: 'color', $value: c('#ffffff') } };
  const theme = (bg: string, fg: string) => ({
    background: { $type: 'color', $value: `{${bg}}` },
    'text-primary': { $type: 'color', $value: `{${fg}}` },
    // A palette color at 12% opacity, through pointers into the palette file.
    'background-hover': { $type: 'color', $value: { colorSpace: { $ref: `#/${fg.replace('.', '/')}/$value/colorSpace` }, components: { $ref: `#/${fg.replace('.', '/')}/$value/components` }, alpha: 0.12 } },
  });
  const resolver = {
    $schema: 'https://www.designtokens.org/schemas/2025.10/resolver.json',
    version: '2025.10',
    sets: { palette: { sources: [{ $ref: '../../colors/tokens/colors.tokens.json' }] } },
    modifiers: {
      theme: {
        contexts: {
          white: [{ $ref: 'themes/white/theme.tokens.json' }],
          g100: [{ $ref: 'themes/g100/theme.tokens.json' }, { $ref: 'themes/g100/extra.tokens.json' }],
        },
        default: 'white',
      },
    },
    resolutionOrder: [{ $ref: '#/sets/palette' }, { $ref: '#/modifiers/theme' }],
  };
  return [
    loadText(json(palette), 'carbon/colors/tokens/colors.tokens.json'),
    loadText(json(resolver), 'carbon/themes/tokens/themes.resolver.json'),
    loadText(json(theme('white', 'gray.100')), 'carbon/themes/tokens/themes/white/theme.tokens.json'),
    loadText(json(theme('gray.100', 'gray.10')), 'carbon/themes/tokens/themes/g100/theme.tokens.json'),
  ];
}

describe('paths', () => {
  it('resolves a reference against the referring file', () => {
    expect(resolvePath('carbon/themes/tokens/themes.resolver.json', '../../colors/tokens/colors.tokens.json')).toBe('carbon/colors/tokens/colors.tokens.json');
    expect(resolvePath('a/b.json', './c/d.json')).toBe('a/c/d.json');
  });

  it('finds a file by its relative path, else by a unique end of its path', () => {
    const files = [{ name: 'x/a/theme.json' }, { name: 'x/b/theme.json' }, { name: 'x/colors.json' }];
    expect(findFile(files, 'b/theme.json', 'x/resolver.json')).toBe(files[1]);
    expect(findFile(files, '../../elsewhere/colors.json', 'x/resolver.json')).toBe(files[2]);
    expect(findFile(files, 'theme.json', 'y/r.json')).toBeUndefined();
  });

  it('names files from a chosen folder by their path in it, and skips what isn’t tokens', async () => {
    const file = (path: string, text = '{}') => Object.defineProperty(new File([text], path.split('/').at(-1)!), 'webkitRelativePath', { value: path });
    const read = await readFiles([file('set/white/theme.tokens.json'), file('set/g100/theme.tokens.json'), file('set/package.json'), file('set/node_modules/x/a.json'), file('set/notes.md')]);
    expect(read.map((r) => r.name)).toEqual(['set/white/theme.tokens.json', 'set/g100/theme.tokens.json']);
  });
});

describe('DTCG resolver', () => {
  it('makes a theme of each context, reading the files in the resolver’s order', () => {
    clearAll();
    addFiles(carbonLike());
    const s = store.get();
    expect(s.themes.map((t) => [t.name, t.source])).toEqual([
      ['white', 'resolver'],
      ['g100', 'resolver'],
    ]);
    const names = (i: number) => s.themes[i]!.fileIds.map((id) => s.files.find((f) => f.id === id)!.name.split('/').slice(-2).join('/'));
    expect(names(0)).toEqual(['tokens/colors.tokens.json', 'white/theme.tokens.json']);
    expect(names(1)).toEqual(['tokens/colors.tokens.json', 'g100/theme.tokens.json']);
    // The resolver itself holds no tokens and is no file to check.
    expect(s.model.issues.filter((i) => i.code === 'no-tokens' || i.code === 'file-not-in-theme')).toEqual([]);
  });

  it('says which named files aren’t loaded', () => {
    clearAll();
    addFiles(carbonLike());
    const missing = store.get().model.issues.filter((i) => i.code === 'resolver-missing');
    expect(missing.map((i) => [i.message, i.themes])).toEqual([[expect.stringContaining('themes/g100/extra.tokens.json'), ['g100']]]);
  });

  it('resolves "#/" pointers into the other files of the theme', () => {
    clearAll();
    addFiles(carbonLike());
    const [white, g100] = store.get().themeModels;
    const hover = (m: typeof white) => m!.model.tokens.get('background-hover')!;
    expect(hover(white).resolution).toBe('ok');
    expect(hover(white).value).toEqual({ colorSpace: 'srgb', components: c('#161616').components, alpha: 0.12 });
    expect(hover(g100).value).toEqual({ colorSpace: 'srgb', components: c('#f4f4f4').components, alpha: 0.12 });
    // Checked as resolved: no "missing colorSpace" for a value its pointers complete.
    expect(store.get().model.issues.filter((i) => i.code === 'unresolved-ref' || i.code === 'invalid-value')).toEqual([]);
  });

  it('keeps same-named files from different folders apart', () => {
    clearAll();
    addFiles(carbonLike());
    expect(store.get().files.filter((f) => f.name.endsWith('/theme.tokens.json'))).toHaveLength(2);
  });
});
