import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { RULE_TITLE } from '../src/model/rules';
import { cleanPolicy, levelOf, RULES, withPolicy } from '../src/policy/rules';
import { addFiles, clearAll, resetPolicy, setRuleLevel, store, updateSettings } from '../src/state/app';
import { pairsOf, siblingFails } from '../src/state/pairs';
import { palettesOf } from '../src/state/palettes';
import { analyze } from '../src/validate';
import { loadFixture, loadText } from './helpers';

const S = DEFAULT_SETTINGS;
/** A DTCG color value from a hex. */
const c = (hex: string) => ({ colorSpace: 'srgb', components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), hex });

const broken = () =>
  loadText(
    JSON.stringify({
      color: { $type: 'color', a: { $value: '{color.missing}' }, b: { $value: c('#ffffff') } },
      empty: {},
    }),
    'broken.tokens.json',
  );

const pairsFile = () =>
  loadText(
    JSON.stringify({
      base: { $type: 'color', white: { $value: c('#ffffff') }, light: { $value: c('#bbbbbb') }, faint: { $value: c('#eeeeee') } },
      color: {
        $type: 'color',
        bg: { default: { $value: '{base.white}' } },
        text: { default: { $value: '{base.light}' } },
        icon: { default: { $value: '{base.faint}' } },
      },
    }),
    'pairs.tokens.json',
  );

afterEach(() => {
  resetPolicy();
  clearAll();
});

describe('rule list', () => {
  it('lists every titled issue rule once', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const code of Object.keys(RULE_TITLE)) expect(ids).toContain(code);
  });

  it('matches what the rules report by default, on every sample set', () => {
    const root = fileURLToPath(new URL('../samples/', import.meta.url));
    const json = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? json(join(dir, n)) : n.endsWith('.json') ? [join(dir, n)] : []));
    const settings = { ...S, acceptLegacy: true };
    const seen = new Map<string, Set<string>>();
    for (const set of readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory())) {
      const files = json(join(root, set)).map((p) => loadText(readFileSync(p, 'utf8'), p));
      for (const i of analyze(files, settings).issues) seen.set(i.code, (seen.get(i.code) ?? new Set()).add(i.severity));
    }
    for (const [code, sevs] of seen) {
      if (RULES.some((r) => r.id === code)) expect([code, [...sevs]]).toEqual([code, [levelOf({}, code)]]);
    }
  });
});

describe('policy', () => {
  it('stores only valid changes from the defaults', () => {
    expect(cleanPolicy({ 'missing-type': 'warning', 'empty-group': 'info', 'no-such-rule': 'off', 'invalid-name': 'loud' })).toEqual({ 'missing-type': 'warning' });
    expect(cleanPolicy(null)).toEqual({});
  });

  it('changes the severity of issues, or drops them when off', () => {
    const codes = (policy: Record<string, string>) =>
      analyze([broken()], { ...S, policy: cleanPolicy(policy) })
        .issues.map((i) => `${i.severity} ${i.code}`)
        .sort();
    expect(codes({})).toEqual(['error unresolved-reference', 'info empty-group']);
    expect(codes({ 'unresolved-reference': 'warning', 'empty-group': 'off' })).toEqual(['warning unresolved-reference']);
  });

  it('keeps findings of rules it does not list', () => {
    const notes = [{ severity: 'warning' as const, id: 'something-else' }];
    expect(withPolicy(notes, { 'type-small': 'off' }, (n) => n.id)).toEqual(notes);
  });

  it('applies to palette flags, by kind', () => {
    addFiles([loadFixture('palettes.tokens.json')]);
    const flags = () => palettesOf(store.get()).palettes.find((p) => p.id === 'color.blue')!.flags.map((f) => `${f.severity} ${f.kind}`);
    expect(flags()).toContain('warning inversion');
    setRuleLevel('scale-inversion', 'error');
    expect(flags()).toContain('error inversion');
    setRuleLevel('scale-inversion', 'off');
    expect(flags().some((f) => f.endsWith('inversion'))).toBe(false);
  });

  it('sets the tone of contrast failures and turns the check off', () => {
    addFiles([pairsFile()]);
    const row = (fg: string) => pairsOf(store.get()).rows.find((r) => r.pair.fg === fg)!;
    expect([row('color.text.default').pass, row('color.text.default').tone]).toEqual([false, 'error']);
    expect([row('color.icon.default').pass, row('color.icon.default').tone]).toEqual([false, 'warning']);
    setRuleLevel('contrast-text', 'info');
    expect(row('color.text.default').tone).toBe('info');
    setRuleLevel('contrast-ui', 'off');
    expect(row('color.icon.default').pass).toBe(true);
  });

  it('turns the status-color check off', () => {
    const near = loadText(
      JSON.stringify({
        base: { $type: 'color', red: { $value: c('#d03030') }, red2: { $value: c('#d03838') } },
        color: { $type: 'color', bg: { danger: { $value: '{base.red}' }, warning: { $value: '{base.red2}' } } },
      }),
    );
    addFiles([near]);
    const groups = () => pairsOf(store.get()).siblings.filter(siblingFails);
    expect(groups().map((g) => g.tone)).toEqual(['warning']);
    setRuleLevel('cvd-siblings', 'error');
    expect(groups().map((g) => g.tone)).toEqual(['error']);
    setRuleLevel('cvd-siblings', 'off');
    expect(groups()).toEqual([]);
  });

  it('is kept with the settings and reset to the defaults', () => {
    setRuleLevel('missing-type', 'warning');
    setRuleLevel('missing-type', 'error');
    expect(store.get().settings.policy).toEqual({});
    setRuleLevel('tier-hardcoded', 'off');
    expect(store.get().settings.policy).toEqual({ 'tier-hardcoded': 'off' });
    updateSettings({ gamut: 'p3' });
    expect(store.get().settings.policy).toEqual({ 'tier-hardcoded': 'off' });
    resetPolicy();
    updateSettings({ gamut: 'srgb' });
    expect(store.get().settings.policy).toEqual({});
  });
});
