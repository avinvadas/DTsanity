import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { isLoadError, parseSource } from '../src/io/load';
import { DEFAULT_SETTINGS } from '../src/model/defaults';
import type { SourceFile } from '../src/model/types';
import { addFiles, clearAll, store, updateSettings } from '../src/state/app';
import { palettesOf } from '../src/state/palettes';

/**
 * Smoke test over the real-world token sets in samples/: every file parses
 * and every set analyzes without throwing. Set SAMPLES_REPORT=1 to print a
 * summary per set.
 */

const ROOT = fileURLToPath(new URL('../samples/', import.meta.url));

function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return jsonFiles(p);
      return name.endsWith('.json') ? [p] : [];
    });
}

const sets = readdirSync(ROOT)
  .filter((d) => statSync(join(ROOT, d)).isDirectory())
  .sort();

describe('sample design systems', () => {
  beforeAll(() => updateSettings({ ...DEFAULT_SETTINGS, acceptLegacy: true }));

  it('has the sample sets', () => {
    expect(sets.length).toBeGreaterThanOrEqual(10);
  });

  it.each(sets)('%s loads and analyzes', (set) => {
    const dir = join(ROOT, set);
    const files: SourceFile[] = jsonFiles(dir).map((p) => {
      const r = parseSource({ name: relative(dir, p), text: readFileSync(p, 'utf8'), origin: 'file' }, store.get().settings);
      if (isLoadError(r)) throw new Error(`${set}/${relative(dir, p)}: ${r.message}`);
      return r;
    });
    expect(files.length).toBeGreaterThan(0);

    clearAll();
    addFiles(files);
    const s = store.get();
    expect(s.model.tokens.size).toBeGreaterThan(0);
    const palettes = palettesOf(s);

    if (process.env.SAMPLES_REPORT) {
      const by = (sev: string) => s.model.issues.filter((i) => i.severity === sev).length;
      const codes = new Map<string, number>();
      for (const i of s.model.issues) codes.set(i.code, (codes.get(i.code) ?? 0) + 1);
      const top = [...codes].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}×${n}`).join(', ');
      console.log(
        [
          set,
          `files ${files.length} (${[...new Set(files.map((f) => f.format))].join('/')})`,
          `tokens ${s.model.tokens.size}`,
          `themes ${s.themes.length}${s.themes.length ? ` [${s.themes.map((t) => t.name).join(', ')}]` : ''}`,
          `palettes ${palettes.palettes.length}`,
          `errors ${by('error')} warnings ${by('warning')} info ${by('info')}`,
          `top: ${top}`,
        ].join(' | '),
      );
    }
  });
});
