import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLoadError, parseSource } from '../../src/io/load';
import { DEFAULT_SETTINGS } from '../../src/model/defaults';
import type { Issue, Model, Settings, SourceFile } from '../../src/model/types';
import { allModels, type AppState } from '../../src/state/app';
import { mergeModels } from '../../src/themes/merge';
import { meaning, type Meaning } from './meaning';

/** The real-world token sets in samples/, and what the slow suites need to read them. */

export const SAMPLES = fileURLToPath(new URL('../../samples/', import.meta.url));

export const SETS = readdirSync(SAMPLES)
  .filter((d) => statSync(join(SAMPLES, d)).isDirectory())
  .sort();

function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return jsonFiles(p);
      return name.match(/\.json[5c]?$/) ? [p] : [];
    });
}

/** A set's files as name and text, in a stable order. */
export function setTexts(set: string): { name: string; text: string }[] {
  const dir = join(SAMPLES, set);
  return jsonFiles(dir).map((p) => ({ name: relative(dir, p), text: readFileSync(p, 'utf8') }));
}

export const SETTINGS: Settings = { ...DEFAULT_SETTINGS, acceptLegacy: true };

/** Parse texts as loaded files. */
export function parse(texts: { name: string; text: string }[], settings: Settings = SETTINGS): SourceFile[] {
  return texts.map(({ name, text }) => {
    const r = parseSource({ name, text, origin: 'file' }, settings);
    if (isLoadError(r)) throw new Error(`${name}: ${r.message} (${r.line}:${r.col})`);
    return r;
  });
}

/** Issues across every theme, as the Issues view, the cards and the fix prompt see them. */
export const issuesOf = (s: AppState): Issue[] => (s.themeModels.length ? mergeModels(s.themeModels) : s.model).issues;

/** A key for an issue that survives re-analysis: rule, file, place. */
export const issueKey = (i: Issue) => [i.code, i.fileId ?? '', i.target ?? '', (i.keyPath ?? []).join('.')].join(' | ');

export interface TokenView {
  type?: string;
  ok: boolean;
  /** The resolved value, as written after resolution. */
  value: unknown;
}

/** Every token in every theme model: model index → token id → type, resolution and value. */
export function tokensOf(s: AppState): Map<string, TokenView>[] {
  return allModels(s).map((m: Model) => {
    const out = new Map<string, TokenView>();
    for (const t of m.tokens.values()) out.set(t.id, { type: t.type, ok: t.resolution === 'ok', value: t.value });
    return out;
  });
}

/** A token's meaning, read with `type` (the type after fixes, which may name it better than before). */
export const meaningOf = (type: string | undefined, v: TokenView): Meaning => meaning(type ?? v.type, v.value);
