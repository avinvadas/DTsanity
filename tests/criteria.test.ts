import { afterEach, describe, expect, it } from 'vitest';
import { fixPrompt } from '../src/io/prompt';
import { BASIS } from '../src/policy/basis';
import { addFiles, clearAll, store, updateSettings } from '../src/state/app';
import { loadText } from './helpers';

/**
 * The criterion test (docs/fix-prompt-iterations.md, step 3). A rule's "done when" must be met
 * by any valid fix, not only the one DTsanity would make. So each rule's finding is fixed here
 * in two different ways a design system might choose, and both must clear it on a fresh run,
 * with no new required finding. If only one did, the rule (or its check) would assume a
 * solution, and that is a bug.
 *
 * The check is the findings report itself, built from the files alone, as a fresh DTsanity tab
 * would build it: the rules it lists, by their "## … [rule] (n)" headings.
 */

type Files = Record<string, unknown>;

/** A DTCG color from a hex. */
const c = (hex: string, alpha?: number) => ({
  colorSpace: 'srgb',
  components: [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000),
  ...(alpha === undefined ? {} : { alpha }),
});
const px = (value: number) => ({ value, unit: 'px' });

/** The rules a fresh run lists for these files, with how many findings each. */
function found(files: Files): Map<string, number> {
  clearAll();
  updateSettings({ acceptLegacy: true });
  addFiles(Object.entries(files).map(([name, doc]) => loadText(typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2), name)));
  const out = new Map<string, number>();
  for (const m of fixPrompt(store.get()).text.matchAll(/^## .+ \[([a-z0-9-]+)\] \((\d+)\)$/gm)) out.set(m[1]!, Number(m[2]));
  return out;
}

interface Case {
  rule: string;
  before: Files;
  /** Two different valid fixes, by name. */
  fixes: Record<string, Files>;
}

const base = { base: { $type: 'color', white: { $value: c('#ffffff') }, gray: { $value: c('#bbbbbb') }, ink: { $value: c('#222222') }, mid: { $value: c('#767676') } } };

const CASES: Case[] = [
  {
    rule: 'unresolved-reference',
    before: { 't.tokens.json': { color: { $type: 'color', a: { $value: c('#123456') }, x: { $value: '{color.missing}' } } } },
    fixes: {
      'point at a token that exists': { 't.tokens.json': { color: { $type: 'color', a: { $value: c('#123456') }, x: { $value: '{color.a}' } } } },
      'hold a value': { 't.tokens.json': { color: { $type: 'color', a: { $value: c('#123456') }, x: { $value: c('#654321') } } } },
    },
  },
  {
    rule: 'reference-to-group',
    before: { 't.tokens.json': { color: { $type: 'color', grp: { a: { $value: c('#123456') } }, x: { $value: '{color.grp}' } } } },
    fixes: {
      'point at a token in the group': { 't.tokens.json': { color: { $type: 'color', grp: { a: { $value: c('#123456') } }, x: { $value: '{color.grp.a}' } } } },
      'give the group a root token': { 't.tokens.json': { color: { $type: 'color', grp: { $root: { $value: c('#123456') }, a: { $value: c('#123456') } }, x: { $value: '{color.grp.$root}' } } } },
    },
  },
  {
    rule: 'circular-reference',
    before: { 't.tokens.json': { color: { $type: 'color', a: { $value: '{color.b}' }, b: { $value: '{color.a}' } } } },
    fixes: {
      'the first holds a value': { 't.tokens.json': { color: { $type: 'color', a: { $value: c('#111111') }, b: { $value: '{color.a}' } } } },
      'the second holds a value': { 't.tokens.json': { color: { $type: 'color', a: { $value: '{color.b}' }, b: { $value: c('#111111') } } } },
    },
  },
  {
    rule: 'missing-type',
    before: { 't.tokens.json': { size: { a: { $value: px(4) }, b: { $value: px(8) } } } },
    fixes: {
      'a type on each token': { 't.tokens.json': { size: { a: { $type: 'dimension', $value: px(4) }, b: { $type: 'dimension', $value: px(8) } } } },
      'a type on the group': { 't.tokens.json': { size: { $type: 'dimension', a: { $value: px(4) }, b: { $value: px(8) } } } },
    },
  },
  {
    rule: 'unknown-type',
    before: { 't.tokens.json': { radius: { a: { $type: 'radius', $value: px(4) } } } },
    fixes: {
      'a DTCG type': { 't.tokens.json': { radius: { a: { $type: 'dimension', $value: px(4) } } } },
      'a DTCG type on the group': { 't.tokens.json': { radius: { $type: 'dimension', a: { $value: px(4) } } } },
    },
  },
  {
    rule: 'invalid-value',
    before: { 't.tokens.json': { radius: { $type: 'dimension', full: { $value: { value: 100, unit: '%' } } } } },
    fixes: {
      'a px value': { 't.tokens.json': { radius: { $type: 'dimension', full: { $value: px(9999) } } } },
      'a rem value': { 't.tokens.json': { radius: { $type: 'dimension', full: { $value: { value: 624.9, unit: 'rem' } } } } },
    },
  },
  {
    rule: 'legacy-value',
    before: { 't.tokens.json': { color: { $type: 'color', red: { $value: '#ff0000' } } } },
    fixes: {
      'an sRGB object': { 't.tokens.json': { color: { $type: 'color', red: { $value: { colorSpace: 'srgb', components: [1, 0, 0], hex: '#ff0000' } } } } },
      'an HSL object': { 't.tokens.json': { color: { $type: 'color', red: { $value: { colorSpace: 'hsl', components: [0, 100, 50] } } } } },
    },
  },
  {
    rule: 'alias-type-mismatch',
    before: { 't.tokens.json': { color: { $type: 'color', a: { $value: c('#123456') } }, size: { $type: 'dimension', s: { $value: px(4) }, wrong: { $value: '{color.a}' } } } },
    fixes: {
      'point at a token of its type': { 't.tokens.json': { color: { $type: 'color', a: { $value: c('#123456') } }, size: { $type: 'dimension', s: { $value: px(4) }, wrong: { $value: '{size.s}' } } } },
      'take the type of what it points at': { 't.tokens.json': { color: { $type: 'color', a: { $value: c('#123456') } }, size: { $type: 'dimension', s: { $value: px(4) }, wrong: { $type: 'color', $value: '{color.a}' } } } },
    },
  },
  {
    rule: 'embedded-reference',
    before: { 't.tokens.json': { size: { $type: 'dimension', unit: { $value: px(4) }, double: { $value: 'calc({size.unit} * 2)' } } } },
    fixes: {
      'the computed value': { 't.tokens.json': { size: { $type: 'dimension', unit: { $value: px(4) }, double: { $value: px(8) } } } },
      'a reference to a token holding it': { 't.tokens.json': { size: { $type: 'dimension', unit: { $value: px(4) }, eight: { $value: px(8) }, double: { $value: '{size.eight}' } } } },
    },
  },
  {
    rule: 'token-has-children',
    before: { 't.tokens.json': { color: { $type: 'color', veil: { $value: c('#000000'), alpha: 0.4 } } } },
    fixes: {
      'the alpha inside the value': { 't.tokens.json': { color: { $type: 'color', veil: { $value: c('#000000', 0.4) } } } },
      'a token per alpha': { 't.tokens.json': { color: { $type: 'color', veil: { $value: c('#000000', 0.4) }, 'veil-alpha': { $type: 'number', $value: 0.4 } } } },
    },
  },
  {
    rule: 'duplicate-key',
    before: { 't.tokens.json': '{\n  "size": {\n    "$type": "dimension",\n    "a": { "$value": { "value": 4, "unit": "px" } },\n    "a": { "$value": { "value": 8, "unit": "px" } }\n  }\n}\n' },
    fixes: {
      'keep the last one': { 't.tokens.json': '{\n  "size": {\n    "$type": "dimension",\n    "a": { "$value": { "value": 8, "unit": "px" } }\n  }\n}\n' },
      'rename one': { 't.tokens.json': '{\n  "size": {\n    "$type": "dimension",\n    "a": { "$value": { "value": 4, "unit": "px" } },\n    "b": { "$value": { "value": 8, "unit": "px" } }\n  }\n}\n' },
    },
  },
  {
    rule: 'duplicate-path',
    before: { 'a.tokens.json': { size: { $type: 'dimension', s: { $value: px(4) } } }, 'b.tokens.json': { size: { $type: 'dimension', s: { $value: px(8) } } } },
    fixes: {
      'one file defines it': { 'a.tokens.json': { size: { $type: 'dimension', s: { $value: px(4) } } }, 'b.tokens.json': { size: { $type: 'dimension', m: { $value: px(8) } } } },
      'one file of its own': { 'size.tokens.json': { size: { $type: 'dimension', s: { $value: px(8) } } } },
    },
  },
  {
    rule: 'invalid-name',
    before: { 't.tokens.json': { size: { $type: 'dimension', 'space.small': { $value: px(4) } } } },
    fixes: {
      'a dash for the dot': { 't.tokens.json': { size: { $type: 'dimension', 'space-small': { $value: px(4) } } } },
      'a group for the dot': { 't.tokens.json': { size: { $type: 'dimension', space: { small: { $value: px(4) } } } } },
    },
  },
  {
    rule: 'invalid-node',
    before: { 't.tokens.json': { size: { $type: 'dimension', note: 'spacing', s: { $value: px(4) } } } },
    fixes: {
      'under $extensions': { 't.tokens.json': { size: { $type: 'dimension', $extensions: { 'com.example': { note: 'spacing' } }, s: { $value: px(4) } } } },
      'as the description': { 't.tokens.json': { size: { $type: 'dimension', $description: 'spacing', s: { $value: px(4) } } } },
    },
  },
  {
    rule: 'unknown-property',
    before: { 't.tokens.json': { size: { $type: 'dimension', s: { $value: px(4), $schema: 'x' } } } },
    fixes: {
      'under $extensions': { 't.tokens.json': { size: { $type: 'dimension', s: { $value: px(4), $extensions: { 'com.example': { schema: 'x' } } } } } },
      'removed': { 't.tokens.json': { size: { $type: 'dimension', s: { $value: px(4) } } } },
    },
  },
  {
    rule: 'value-per-mode',
    before: { 't.tokens.json': { color: { $type: 'color', bg: { $value: { light: c('#ffffff'), dark: c('#000000') } } } } },
    fixes: {
      'a file per mode': { 'light.tokens.json': { color: { $type: 'color', bg: { $value: c('#ffffff') } } }, 'dark.tokens.json': { color: { $type: 'color', bg: { $value: c('#000000') } } } },
      'one value, the modes under $extensions': { 't.tokens.json': { color: { $type: 'color', bg: { $value: c('#ffffff'), $extensions: { 'com.example.modes': { dark: c('#000000') } } } } } },
    },
  },
  {
    rule: 'tier-base-reference',
    before: { 'base.tokens.json': { base: { $type: 'color', a: { $value: '{base.b}' }, b: { $value: c('#123456') } } } },
    fixes: {
      'the base token holds the value': { 'base.tokens.json': { base: { $type: 'color', a: { $value: c('#123456') }, b: { $value: c('#123456') } } } },
      'the alias moves to the semantic tier': {
        'base.tokens.json': { base: { $type: 'color', b: { $value: c('#123456') } } },
        'semantic.tokens.json': { semantic: { $type: 'color', a: { $value: '{base.b}' } } },
      },
    },
  },
  {
    rule: 'contrast-text',
    before: { 'base.tokens.json': base, 'semantic.tokens.json': { color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, text: { default: { $value: '{base.gray}' } } } } },
    fixes: {
      'point the text at a darker base token': { 'base.tokens.json': base, 'semantic.tokens.json': { color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, text: { default: { $value: '{base.ink}' } } } } },
      'change the base value': {
        'base.tokens.json': { base: { ...base.base, gray: { $value: c('#595959') } } },
        'semantic.tokens.json': { color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, text: { default: { $value: '{base.gray}' } } } },
      },
    },
  },
  {
    rule: 'contrast-ui',
    before: { 'base.tokens.json': base, 'semantic.tokens.json': { color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, icon: { default: { $value: '{base.gray}' } } } } },
    fixes: {
      'point the icon at another base token': { 'base.tokens.json': base, 'semantic.tokens.json': { color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, icon: { default: { $value: '{base.mid}' } } } } },
      'change the base value': {
        'base.tokens.json': { base: { ...base.base, gray: { $value: c('#8f8f8f') } } },
        'semantic.tokens.json': { color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, icon: { default: { $value: '{base.gray}' } } } },
      },
    },
  },
  {
    rule: 'contrast-border',
    before: { 'base.tokens.json': base, 'semantic.tokens.json': { color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, border: { default: { $value: '{base.gray}' } } } } },
    fixes: {
      'point the border at another base token': { 'base.tokens.json': base, 'semantic.tokens.json': { color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, border: { default: { $value: '{base.mid}' } } } } },
      'a new base value': {
        'base.tokens.json': { base: { ...base.base, gray: { $value: c('#8a8a8a') } } },
        'semantic.tokens.json': { color: { $type: 'color', bg: { default: { $value: '{base.white}' } }, border: { default: { $value: '{base.gray}' } } } },
      },
    },
  },
  {
    rule: 'cvd-siblings',
    before: {
      'base.tokens.json': { base: { $type: 'color', red: { $value: c('#d03030') }, red2: { $value: c('#d03838') } } },
      'semantic.tokens.json': { color: { $type: 'color', bg: { danger: { $value: '{base.red}' }, warning: { $value: '{base.red2}' } } } },
    },
    fixes: {
      'the warning lighter': {
        'base.tokens.json': { base: { $type: 'color', red: { $value: c('#d03030') }, yellow: { $value: c('#f5d76e') } } },
        'semantic.tokens.json': { color: { $type: 'color', bg: { danger: { $value: '{base.red}' }, warning: { $value: '{base.yellow}' } } } },
      },
      'the danger darker': {
        'base.tokens.json': { base: { $type: 'color', red: { $value: c('#6a0f0f') }, red2: { $value: c('#e8a33a') } } },
        'semantic.tokens.json': { color: { $type: 'color', bg: { danger: { $value: '{base.red}' }, warning: { $value: '{base.red2}' } } } },
      },
    },
  },
];

afterEach(() => clearAll());

describe('a rule’s check passes with any valid fix', () => {
  it('has one case per rule, with two fixes each', () => {
    expect(new Set(CASES.map((x) => x.rule)).size).toBe(CASES.length);
    for (const x of CASES) expect(Object.keys(x.fixes), x.rule).toHaveLength(2);
  });

  describe.each(CASES)('$rule', ({ rule, before, fixes }) => {
    const was = found(before);
    it('is found before', () => expect([...was.keys()]).toContain(rule));
    it.each(Object.entries(fixes))('is cleared by: %s', (_, after) => {
      const now = found(after);
      expect([...now.keys()], 'the finding is gone').not.toContain(rule);
      const added = [...now.keys()].filter((id) => !was.has(id) && BASIS[id]?.standing === 'required');
      expect(added, 'no new required finding').toEqual([]);
    });
  });
});
