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
