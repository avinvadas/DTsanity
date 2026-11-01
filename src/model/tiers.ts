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

/** The tier of a token, from its name, its file name and its value. */
export function tierOf(t: Token, fileName = ''): Tier {
  const ws = words(t.id);
  const firstRole = ws.findIndex((w) => hasRole([w]));
  const beforeRole = firstRole < 0 ? ws : ws.slice(0, firstRole);
  const file = fileWords(fileName);
  // The top two levels name the layer when a file holds several (`semantic.color.bg`, `color.base.blue`).
  // Read from the place in the file, which includes a Tokens Studio set name (`global`).
  const top = t.keyPath.slice(0, 2).flatMap((seg) => words(seg));
  // An explicit layer name wins: first the top groups, then the file name.
  for (const layer of [top, file]) {
    if (layer.some((w) => COMPONENT_GROUP.has(w))) return 'component';
    if (layer.some((w) => BASE.has(w))) return 'base';
    if (layer.some((w) => SEMANTIC.has(w))) return 'semantic';
  }
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
