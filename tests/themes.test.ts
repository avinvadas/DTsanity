import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { pairsOf } from '../src/state/pairs';
import {
  addFiles,
  addTheme,
  ALL_THEMES,
  applyFixes,
  clearAll,
  removeTheme,
  renameTheme,
  resetThemes,
  setActiveTheme,
  setThemeContrast,
  setThemeFile,
  store,
} from '../src/state/app';
import { exportText } from '../src/io/export';
import { detectThemes } from '../src/themes/detect';
import { isLoadError, parseSource } from '../src/io/load';
import { loadFixture, loadText } from './helpers';

const S = DEFAULT_SETTINGS;
const lightDark = () => ['primitives.tokens.json', 'semantic.light.tokens.json', 'semantic.dark.tokens.json'].map((n) => loadFixture(`themes/${n}`));
const codes = () => store.get().model.issues.map((i) => `${i.code} ${i.target ?? ''}${i.themes ? ` [${i.themes.join(',')}]` : ''}`.trim());

describe('detection', () => {
  it('reads file names: themed files plus shared ones', () => {
    const files = lightDark();
    const themes = detectThemes(files, S);
    expect(themes.map((t) => [t.name, t.source, t.fileIds.length])).toEqual([
      ['light', 'file-names', 2],
      ['dark', 'file-names', 2],
    ]);
    expect(themes[0]!.fileIds).toEqual([files[0]!.id, files[1]!.id]);
  });

  it('needs at least two theme words', () => {
    expect(detectThemes([loadFixture('themes/primitives.tokens.json'), loadFixture('themes/semantic.light.tokens.json')], S)).toEqual([]);
  });

  it('reads Tokens Studio $themes with their sets', () => {
    const f = loadFixture('themes/tokens-studio-themes.json');
    const themes = detectThemes([f], S);
    // Named as written, the group kept apart: Tokens Studio shows “Light” under the group “Mode”.
    expect(themes.map((t) => [t.name, t.group, t.source])).toEqual([
      ['Light', 'Mode', 'tokens-studio'],
      ['Dark', 'Mode', 'tokens-studio'],
    ]);
    expect(themes[0]!.scope.sets).toEqual({ [f.id]: ['global', 'light'] });
  });

  it('reads a Tokens Studio folder export with a separate $themes.json', () => {
    const themesFile = loadText(
      JSON.stringify([
        { name: 'light', selectedTokenSets: { 'core/global': 'source', 'modes/light': 'enabled' } },
        { name: 'dark', selectedTokenSets: { 'core/global': 'source', 'modes/dark': 'enabled' } },
      ]),
      '$themes.json',
    );
    const global = loadText('{"white": {"$type": "color", "$value": {"colorSpace": "srgb", "components": [1, 1, 1]}}}', 'global.json');
    const light = loadText('{"bg": {"$value": "{white}"}}', 'light.json');
    const dark = loadText('{"bg": {"$value": "{nope}"}}', 'dark.json');
    const themes = detectThemes([themesFile, global, light, dark], S);
    expect(themes.map((t) => t.fileIds)).toEqual([
      [global.id, light.id],
      [global.id, dark.id],
    ]);
  });

  it('combines Tokens Studio theme groups: each theme with the first of every other group', () => {
    const themesFile = loadText(
      JSON.stringify([
        { name: 'medium', group: 'Size', selectedTokenSets: { 'size/medium': 'enabled' } },
        { name: 'large', group: 'Size', selectedTokenSets: { 'size/large': 'enabled' } },
        { name: 'Dark', group: 'Color scheme', selectedTokenSets: { 'scheme/dark': 'enabled' } },
        { name: 'Light', group: 'Color scheme', selectedTokenSets: { 'scheme/light': 'enabled' } },
      ]),
      'ds/$themes.json',
    );
    const file = (path: string) => loadText('{"x": {"$type": "number", "$value": 1}}', `ds/${path}.json`);
    const [medium, large, dark, light] = [file('size/medium'), file('size/large'), file('scheme/dark'), file('scheme/light')];
    const themes = detectThemes([themesFile, medium!, large!, dark!, light!], S);
    expect(themes.map((t) => [t.name, t.group, t.combo?.map((c) => c.name)])).toEqual([
      ['medium · Dark', undefined, ['medium', 'Dark']],
      ['large', 'Size', ['large', 'Dark']],
      ['Light', 'Color scheme', ['Light', 'medium']],
    ]);
    expect(themes.map((t) => t.fileIds)).toEqual([
      [medium!.id, dark!.id],
      [large!.id, dark!.id],
      [medium!.id, light!.id],
    ]);
  });

  it('reads per-mode values from $extensions', () => {
    const themes = detectThemes([loadFixture('themes/modes.tokens.json')], S);
    expect(themes.map((t) => [t.name, t.scope.mode])).toEqual([
      ['light', 'light'],
      ['dark', 'dark'],
    ]);
  });
});

describe('per-theme models', () => {
  beforeEach(() => clearAll());

  it('checks each theme on its own: no duplicate warnings, theme-only issues are tagged', () => {
    addFiles(lightDark());
    const s = store.get();
    expect(s.themes).toHaveLength(2);
    expect(s.activeTheme).toBe(ALL_THEMES);
    expect(codes()).toEqual(['unresolved-reference color.accent [dark]']);
    const light = s.themeModels[0]!.model;
    const dark = s.themeModels[1]!.model;
    expect(light.tokens.get('color.bg.default')!.aliasOf).toBe('color.gray.0');
    expect(dark.tokens.get('color.bg.default')!.aliasOf).toBe('color.gray.900');
  });

  it('switches the active theme', () => {
    addFiles(lightDark());
    const dark = store.get().themes[1]!.id;
    setActiveTheme(dark);
    expect(store.get().model).toBe(store.get().themeModels[1]!.model);
    expect(codes()).toEqual(['unresolved-reference color.accent']);
    setActiveTheme(store.get().themes[0]!.id);
    expect(codes()).toEqual([]);
  });

  it('without themes, the same files clash', () => {
    addFiles(lightDark());
    store.get().themes.forEach((t) => removeTheme(t.id));
    expect(store.get().themes).toEqual([]);
    expect(codes().filter((c) => c.startsWith('duplicate-path'))).toHaveLength(3);
  });

  it('Tokens Studio themes read only their sets', () => {
    addFiles([loadFixture('themes/tokens-studio-themes.json')]);
    const [light, dark] = store.get().themeModels;
    expect(light!.model.tokens.get('bg')!.aliasOf).toBe('color.white');
    expect(dark!.model.tokens.get('bg')!.aliasOf).toBe('color.black');
    expect(codes()).toEqual([]);
  });

  it('mode themes use the mode value, and fixes edit that value', () => {
    addFiles([loadFixture('themes/modes.tokens.json')]);
    const [light, dark] = store.get().themeModels;
    expect(light!.model.tokens.get('color.fg')!.aliasOf).toBe('color.black');
    expect(dark!.model.tokens.get('color.fg')).toMatchObject({ valuePath: ['$extensions', 'mode', 'dark'], rawValue: '#ffffff' });
    const issue = store.get().model.issues.find((i) => i.code === 'legacy-value')!;
    expect(issue.themes).toEqual(['dark']);
    applyFixes([issue.fix!]);
    expect(JSON.parse(exportText(store.get().files[0]!)).color.fg.$extensions.mode.dark).toEqual({ colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' });
    expect(codes().sort()).toEqual(['extension-naming color.bg', 'extension-naming color.fg']);
  });
});

describe('editing themes', () => {
  beforeEach(() => clearAll());

  it('rename, toggle files, add and remove; a file in no theme is reported', () => {
    addFiles(lightDark());
    const [light, dark] = store.get().themes;
    renameTheme(light!.id, 'Day');
    expect(store.get().themes[0]!.name).toBe('Day');
    expect(store.get().themesCustomized).toBe(true);

    const darkFile = store.get().files[2]!.id;
    setThemeFile(dark!.id, darkFile, false);
    expect(codes()).toContain('file-not-in-theme');
    setThemeFile(dark!.id, darkFile, true);
    expect(store.get().themes[1]!.fileIds).toEqual(store.get().files.filter((f) => f.id !== store.get().files[1]!.id).map((f) => f.id));

    addTheme();
    expect(store.get().themes.map((t) => t.name)).toEqual(['Day', 'dark', 'Theme 3']);
    expect(store.get().themes[2]!.fileIds).toHaveLength(3);
  });

  it('keeps edited themes when files are added or reloaded', () => {
    addFiles(lightDark());
    renameTheme(store.get().themes[0]!.id, 'Day');
    const extra = loadText('{"x": {"$type": "number", "$value": 1}}', 'extra.json');
    addFiles([extra]);
    expect(store.get().themes.every((t) => t.fileIds.includes(extra.id))).toBe(true);
    const reloaded = loadFixture('themes/semantic.dark.tokens.json');
    addFiles([reloaded]);
    expect(store.get().themes[1]!.fileIds).toContain(reloaded.id);
    expect(store.get().themes[0]!.fileIds).not.toContain(reloaded.id);
  });

  it('detects again on reset', () => {
    addFiles(lightDark());
    renameTheme(store.get().themes[0]!.id, 'Day');
    resetThemes();
    expect(store.get().themes.map((t) => t.name)).toEqual(['light', 'dark']);
    expect(store.get().themesCustomized).toBe(false);
  });

  it('starts manual themes as a pair when none were detected', () => {
    addFiles([loadFixture('dtcg/primitives.tokens.json'), loadFixture('dtcg/semantic.tokens.json')]);
    addTheme();
    expect(store.get().themes.map((t) => [t.name, t.source, t.fileIds.length])).toEqual([
      ['Theme 1', 'manual', 2],
      ['Theme 2', 'manual', 2],
    ]);
  });
});

describe('contrast level per theme', () => {
  const c = (hex: string) => ({ colorSpace: 'srgb', components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), hex });
  // Gray #595959 on white is about 7.0:1; #6b6b6b about 5.3:1: AA, not AAA.
  const files = () => [
    loadText(JSON.stringify({ base: { $type: 'color', white: { $value: c('#ffffff') }, mid: { $value: c('#6b6b6b') } } }), 'primitives.tokens.json'),
    loadText(JSON.stringify({ color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, text: { default: { $value: '{base.mid}' } } } }), 'semantic.light.tokens.json'),
    loadText(JSON.stringify({ color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, text: { default: { $value: '{base.mid}' } } } }), 'semantic.high-contrast.tokens.json'),
  ];

  it('checks a high-contrast theme at the enhanced level, named so', () => {
    clearAll();
    addFiles(files());
    const s = store.get();
    expect(s.themes.map((t) => [t.name, t.contrast])).toEqual([
      ['light', undefined],
      ['high-contrast', 'enhanced'],
    ]);
    const row = pairsOf(s).rows.find((r) => r.pair.fg === 'color.text.default')!;
    expect(row.seen.normal.map((x) => [x!.pass, x!.results[0]!.level.short])).toEqual([
      [true, 'AA'],
      [false, 'AAA'],
    ]);
  });

  it('can be set per theme', () => {
    clearAll();
    addFiles(files());
    setThemeContrast(store.get().themes[1]!.id, 'standard');
    const row = pairsOf(store.get()).rows.find((r) => r.pair.fg === 'color.text.default')!;
    expect(row.seen.normal.every((x) => x!.pass)).toBe(true);
  });
});

describe('theme variants and per-theme overrides (Primer)', () => {
  const c = (hex: string) => ({ colorSpace: 'srgb', components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), hex });
  // Primer's layout: dark.json5, a variant laid over it, and a light file; functional tokens hold per-theme values in `org.primer.overrides`.
  const files = () => [
    loadText(JSON.stringify({ base: { $type: 'color', black: { $value: c('#010409') }, blue: { $value: c('#0969da') } } }), 'base/color/dark/dark.json5'),
    loadText(JSON.stringify({ base: { $type: 'color', black: { $value: c('#000000') } } }), 'base/color/dark/dark.high-contrast.json5'),
    loadText(JSON.stringify({ base: { $type: 'color', black: { $value: c('#1f2328') }, blue: { $value: c('#0969da') } } }), 'base/color/light/light.json5'),
    loadText(
      JSON.stringify({
        fg: {
          $type: 'color',
          accent: { $value: '{base.blue}', $extensions: { 'org.primer.overrides': { dark: c('#4493f8'), 'dark-high-contrast': c('#74b9ff') } } },
          muted: { $value: '{base.blue}', $extensions: { 'org.primer.overrides': { dark: { $value: c('#9198a1'), alpha: 1 }, 'dark-high-contrast': { alpha: 0.5 } } } },
        },
      }),
      'functional/color/fg.json5',
    ),
  ];
  const value = (theme: string, id: string) => store.get().themeModels.find((m) => m.theme.name === theme)!.model.tokens.get(id)!.value as { hex: string };

  it('makes a file that extends another one’s name a theme of its own, read over it', () => {
    clearAll();
    addFiles(files());
    const s = store.get();
    const names = new Map(s.files.map((f) => [f.id, f.name]));
    expect(s.themes.map((t) => [t.name, t.contrast, t.fileIds.map((id) => names.get(id))])).toEqual([
      ['dark', undefined, ['base/color/dark/dark.json5', 'functional/color/fg.json5']],
      ['dark-high-contrast', 'enhanced', ['base/color/dark/dark.json5', 'functional/color/fg.json5', 'base/color/dark/dark.high-contrast.json5']],
      ['light', undefined, ['base/color/light/light.json5', 'functional/color/fg.json5']],
    ]);
    // The variant wins over the file it builds on, and replacing its tokens is what it is for: no "defined twice".
    expect(value('dark-high-contrast', 'base.black').hex).toBe('#000000');
    expect(codes().filter((c) => c.startsWith('duplicate-path'))).toEqual([]);
  });

  it('reads each theme’s value from `<vendor>.overrides`, a variant falling back to the theme it builds on', () => {
    clearAll();
    addFiles(files());
    expect(value('dark', 'fg.accent').hex).toBe('#4493f8');
    expect(value('dark-high-contrast', 'fg.accent').hex).toBe('#74b9ff');
    expect(value('light', 'fg.accent').hex).toBe('#0969da');
    // An entry written as a token gives its `$value`; one with only an alpha leaves the value to the theme it builds on.
    expect(value('dark', 'fg.muted').hex).toBe('#9198a1');
    expect(value('dark-high-contrast', 'fg.muted').hex).toBe('#9198a1');
  });

  it('gives the color the alpha of its per-theme entry, as Primer builds it', () => {
    const alpha = (theme: string, id: string) => (value(theme, id) as { alpha?: number }).alpha ?? 1;
    clearAll();
    addFiles([
      ...files().slice(0, 3),
      loadText(
        JSON.stringify({
          fg: {
            $type: 'color',
            // `{ $value, alpha }`: the alpha replaces the alpha of the color the entry resolves to.
            border: { $value: '{base.blue}', $extensions: { 'org.primer.overrides': { dark: { $value: '{fg.translucent}', alpha: 1 }, 'dark-high-contrast': { $value: '{base.blue}', alpha: 0.4 } } } },
            translucent: { $value: { ...c('#0969da'), alpha: 0.5 } },
            // `{ alpha }` alone changes the alpha of the value the theme would have.
            skeleton: { $value: '{base.black}', $extensions: { 'org.primer.overrides': { dark: { alpha: 0.2 } } } },
            // A color written as the entry keeps its own alpha.
            literal: { $value: '{base.blue}', $extensions: { 'org.primer.overrides': { dark: { ...c('#4493f8'), alpha: 0.3 } } } },
            usesBorder: { $value: '{fg.border}' },
          },
        }),
        'functional/color/fg.json5',
      ),
    ]);
    // `alpha: 1` leaves the alpha of the color it points at, as Primer's CSS does.
    expect(alpha('dark', 'fg.border')).toBe(0.5);
    expect(alpha('dark-high-contrast', 'fg.border')).toBe(0.4);
    expect(alpha('light', 'fg.border')).toBe(1);
    expect(alpha('dark', 'fg.skeleton')).toBe(0.2);
    expect(value('dark', 'fg.skeleton').hex).toBe('#010409');
    expect(alpha('dark-high-contrast', 'fg.skeleton')).toBe(0.2);
    expect(alpha('light', 'fg.skeleton')).toBe(1);
    expect(alpha('dark', 'fg.literal')).toBe(0.3);
    // An alias carries the alpha of the color it points at, as Primer's `var(--…)` does.
    expect(alpha('dark-high-contrast', 'fg.usesBorder')).toBe(0.4);
    // The written value is unchanged: fixes and format checks still see the file as it is.
    const t = store.get().themeModels.find((m) => m.theme.name === 'dark-high-contrast')!.model.tokens.get('fg.border')!;
    expect(t.rawValue).toBe('{base.blue}');
  });

  it('applies fixes to several per-theme values of one token in one go', () => {
    clearAll();
    addFiles([
      ...files().slice(0, 3),
      loadText(JSON.stringify({ fg: { $type: 'color', accent: { $value: '{base.blue}', $extensions: { 'org.primer.overrides': { dark: '#4493F8', 'dark-high-contrast': '#74B9FF' } } } } }), 'functional/color/fg.json5'),
    ]);
    const fixes = store.get().themeModels.flatMap((m) => m.model.issues).filter((i) => i.code === 'legacy-value' && i.fix).map((i) => i.fix!);
    expect(fixes).toHaveLength(2);
    expect(applyFixes(fixes)).toBe(2);
    expect(store.get().themeModels.flatMap((m) => m.model.issues).filter((i) => i.code === 'legacy-value')).toEqual([]);
  });
});

describe('files that define the same tokens', () => {
  const set = (hue: number, extra: Record<string, unknown> = {}) => {
    const scale: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) scale[i] = { $value: { colorSpace: 'oklch', components: [i / 12, 0.1, hue] } };
    return JSON.stringify({ color: { $type: 'color', scale, ...extra } });
  };
  const semantic = JSON.stringify({ text: { $type: 'color', default: { $value: '{color.scale.11}' } } });

  it('reads each as a theme, named by what its name adds, with the other files shared', () => {
    clearAll();
    addFiles([loadText(set(250), 'brand.json'), loadText(set(30), 'brand_dark.json'), loadText(set(90, { extra: { $value: { colorSpace: 'srgb', components: [0, 0, 0] } } }), 'brand_hcb.json'), loadText(semantic, 'semantic.json')]);
    const s = store.get();
    const names = new Map(s.files.map((f) => [f.id, f.name]));
    expect(s.themes.map((t) => [t.name, t.source, t.contrast, t.fileIds.map((id) => names.get(id))])).toEqual([
      ['brand', 'same-tokens', undefined, ['semantic.json', 'brand.json']],
      ['dark', 'same-tokens', undefined, ['semantic.json', 'brand_dark.json']],
      ['hcb', 'same-tokens', 'enhanced', ['semantic.json', 'brand_hcb.json']],
    ]);
    // Each version is read on its own: none of its tokens is "defined twice".
    expect(codes().filter((c) => c.startsWith('duplicate-path'))).toEqual([]);
  });

  it('leaves files that split one set (different tokens) as one set', () => {
    const half = (from: number) => {
      const scale: Record<string, unknown> = {};
      for (let i = from; i < from + 12; i++) scale[i] = { $value: { colorSpace: 'oklch', components: [0.5, 0.1, i] } };
      return JSON.stringify({ color: { $type: 'color', scale } });
    };
    expect(detectThemes([loadText(half(0), 'a.json'), loadText(half(12), 'b.json')], S)).toEqual([]);
  });

  it('leaves a file that overrides a few tokens of another one to load over it', () => {
    const few = JSON.stringify({ color: { $type: 'color', scale: { 0: { $value: { colorSpace: 'srgb', components: [1, 0, 0] } } } } });
    expect(detectThemes([loadText(set(250), 'brand.json'), loadText(few, 'brand_tweaks.json')], S)).toEqual([]);
  });
});

describe('values by mode written in the token', () => {
  const legacy = { ...S, acceptLegacy: true };
  const hex = (h: string) => ({ colorSpace: 'srgb', components: [0, 0, 0], hex: h });

  it('reads `"$value": { "light", "dark" }` as themes, with one finding for the file', () => {
    const text = JSON.stringify({
      color: {
        $type: 'color',
        a: { $value: { light: hex('#ffffff'), dark: hex('#000000') } },
        b: { $value: { light: hex('#eeeeee'), dark: hex('#111111') } },
        // A map of states isn't a map of modes.
        c: { $value: { default: hex('#ffffff'), disabled: hex('#cccccc') } },
      },
    });
    clearAll();
    store.set({ ...store.get(), settings: legacy });
    addFiles([loadText(text, 'set.tokens.json')]);
    const s = store.get();
    expect(s.themes.map((t) => [t.name, t.source])).toEqual([['light', 'modes'], ['dark', 'modes']]);
    expect(value('dark', 'color.a').hex).toBe('#000000');
    const found = s.model.issues.filter((i) => i.code === 'value-per-mode');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/^2 tokens hold one value per mode inside “\$value” \(“light”, “dark”; first: `color\.a`, `color\.b`\)\. DTCG gives a token one value/);
  });

  it('reads Spectrum’s `"sets": { "light": { "value" } }` as one token per name, with its modes as themes', () => {
    const text = JSON.stringify({
      'blue-900': { sets: { light: { value: '#1d4ed8' }, dark: { value: '#93c5fd' } } },
      'accent-color': { value: '{blue-900}' },
    });
    clearAll();
    store.set({ ...store.get(), settings: legacy });
    // Legacy files are converted as they load, so read with legacy formats accepted.
    const f = parseSource({ name: 'palette.json', text, origin: 'file' }, legacy);
    if (isLoadError(f)) throw new Error(f.message);
    addFiles([f]);
    const s = store.get();
    expect(s.themes.map((t) => t.name)).toEqual(['light', 'dark']);
    expect(codes().filter((c) => c.startsWith('reference-to-group') || c.startsWith('invalid-node'))).toEqual([]);
    expect(s.model.issues.filter((i) => i.code === 'value-per-mode')).toHaveLength(1);
  });

  it('leaves such values unread with legacy formats off', () => {
    const text = JSON.stringify({ color: { $type: 'color', a: { $value: { light: hex('#ffffff'), dark: hex('#000000') } } } });
    expect(detectThemes([loadText(text, 'set.tokens.json')], S)).toEqual([]);
  });

  const value = (theme: string, id: string) => store.get().themeModels.find((m) => m.theme.name === theme)!.model.tokens.get(id)!.value as { hex: string };
});
