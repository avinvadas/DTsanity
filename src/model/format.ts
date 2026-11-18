import type { JDoc, JNode } from '../json/cst';
import type { FileFormat } from './types';

/**
 * Tell DTCG files (`$value`) apart from legacy ones (Tokens Studio,
 * Style Dictionary v3: `value` / `type` without the `$`).
 */
export function detectFormat(root: JNode): FileFormat {
  let dtcg = false;
  let legacy = false;
  const visit = (n: JNode): void => {
    if (dtcg) return;
    if (n.kind === 'array') {
      for (const it of n.items) visit(it.value);
      return;
    }
    if (n.kind !== 'object') return;
    for (const e of n.entries) {
      if (e.key === '$value') {
        dtcg = true;
        return;
      }
      if (e.key === 'value' && e.value.kind !== 'object') legacy = true;
      visit(e.value);
    }
  };
  visit(root);
  return dtcg ? 'dtcg' : legacy ? 'legacy' : 'unknown';
}

/** A value a design token would hold: a color, a size or time with its unit, or a reference. */
export const DESIGN_VALUE = /^\s*(#[0-9a-f]{3,8}|(rgb|hsl|oklch|oklab|lab|lch|color)a?\(|-?\d*\.?\d+(px|rem|em|%|ms|s|pt|dp|vw|vh)\s*$|\{[^{}]+\})/i;

/**
 * Whether JSON with no tokens DTsanity can read still looks meant as design
 * tokens: a DTCG key of any kind (`$type`, `$description`, a misspelled
 * `$valeu`), or a value a token would hold. A translation file or a config
 * has neither, and is set aside rather than checked.
 */
export function looksLikeTokens(root: JNode): boolean {
  let found = false;
  const visit = (n: JNode): void => {
    if (found) return;
    if (n.kind === 'array') for (const it of n.items) visit(it.value);
    else if (n.kind === 'object') {
      for (const e of n.entries) {
        if (e.key.startsWith('$')) {
          found = true;
          return;
        }
        visit(e.value);
      }
    } else if (n.kind === 'string' && DESIGN_VALUE.test(n.value)) found = true;
  };
  visit(root);
  return found;
}

/** Tokens Studio project files (`$themes.json`, `$metadata.json`) that hold metadata rather than tokens. */
export const isStudioMetaFile = (f: { name: string }) => /(^|\/)\$(themes|metadata)\.json$/.test(f.name);

/** A DTCG resolver document: which token files make up each theme. Named `*.resolver.json`, or recognised by its `resolutionOrder`. */
export const isResolverFile = (f: { name: string; doc?: JDoc }) =>
  /\.resolver\.json5?$/i.test(f.name) || (f.doc?.root.kind === 'object' && f.doc.root.entries.some((e) => e.key === 'resolutionOrder'));

/** DTsanity's own configuration file, kept beside the tokens for the offline check (docs/how-dtsanity-reads.md). */
export const isConfigFile = (f: { name: string }) => /(^|\/)dtsanity\.config\.json$/.test(f.name);

/** Files that describe the set rather than hold tokens: Tokens Studio metadata, DTCG resolver documents and DTsanity's configuration. */
export const isMetaFile = (f: { name: string; doc?: JDoc }) => isStudioMetaFile(f) || isResolverFile(f) || isConfigFile(f);
