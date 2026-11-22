import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { isLoadError, parseSource } from '../src/io/load';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import type { SourceFile } from '../src/model/types';
import { addFiles, clearAll, store, updateSettings, type LoadError } from '../src/state/app';
import { diagnose, type DiagnosedView } from '../src/state/diagnose';

/**
 * An empty view says why, and where that is handled (corpus/empty-views.md):
 * the cases as the sample design systems show them.
 */

const ROOT = fileURLToPath(new URL('../samples/', import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.json[5c]?$/.test(n) ? [join(dir, n)] : []));

function load(set: string, acceptLegacy: boolean, only?: RegExp) {
  updateSettings({ ...DEFAULT_SETTINGS, acceptLegacy });
  const dir = join(ROOT, set);
  const ok: SourceFile[] = [];
  const bad: LoadError[] = [];
  for (const p of files(dir).filter((p) => !only || only.test(p))) {
    const r = parseSource({ name: relative(dir, p), text: readFileSync(p, 'utf8'), origin: 'file' }, store.get().settings);
    if (isLoadError(r)) bad.push(r);
    else ok.push(r);
  }
  clearAll();
  addFiles(ok, bad);
}
const empty = (view: DiagnosedView) => diagnose(view, 0).empty;

describe('why a view is empty', { timeout: 60_000 }, () => {
  afterAll(() => updateSettings({ ...DEFAULT_SETTINGS }));

  it('names files in an older format while legacy formats are off, in every view', () => {
    load('atlassian', false);
    for (const view of ['base', 'semantic', 'component', 'tokens'] as const) {
      expect(empty(view)?.text).toMatch(/4 files are in an older format/);
      expect(empty(view)?.to).toEqual({ issues: 'format' });
    }
  });

  it('names colors written as CSS strings, and the references that lead to them', () => {
    load('designsystemet', false);
    expect(empty('base')?.text).toMatch(/^131 colors are written as CSS strings/);
    expect(empty('semantic')?.text).toMatch(/^131 colors are written as CSS strings, such as "#0c1927", and 278 more refer to them\./);
    expect(empty('semantic')?.to).toEqual({ issues: 'values' });
  });

  it('names colors computed from expressions', () => {
    load('sap-horizon', true);
    expect(empty('base')?.text).toMatch(/colors are computed from an expression/);
  });

  it('names values by mode inside "$value", for colors and for themes', () => {
    load('gitlab', false);
    expect(diagnose('base', 156).partial?.text).toMatch(/hold one value per mode inside “\$value”/);
    expect(empty('themes')?.text).toMatch(/With legacy formats on, they’re read as themes/);
  });

  it('names references to tokens that aren’t loaded, when a semantic file is loaded alone', () => {
    load('carbon', false, /themes\/white\/theme/);
    expect(empty('semantic')?.text).toBe('207 colors refer to a token that isn’t loaded.');
    expect(empty('semantic')?.to).toEqual({ issues: 'references' });
  });

  it('says there is nothing to pair when only base colors are loaded, without calling it a problem', () => {
    load('carbon', false, /colors\.tokens/);
    expect(diagnose('base', 244)).toEqual({});
    expect(empty('semantic')).toBeUndefined();
  });

  it('says nothing about a set that reads in full', () => {
    load('carbon', false);
    expect(diagnose('semantic', 42)).toEqual({});
    expect(diagnose('tokens', 556)).toEqual({});
  });
});
