import { hasRole, words } from '../semantic/pairs';
import type { Model, SourceFile, Token } from './types';

/**
 * Token tiers, read from names:
 *  - base (primitives): raw values such as `color.blue.500`;
 *  - semantic: what a value is for, such as `color.text.danger`;
 *  - component: one component's use of it, such as `button.primary.bg`.
 *
 * In order of precedence: a layer name in the top groups, then in the file
 * name (`primitives`, `semantic`, `components`…); then a component name
 * before any role word (`button.bg`); then a numbered step without a role word
 * (`blue.500`) is base; otherwise a literal value is base and a reference semantic.
 *
 * Allowed references: base tokens hold values only; semantic tokens point
 * at base or other semantic tokens; component tokens at semantic or base.
 */

export type Tier = 'base' | 'semantic' | 'component';

export const TIER_LABEL: Record<Tier, string> = { base: 'Base', semantic: 'Semantic', component: 'Component' };

const BASE = new Set(['primitive', 'primitives', 'base', 'core', 'global', 'globals', 'ref', 'reference', 'references', 'palette', 'palettes', 'foundation', 'foundations']);
const SEMANTIC = new Set(['semantic', 'semantics', 'sys', 'system', 'alias', 'aliases', 'decision', 'decisions']);
const COMPONENT_GROUP = new Set(['component', 'components', 'comp', 'cmp']);
/** Common component names. Words that are also roles (label, link) are left out. */
const COMPONENTS = new Set([
  'button', 'btn', 'input', 'field', 'textfield', 'textarea', 'select', 'checkbox', 'radio', 'switch', 'toggle',
  'card', 'badge', 'chip', 'tag', 'alert', 'banner', 'toast', 'snackbar', 'tooltip', 'modal', 'dialog', 'drawer',
  'menu', 'dropdown', 'tab', 'tabs', 'navbar', 'sidebar', 'avatar', 'table', 'popover', 'progress', 'slider',
  'accordion', 'breadcrumb', 'breadcrumbs', 'pagination', 'stepper', 'spinner', 'skeleton', 'datepicker', 'calendar',
]);

const fileWords = (name: string) =>
  name
    .split('/')
    .at(-1)!
    .replace(/\.(tokens\.)?json$|\.tokens$/i, '')
    .split(/[.\-_\s]+/)
    .map((w) => w.toLowerCase());

/**
 * The layer a token's file names explicitly, and the word it uses for it:
 * first the top two groups (`semantic.color.bg`, a Tokens Studio set name
 * such as `global`), then the file name (`primitives.tokens.json`).
 */
function layerOf(t: Token, fileName: string): { tier: Tier; word: string } | undefined {
  const top = t.keyPath.slice(0, 2).flatMap((seg) => words(seg));
  for (const layer of [top, fileWords(fileName)]) {
    for (const [tier, set] of [['component', COMPONENT_GROUP], ['base', BASE], ['semantic', SEMANTIC]] as const) {
      const word = layer.find((w) => set.has(w));
      if (word) return { tier, word };
    }
  }
  return undefined;
}

/** The tier of a token, from its name, its file name and its value. */
export function tierOf(t: Token, fileName = ''): Tier {
  const ws = words(t.id);
  const firstRole = ws.findIndex((w) => hasRole([w]));
  const beforeRole = firstRole < 0 ? ws : ws.slice(0, firstRole);
  // An explicit layer name wins.
  const named = layerOf(t, fileName);
  if (named) return named.tier;
  if (beforeRole.some((w) => COMPONENTS.has(w))) return 'component';
  // A numbered step without a role word (`blue.500`) is a palette step, even when it is a reference.
  if (/^\d+$/.test(t.path.at(-1) ?? '') && firstRole < 0) return 'base';
  return t.refs.length ? 'semantic' : 'base';
}

const cache = new WeakMap<Model, Map<string, Tier>>();

/** The tier of every token in a model (computed once per model). */
export function tiersOf(model: Model): Map<string, Tier> {
  const known = cache.get(model);
  if (known) return known;
  const names = new Map(model.files.map((f: SourceFile) => [f.id, f.name]));
  const tiers = new Map([...model.tokens.values()].map((t) => [t.id, tierOf(t, names.get(t.fileId))]));
  cache.set(model, tiers);
  return tiers;
}

const CATEGORY = new Set(['color', 'colors', 'colour', 'colours']);

/**
 * The component a component token belongs to: the first part of its name
 * that is neither a layer nor a category word, before any role word —
 * `button` for `components.color.button.primary.bg`.
 */
export function componentOf(t: Token): string {
  for (const seg of t.path) {
    const ws = words(seg);
    if (ws.some((w) => hasRole([w]))) break;
    if (ws.every((w) => COMPONENT_GROUP.has(w) || CATEGORY.has(w))) continue;
    return seg;
  }
  return t.path[0] ?? t.id;
}

/** Tiers a token of `tier` may reference. */
export const MAY_REFERENCE: Record<Tier, readonly Tier[]> = {
  base: [],
  semantic: ['base', 'semantic'],
  component: ['semantic', 'base'],
};

const names = new WeakMap<Model, Record<Tier, string>>();

/**
 * What the files call each tier: the layer word used most for it in group
 * or file names (`Primitives`, `Sys`), or the generic name when none is used.
 * Comes from the files, so callers mask it.
 */
export function tierNames(model: Model): Record<Tier, string> {
  const known = names.get(model);
  if (known) return known;
  const files = new Map(model.files.map((f: SourceFile) => [f.id, f.name]));
  const seen: Record<Tier, Map<string, number>> = { base: new Map(), semantic: new Map(), component: new Map() };
  for (const t of model.tokens.values()) {
    const l = layerOf(t, files.get(t.fileId) ?? '');
    if (l) seen[l.tier].set(l.word, (seen[l.tier].get(l.word) ?? 0) + 1);
  }
  const pick = (tier: Tier) => {
    const top = [...seen[tier]].sort((a, b) => b[1] - a[1])[0]?.[0];
    return top ? top[0]!.toUpperCase() + top.slice(1) : TIER_LABEL[tier];
  };
  const out = { base: pick('base'), semantic: pick('semantic'), component: pick('component') };
  names.set(model, out);
  return out;
}
