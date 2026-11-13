import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S } from '../src/model/defaults';
import { noFixNote, REMEDY, remedyOf, RULES } from '../src/policy/rules';
import { analyze } from '../src/validate';
import { loadText } from './helpers';

/**
 * The remedy labels are a promise to users about what DTsanity fixes. This
 * holds them to what the checks do, on every sample set and fixture: an
 * "Auto-fix" rule always offers a fix, and "Guided" and "Report only" rules
 * never do. Adding or removing a fix fails here until the label is updated.
 */

const json = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? json(join(dir, n)) : n.match(/\.json[5c]?$/) ? [join(dir, n)] : []));

function seen() {
  const sets: string[][] = [];
  const samples = fileURLToPath(new URL('../samples/', import.meta.url));
  for (const d of readdirSync(samples)) if (statSync(join(samples, d)).isDirectory()) sets.push(json(join(samples, d)));
  for (const p of json(fileURLToPath(new URL('./fixtures/', import.meta.url)))) sets.push([p]);
  const out = new Map<string, { fixed: number; not: number }>();
  for (const files of sets) {
    const loaded = files.map((p) => loadText(readFileSync(p, 'utf8'), p));
    for (const acceptLegacy of [true, false]) {
      for (const i of analyze(loaded, { ...S, acceptLegacy }).issues) {
        const e = out.get(i.code) ?? { fixed: 0, not: 0 };
        if (i.fix) e.fixed++;
        else e.not++;
        out.set(i.code, e);
      }
    }
  }
  return out;
}

describe('remedy labels', () => {
  const found = seen();

  it('match what each rule offers', () => {
    for (const [code, n] of found) {
      const remedy = remedyOf(code);
      if (remedy === 'fix') expect([code, n.not]).toEqual([code, 0]);
      if (remedy === 'guided' || remedy === 'none') expect([code, n.fixed]).toEqual([code, 0]);
    }
  });

  it('are not claimed for fixes the samples never show', () => {
    for (const r of RULES.filter((r) => r.remedy === 'fix')) {
      const n = found.get(r.id);
      if (n) expect([r.id, n.fixed > 0]).toEqual([r.id, true]);
    }
  });

  it('label every rule and say where to go when there is no fix', () => {
    for (const r of RULES) expect(REMEDY[r.remedy]).toBeDefined();
    for (const r of RULES.filter((r) => r.remedy === 'guided')) expect(noFixNote(r.id)).not.toMatch(/Use the tools in its view/);
    expect(remedyOf('no-such-rule')).toBe('none');
  });
});
