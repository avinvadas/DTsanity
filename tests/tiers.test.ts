import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { componentOf, tiersOf } from '../src/model/tiers';
import { aliasCandidates } from '../src/semantic/pairs';
import { analyze } from '../src/validate';
import { loadText } from './helpers';

const c = (v: number) => ({ $value: { colorSpace: 'srgb', components: [v, v, v] } });
const ref = (id: string) => ({ $value: `{${id}}` });

describe('tier detection', () => {
  it('reads tiers from names, values and file names', () => {
    const model = analyze(
      [
        loadText(JSON.stringify({ color: { $type: 'color', gray: { 100: c(0.9), 900: c(0.1), 500: ref('color.gray.900') } } }), 'primitives.tokens.json'),
        loadText(JSON.stringify({ color: { $type: 'color', bg: { default: ref('color.gray.100') }, text: { default: ref('color.gray.900') } } }), 'semantic.tokens.json'),
        loadText(JSON.stringify({ button: { $type: 'color', primary: { bg: ref('color.text.default'), text: ref('color.bg.default') } }, color: { $type: 'color', bg: { input: ref('color.gray.100') } } })),
      ],
      DEFAULT_SETTINGS,
    );
    const tiers = tiersOf(model);
    expect(tiers.get('color.gray.100')).toBe('base');
    // A palette step stays base even as a reference (and is flagged for it).
    expect(tiers.get('color.gray.500')).toBe('base');
    expect(tiers.get('color.text.default')).toBe('semantic');
    expect(tiers.get('button.primary.bg')).toBe('component');
    // A component word after the role word is a semantic variant, not a component.
    expect(tiers.get('color.bg.input')).toBe('semantic');
  });

  it('lets a layer group win over a component word', () => {
    const model = analyze([loadText(JSON.stringify({ components: { button: { bg: { $type: 'color', ...ref('base.blue') } } }, base: { blue: { $type: 'color', ...c(0.5) }, card: { $type: 'color', ...c(1) } } }))], DEFAULT_SETTINGS);
    const tiers = tiersOf(model);
    expect(tiers.get('components.button.bg')).toBe('component');
    expect(tiers.get('base.card')).toBe('base');
  });
});

describe('component names', () => {
  it('names the component of a component token, past layer and category groups', () => {
    const model = analyze(
      [loadText(JSON.stringify({ components: { color: { button: { primary: { bg: { $type: 'color', ...c(0.5) } } } } }, badge: { success: { content: { $type: 'color', ...c(0.2) } } } }))],
      DEFAULT_SETTINGS,
    );
    expect(componentOf(model.tokens.get('components.color.button.primary.bg')!)).toBe('button');
    expect(componentOf(model.tokens.get('badge.success.content')!)).toBe('badge');
  });
});

describe('tier rules', () => {
  const model = analyze(
    [
      loadText(JSON.stringify({ color: { $type: 'color', gray: { 100: c(0.9), 900: c(0.1), 500: ref('color.gray.900') } } }), 'primitives.tokens.json'),
      loadText(
        JSON.stringify({ color: { $type: 'color', bg: { default: ref('color.gray.100'), raised: ref('color.bg.default') }, text: { default: c(0.2), strong: ref('button.primary.text') } } }),
        'semantic.tokens.json',
      ),
      loadText(JSON.stringify({ button: { $type: 'color', primary: { bg: ref('color.bg.raised'), text: ref('color.gray.900') } } }), 'components.tokens.json'),
    ],
    DEFAULT_SETTINGS,
  );
  const codes = model.issues.filter((i) => i.code.startsWith('tier-')).map((i) => `${i.code} ${i.target}`).sort();

  it('flags base references, references up the tiers and hardcoded values', () => {
    expect(codes).toEqual(['tier-base-reference color.gray.500', 'tier-hardcoded color.text.default', 'tier-reference color.text.strong']);
  });

  it('allows semantic → semantic and component → semantic or base', () => {
    expect(codes.some((c) => c.includes('color.bg.raised') || c.includes('button.primary'))).toBe(false);
  });

  it('offers to write a base reference’s value in its place', () => {
    const fix = model.issues.find((i) => i.code === 'tier-base-reference')!.fix!;
    expect(fix.label).toBe('Write the value instead');
    expect('edits' in fix && fix.edits[0]!.path).toEqual(['color', 'gray', '500', '$value']);
  });

  it('offers tier-appropriate targets without loops', () => {
    const ids = (id: string) => aliasCandidates(model, id).flatMap((g) => g.tokens.map((t) => t.id));
    // color.bg.raised points at color.bg.default, and button.primary.bg at raised: neither may become its target.
    expect(ids('color.bg.default')).not.toContain('color.bg.raised');
    expect(ids('color.bg.default')).not.toContain('button.primary.bg');
    expect(ids('color.bg.default')).toContain('color.gray.100');
    // A component may point at semantic and base tokens, not at other components.
    expect(ids('button.primary.text')).toContain('color.bg.raised');
    expect(ids('button.primary.text')).not.toContain('button.primary.bg');
  });
});
