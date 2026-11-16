import { hasRole, words } from '../semantic/pairs';
import { LEGACY_EXT } from '../legacy/types';
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
const SEMANTIC = new Set(['semantic', 'semantics', 'sys', 'system', 'alias', 'aliases', 'decision', 'decisions', 'functional']);
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
    .replace(/\.(tokens\.)?json[5c]?$|\.tokens$/i, '')
    .split(/[.\-_\s]+/)
    .map((w) => w.toLowerCase());

/** `word` as `source` spells it (“Primitives” in `Primitives.json`), for names shown to the user. */
const asWritten = (word: string, ...sources: string[]) => {
  for (const s of sources) {
    const m = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(s);
    if (m) return m[0];
  }
  return word;
};

/** The folders a file is in, nearest first, each as its words (`functional/color/bg.json5` → functional's after color's). */
const folderWords = (name: string) =>
  name
    .split('/')
    .slice(0, -1)
    .reverse()
    .map((seg) => seg.split(/[.\-_\s]+/).map((w) => w.toLowerCase()));

/**
 * The layer a token's file names explicitly, and the word it uses for it:
 * first the top two groups (`semantic.color.bg`, a Tokens Studio set name
 * such as `global`), then the file name (`primitives.tokens.json`), then the
 * folders it is in, nearest first (Primer's `base/`, `functional/`, `component/`).
 */
function layerOf(t: Token, fileName: string): { tier: Tier; word: string } | undefined {
  // Groups only: a layer word in the token's own name (`COLOR_SYSTEM_GREEN`) names no layer.
  const top = t.keyPath.slice(0, Math.min(2, t.keyPath.length - 1)).flatMap((seg) => words(seg));
  for (const layer of [top, fileWords(fileName), ...folderWords(fileName)]) {
    for (const [tier, set] of [['component', COMPONENT_GROUP], ['base', BASE], ['semantic', SEMANTIC]] as const) {
      const word = layer.find((w) => set.has(w));
      if (word) return { tier, word: asWritten(word, ...t.keyPath.slice(0, 2), ...fileName.split('/').reverse()) };
    }
  }
  return undefined;
}

/** Whether a token's own groups name a layer (rather than only its file or folders). */
function groupLayer(t: Token): boolean {
  const top = t.keyPath.slice(0, Math.min(2, t.keyPath.length - 1)).flatMap((seg) => words(seg));
  return top.some((w) => BASE.has(w) || SEMANTIC.has(w) || COMPONENT_GROUP.has(w));
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

/**
 * What a token points at: its references or, in an older file that keeps the
 * resolved value beside the reference it came from (Style Dictionary's
 * `originalValue`), that reference: by its id, or by a name only one token has.
 */
function pointsAt(t: Token, model: Model): string[] {
  if (t.refs.length) return t.refs;
  const original = (t.extensions?.[LEGACY_EXT] as { originalValue?: unknown } | undefined)?.originalValue;
  const m = typeof original === 'string' ? /^\{!?([^{}]+)\}$/.exec(original.trim()) : null;
  if (!m) return [];
  const name = m[1];
  if (model.tokens.has(name)) return [name];
  const named = [...model.tokens.values()].filter((x) => x.fileId === t.fileId && x.path.at(-1) === name);
  return named.length === 1 ? [named[0].id] : [];
}

/** The tier of every token in a model (computed once per model). */
export function tiersOf(model: Model): Map<string, Tier> {
  const known = cache.get(model);
  if (known) return known;
  const names = new Map(model.files.map((f: SourceFile) => [f.id, f.name]));
  const tiers = new Map([...model.tokens.values()].map((t) => [t.id, tierOf(t, names.get(t.fileId))]));
  // A group named as a semantic layer that holds only values, while other
  // tokens point at it, is used as the base: what the files do outweighs the
  // word (older Style Dictionary files keep their raw palette under `aliases`).
  const groups = new Map<string, Token[]>();
  for (const t of model.tokens.values()) {
    if (tiers.get(t.id) !== 'semantic' || layerOf(t, names.get(t.fileId) ?? '')?.tier !== 'semantic') continue;
    // The group the layer word names, or the whole file for tokens at its top.
    const key = `${t.fileId}\u0000${t.keyPath.length > 1 ? t.keyPath[0] : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const members of groups.values()) {
    if (members.some((t) => t.refs.length)) continue;
    const inside = new Set(members.map((t) => t.id));
    const used = [...model.tokens.values()].some((t) => !inside.has(t.id) && pointsAt(t, model).some((r) => inside.has(r)));
    if (used) for (const t of members) tiers.set(t.id, 'base');
  }
  // A file named as a base layer (`base.raw.json`) that holds a group of
  // references pointing at another group of the same file holds two tiers:
  // the group that points is not base.
  const byGroup = new Map<string, Token[]>();
  for (const t of model.tokens.values()) {
    if (tiers.get(t.id) !== 'base' || t.keyPath.length < 2 || groupLayer(t)) continue;
    if (layerOf(t, names.get(t.fileId) ?? '')?.tier !== 'base') continue;
    const key = `${t.fileId}\u0000${t.keyPath[0]}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), t]);
  }
  for (const members of byGroup.values()) {
    const refs = members.flatMap((t) => t.refs.map((r) => model.tokens.get(r)));
    if (!refs.length) continue;
    const group = members[0]!;
    const elsewhere = refs.every((r) => r && r.fileId === group.fileId && r.keyPath[0] !== group.keyPath[0]);
    if (!elsewhere) continue;
    for (const t of members) if (t.refs.length && !/^\d+$/.test(t.path.at(-1) ?? '')) tiers.set(t.id, 'semantic');
  }
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

/**
 * Tiers the re-alias pickers offer a token of `tier`: a semantic token is
 * pointed at base tokens only, a component token at semantic or base ones.
 * Stricter than what the tier rules accept, which also let semantic tokens
 * point at each other.
 */
export const PICK_FROM: Record<Tier, readonly Tier[]> = {
  base: [],
  semantic: ['base'],
  component: ['semantic', 'base'],
};

/** Tiers a token of `tier` may reference. */
export const MAY_REFERENCE: Record<Tier, readonly Tier[]> = {
  base: [],
  semantic: ['base', 'semantic'],
  component: ['semantic', 'base'],
};

const names = new WeakMap<Model, Record<Tier, string>>();

/**
 * What the files call each tier: the layer word used most for it in group
 * or file names, spelled as they spell it (`primitives`, `Sys`), or the
 * generic name when none is used.
 * Comes from the files, so callers mask it.
 */
export function tierNames(model: Model): Record<Tier, string> {
  const known = names.get(model);
  if (known) return known;
  const files = new Map(model.files.map((f: SourceFile) => [f.id, f.name]));
  const seen: Record<Tier, Map<string, number>> = { base: new Map(), semantic: new Map(), component: new Map() };
  const tiers = tiersOf(model);
  for (const t of model.tokens.values()) {
    const l = layerOf(t, files.get(t.fileId) ?? '');
    if (l && tiers.get(t.id) === l.tier) seen[l.tier].set(l.word, (seen[l.tier].get(l.word) ?? 0) + 1);
  }
  const pick = (tier: Tier) => {
    const top = [...seen[tier]].sort((a, b) => b[1] - a[1])[0]?.[0];
    // As the files write it: “primitives” stays “primitives”.
    return top ?? TIER_LABEL[tier];
  };
  const out = { base: pick('base'), semantic: pick('semantic'), component: pick('component') };
  names.set(model, out);
  return out;
}
