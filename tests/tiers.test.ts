import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import { componentOf, tierNames, tierReadings, tiersOf } from '../src/model/tiers';
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

  it('names tiers as the files do, or generically when they do not', () => {
    const model = analyze(
      [
        loadText(JSON.stringify({ color: { $type: 'color', gray: { 100: c(0.9) } } }), 'primitives.tokens.json'),
        loadText(JSON.stringify({ sys: { color: { $type: 'color', bg: { default: ref('color.gray.100') } } } })),
      ],
      DEFAULT_SETTINGS,
    );
    // As the files write them; the generic name only where they name none.
    expect(tierNames(model)).toEqual({ base: 'primitives', semantic: 'sys', component: 'Component' });
  });

  it('lets a layer group win over a component word', () => {
    const model = analyze([loadText(JSON.stringify({ components: { button: { bg: { $type: 'color', ...ref('base.blue') } } }, base: { blue: { $type: 'color', ...c(0.5) }, card: { $type: 'color', ...c(1) } } }))], DEFAULT_SETTINGS);
    const tiers = tiersOf(model);
    expect(tiers.get('components.button.bg')).toBe('component');
    expect(tiers.get('base.card')).toBe('base');
  });

  it('reads a layer from the folders a file is in (Primer: base/, functional/, component/)', () => {
    const m = analyze(
      [
        loadText(JSON.stringify({ base: { display: { blue: { '0': { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 1] } } } } } }), 'base/color/dark/display-dark.json5'),
        loadText(JSON.stringify({ display: { blue: { scale: { '0': { $type: 'color', $value: '{base.display.blue.0}' } } } } }), 'functional/color/display.json5'),
      ],
      DEFAULT_SETTINGS,
    );
    // A numbered step is a palette step only when nothing names its layer: here the folder does.
    expect(tiersOf(m).get('display.blue.scale.0')).toBe('semantic');
    expect(m.issues.filter((i) => i.code === 'tier-base-reference')).toEqual([]);
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
    // A semantic token is offered base tokens only.
    expect(ids('color.text.default').every((x) => !x.startsWith('color.bg.') && !x.startsWith('color.text.'))).toBe(true);
    // A component may point at semantic and base tokens, not at other components.
    expect(ids('button.primary.text')).toContain('color.bg.raised');
    expect(ids('button.primary.text')).not.toContain('button.primary.bg');
  });
});

describe('tier names and behavior', () => {
  const c = (v: number) => ({ $value: { colorSpace: 'srgb', components: [v, v, v] } });
  const ref = (id: string) => ({ $value: `{${id}}` });
  const codes = (m: ReturnType<typeof analyze>) => m.issues.map((i) => i.code);

  it('keeps a clear name and reports what contradicts it, with the reason', () => {
    const m = analyze(
      [
        loadText(JSON.stringify({ gray: { $type: 'color', 100: c(0.9), light: ref('gray.100') } }), 'primitives.tokens.json'),
        loadText(JSON.stringify({ text: { $type: 'color', default: ref('gray.100') } }), 'theme.tokens.json'),
      ],
      DEFAULT_SETTINGS,
    );
    // Named primitives, points at a token: still base, and flagged.
    expect(tiersOf(m).get('gray.light')).toBe('base');
    const flag = m.issues.find((i) => i.code === 'tier-base-reference' && i.target === 'gray.light')!;
    expect(flag.message).toContain('Read as base: its file is named “primitives”.');
    // No tier name: read by behavior, and the reason says so.
    expect(tierReadings(m).get('text.default')).toEqual({ tier: 'semantic', why: 'it points at another token; no tier name' });
  });

  it('asks once for a clearly named group its tokens contradict, instead of flagging each token', () => {
    const m = analyze(
      [
        loadText(JSON.stringify({ semantic: { $type: 'color', red: c(0.5), blue: c(0.2) } }), 'a.tokens.json'),
        loadText(JSON.stringify({ button: { $type: 'color', bg: ref('semantic.red'), fg: ref('semantic.blue') } }), 'b.tokens.json'),
      ],
      DEFAULT_SETTINGS,
    );
    expect(tiersOf(m).get('semantic.red')).toBe('semantic');
    expect(codes(m).filter((x) => x === 'tier-name-mismatch')).toHaveLength(1);
    expect(codes(m)).not.toContain('tier-hardcoded');
  });

  it('settles an ambiguous name by what its group does', () => {
    const m = analyze(
      [
        loadText(JSON.stringify({ global: { $type: 'color', link: ref('palette.blue'), focus: ref('palette.blue') }, palette: { $type: 'color', blue: c(0.2) } })),
      ],
      DEFAULT_SETTINGS,
    );
    // "global" usually names a base tier; a group of references reads as semantic, with no warning.
    expect(tierReadings(m).get('global.link')).toMatchObject({ tier: 'semantic', why: 'its group points at other tokens; “global” can name either tier' });
    expect(codes(m)).not.toContain('tier-base-reference');
  });
});
