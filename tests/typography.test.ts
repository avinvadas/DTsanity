import { beforeEach, describe, expect, it } from 'vitest';
import { exportAs } from '../src/io/export';
import { isLoadError, parseSource } from '../src/io/load';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import type { Fix, Issue } from '../src/model/types';
import { addFiles, applyFixes, clearAll, store, updateSettings } from '../src/state/app';
import { analyze } from '../src/validate';
import { readFixture } from './helpers';

/**
 * Typography format checks, run over the same tokens split across files in
 * different ways: primitives + semantic files, one file, modes, loose tokens
 * with no composites, and a Tokens Studio export.
 */

const ON = { ...DEFAULT_SETTINGS, acceptLegacy: true };
const load = (name: string) => {
  const r = parseSource({ name: name.split('/').at(-1)!, text: readFixture(`typography/${name}`), origin: 'file' }, ON);
  if (isLoadError(r)) throw new Error(r.message);
  return r;
};
const issuesOf = (...names: string[]) => analyze(names.map(load), ON).issues;
const byTarget = (issues: Issue[]) => new Map(issues.map((i) => [`${i.code} ${i.target}`, i]));
const fixedValue = (i: Issue | undefined) => (i?.fix && 'edits' in i.fix ? (i.fix.edits[0] as { value: unknown }).value : undefined);

describe('split primitives and semantic files', () => {
  const found = byTarget(issuesOf('split/primitives.tokens.json', 'split/semantic.tokens.json'));

  it('accepts composites whose every part references another file', () => {
    for (const id of ['display', 'heading', 'body', 'code']) expect([...found.keys()].filter((k) => k.endsWith(`text.${id}`))).toEqual([]);
  });

  it('converts relative values against the referenced font size', () => {
    const label = found.get('legacy-value text.label');
    expect(fixedValue(label)).toMatchObject({ fontSize: '{font.size.200}', letterSpacing: { value: 0.0438, unit: 'rem' }, lineHeight: 1.429 });
  });

  it('notes a family with no generic fallback once, where it is written', () => {
    expect(found.get('font-fallback font.family.mono')?.severity).toBe('info');
    expect([...found.keys()].filter((k) => k.startsWith('font-fallback'))).toEqual(['font-fallback font.family.mono']);
  });
});

describe('one file', () => {
  const found = byTarget(issuesOf('single/typography.tokens.json'));

  it.each([
    ['percent-line-height', { lineHeight: 1.5 }],
    ['pixel-line-height', { lineHeight: 1.5 }],
    ['number-as-pixels', { lineHeight: 1.4 }],
    ['named-weight', { fontWeight: 'bold' }],
    ['css-stack', { fontFamily: ['Inter', 'Helvetica', 'sans-serif'] }],
    ['relative-tracking', { letterSpacing: { value: 0.02, unit: 'rem' } }],
    ['string-size', { fontSize: { value: 18, unit: 'px' }, letterSpacing: { value: 0, unit: 'px' }, lineHeight: 1.5 }],
  ])('%s is fixed to %j', (id, expected) => {
    const issue = [...found.values()].find((i) => i.target === `type.${id}`);
    expect(fixedValue(issue)).toMatchObject(expected);
  });

  it('flags a unitless line height that reads as pixels as a warning, not an error', () => {
    expect(found.get('inconsistent-value type.number-as-pixels')?.severity).toBe('warning');
  });

  it.each(['auto-line-height', 'zero-size', 'missing-parts'])('%s is an error with no automatic fix', (id) => {
    const issue = found.get(`invalid-value type.${id}`);
    expect(issue?.severity).toBe('error');
    expect(issue?.fix).toBeUndefined();
  });

  it('moves Tokens Studio properties into the legacy extension', () => {
    const fix = found.get('legacy-value type.studio-extras')?.fix as Extract<Fix, { edits: unknown }>;
    expect(fix.edits.map((e) => e.path.join('.'))).toEqual(['type.studio-extras.$value', 'type.studio-extras.$extensions.com.dtsanity.legacy']);
    expect((fix.edits[1] as { value: unknown }).value).toEqual({ valueProps: { textCase: 'uppercase', paragraphSpacing: '8' } });
  });

  it('leaves a clean style alone', () => {
    expect([...found.keys()].some((k) => k.endsWith('type.ok'))).toBe(false);
  });
});

describe('modes', () => {
  const found = byTarget(issuesOf('modes/typography.modes.tokens.json'));

  it("doesn't bake one mode's font size into a relative value", () => {
    const issue = found.get('invalid-value text.heading');
    expect(issue?.message).toContain('changes between modes');
    expect(issue?.fix).toBeUndefined();
  });

  it('accepts a composite whose referenced size varies by mode', () => {
    expect([...found.keys()].some((k) => k.endsWith('text.body'))).toBe(false);
  });
});

describe('loose tokens with no composites', () => {
  const found = byTarget(issuesOf('loose/typography-loose.tokens.json'));

  it('checks each part on its own', () => {
    expect(fixedValue(found.get('legacy-value fontFamily.base'))).toEqual(['Inter', 'system-ui', 'sans-serif']);
    expect(fixedValue(found.get('legacy-value fontSize.xs'))).toEqual({ value: 12, unit: 'px' });
    expect(fixedValue(found.get('legacy-value fontWeight.regular'))).toBe('regular');
    expect(fixedValue(found.get('legacy-value lineHeight.relaxed'))).toBe(1.6);
    expect(found.get('font-fallback fontFamily.display')?.severity).toBe('info');
  });
});

describe('Tokens Studio export', () => {
  beforeEach(() => {
    clearAll();
    updateSettings({ acceptLegacy: true });
  });

  it('converts pixel line heights and percent letter spacing against the style size', () => {
    const m = analyze([load('tokens-studio/typography-studio.json')], ON);
    expect(m.tokens.get('typography.overline')?.value).toMatchObject({ lineHeight: 1.333, letterSpacing: { value: 0.96, unit: 'px' } });
    expect(m.tokens.get('letterSpacing.none')?.value).toEqual({ value: 0, unit: 'px' });
    // A standalone percentage has no font size to convert against.
    expect(byTarget(m.issues).get('invalid-value letterSpacing.caps')?.fix).toBeUndefined();
  });

  it('keeps textCase through a fix and puts it back on export', () => {
    addFiles([load('tokens-studio/typography-studio.json')]);
    const issue = store.get().model.issues.find((i) => i.target === 'typography.overline')!;
    applyFixes([issue.fix!]);
    expect(store.get().model.tokens.get('typography.overline')?.rawValue).not.toHaveProperty('textCase');
    const back = JSON.parse(exportAs(store.get().files[0]!, 'original').text);
    expect(back.typography.overline.value.textCase).toBe('uppercase');
    expect(back.typography.overline).not.toHaveProperty('valueProps');
  });
});
