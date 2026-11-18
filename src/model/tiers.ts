import { hasRole, words } from '../semantic/pairs';
import { LEGACY_EXT } from '../legacy/types';
import type { Model, SourceFile, Token } from './types';

/**
 * Token tiers:
 *  - base (primitives): raw values such as `color.blue.500`;
 *  - semantic: what a value is for, such as `color.text.danger`;
 *  - component: one component's use of it, such as `button.primary.bg`.
 *
 * Read from the names a token sits under (its groups, file and folders) and
 * from what it does (a raw value, a reference, a component word); see `read`
 * below and docs/how-dtsanity-reads.md, step 6.
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

/** Layer words that mean different tiers in different systems: the tokens' behavior decides which. */
const AMBIGUOUS = new Set(['alias', 'aliases', 'global', 'globals', 'core']);

/** Where a tier name is written, nearest the token first. */
type NamedAt = 'group' | 'file' | 'folder';

interface Named {
  tier: Tier;
  /** The word as the files write it (“Primitives”). */
  word: string;
  at: NamedAt;
  /** False for words that mean different tiers in different systems (“aliases”, “global”). */
  clear: boolean;
}

/**
 * The tier a token's names state, and where: first its top two groups
 * (`semantic.color.bg`, a Tokens Studio set name such as `global`), nearest
 * first, then its file name (`primitives.tokens.json`), then the folders it is
 * in, nearest first (Primer's `base/`, `functional/`, `component/`). The
 * token's own name states nothing: `COLOR_SYSTEM_GREEN` names no layer.
 */
function layerOf(t: Token, fileName: string): Named | undefined {
  const groups = t.keyPath.slice(0, Math.min(2, t.keyPath.length - 1)).reverse().map((seg) => words(seg));
  const places: [NamedAt, string[]][] = [...groups.map((g): [NamedAt, string[]] => ['group', g]), ['file', fileWords(fileName)], ...folderWords(fileName).map((f): [NamedAt, string[]] => ['folder', f])];
  for (const [at, layer] of places) {
    for (const [tier, set] of [['component', COMPONENT_GROUP], ['base', BASE], ['semantic', SEMANTIC]] as const) {
      const word = layer.find((w) => set.has(w));
      if (word) return { tier, word: asWritten(word, ...t.keyPath.slice(0, 2), ...fileName.split('/').reverse()), at, clear: !AMBIGUOUS.has(word) };
    }
  }
  return undefined;
}

/** What a token does, with no tier name to go by: the default reading. */
function behaviorOf(t: Token, refs: readonly string[]): { tier: Tier; why: string } {
  const ws = words(t.id);
  const firstRole = ws.findIndex((w) => hasRole([w]));
  const beforeRole = firstRole < 0 ? ws : ws.slice(0, firstRole);
  const component = beforeRole.find((w) => COMPONENTS.has(w));
  if (component) return { tier: 'component', why: `“${component}” in its name is a component` };
  // A numbered step without a role word (`blue.500`) is a palette step, even when it is a reference.
  if (/^\d+$/.test(t.path.at(-1) ?? '') && firstRole < 0) return { tier: 'base', why: 'it is a numbered step of a scale' };
  return refs.length ? { tier: 'semantic', why: 'it points at another token' } : { tier: 'base', why: 'it holds a raw value' };
}

/** How DTsanity read a token's tier, and why, in words for the user. */
export interface TierReading {
  tier: Tier;
  why: string;
}

const where = (n: Named) => (n.at === 'group' ? `its group is named “${n.word}”` : n.at === 'file' ? `its file is named “${n.word}”` : `its folder is named “${n.word}”`);

/** A group whose clear tier name its tokens contradict as a whole. */
export interface TierMismatch {
  /** The group (or, for tokens at a file's top, the file) the name is on. */
  fileId: string;
  group: string;
  named: Tier;
  word: string;
  tokens: string[];
}

const cache = new WeakMap<Model, Map<string, Tier>>();

/**
 * What a token points at: its references or, in an older file that keeps the
 * resolved value beside the reference it came from (Style Dictionary's
 * `originalValue`), that reference: by its id, or by a name only one token has.
 */
export function pointsAt(t: Token, model: Model): string[] {
  if (t.refs.length) return t.refs;
  const original = (t.extensions?.[LEGACY_EXT] as { originalValue?: unknown } | undefined)?.originalValue;
  const m = typeof original === 'string' ? /^\{!?([^{}]+)\}$/.exec(original.trim()) : null;
  if (!m) return [];
  const name = m[1];
  if (model.tokens.has(name)) return [name];
  const named = [...model.tokens.values()].filter((x) => x.fileId === t.fileId && x.path.at(-1) === name);
  return named.length === 1 ? [named[0].id] : [];
}

const readings = new WeakMap<Model, { tiers: Map<string, TierReading>; mismatches: TierMismatch[] }>();

/**
 * Every token's tier, read from two signals that check each other:
 *  - what the names state (a group, file or folder named “primitives”,
 *    “semantic”, “components”…), the system's intent;
 *  - what the token does: holds a raw value (base), points at another token
 *    (semantic), or names a component (component).
 *
 * A clear name decides, and where the token does otherwise the tier rules
 * report it (a base token that points elsewhere, a semantic one with a raw
 * value). Behavior decides alone only where no name says anything, where the
 * word means different tiers in different systems (“aliases”, “global”), or
 * where a base file or folder name can't cover a file that holds two tiers
 * (one group pointing at another of the same file). A clear group name that its tokens
 * contradict as a whole (a “semantic” group of raw values the rest points at)
 * is kept, and asked about once, as a mismatch.
 */
function read(model: Model) {
  const known = readings.get(model);
  if (known) return known;
  const fileNames = new Map(model.files.map((f: SourceFile) => [f.id, f.name]));
  const all = [...model.tokens.values()];
  const groupKey = (t: Token) => `${t.fileId}\u0000${t.keyPath.length > 1 ? t.keyPath[0] : ''}`;
  const byGroup = new Map<string, Token[]>();
  for (const t of all) byGroup.set(groupKey(t), [...(byGroup.get(groupKey(t)) ?? []), t]);
  // Groups that other tokens point at, and groups whose references all go to another group of the same file.
  const pointedAt = new Set<string>();
  const intoSameFile = new Set<string>();
  for (const [key, members] of byGroup) {
    const targets = members.flatMap((t) => pointsAt(t, model)).map((r) => model.tokens.get(r));
    for (const r of targets) if (r && groupKey(r) !== key) pointedAt.add(groupKey(r));
    if (targets.length && targets.every((r) => r && r.fileId === members[0]!.fileId && groupKey(r) !== key && members[0]!.keyPath.length > 1)) intoSameFile.add(key);
  }
  // A file holds two tiers when one of its groups points at another of its groups.
  const twoTierFiles = new Set([...intoSameFile].map((k) => k.split('\u0000')[0]!));

  const tiers = new Map<string, TierReading>();
  const mismatches: TierMismatch[] = [];
  for (const [key, members] of byGroup) {
    const rawOnly = members.every((t) => !pointsAt(t, model).length);
    const allRefs = members.every((t) => pointsAt(t, model).length);
    const contradicted = rawOnly && pointedAt.has(key);
    for (const t of members) {
      const named = layerOf(t, fileNames.get(t.fileId) ?? '');
      const own = behaviorOf(t, pointsAt(t, model));
      let reading: TierReading;
      if (!named) reading = { tier: own.tier, why: `${own.why}; no tier name` };
      else if (!named.clear) {
        // The word allows either tier; what the whole group does picks one, and the token takes it.
        const tier: Tier = rawOnly && pointedAt.has(key) ? 'base' : allRefs ? 'semantic' : named.tier;
        const because = tier === 'base' && named.tier !== 'base' ? 'its group holds raw values other tokens point at' : tier === 'semantic' && named.tier !== 'semantic' ? 'its group points at other tokens' : `its group is named “${named.word}”`;
        reading = { tier, why: `${because}; “${named.word}” can name either tier` };
      } else if (named.tier === 'base' && named.at !== 'group' && twoTierFiles.has(t.fileId) && (intoSameFile.has(key) || pointedAt.has(key))) {
        // Only a base name can't cover a file whose groups point at each other: in a semantic or component file that is normal.
        reading = { tier: own.tier, why: `${own.why}; its file holds two tiers, so the name “${named.word}” doesn't cover it` };
      } else reading = { tier: named.tier, why: where(named) };
      tiers.set(t.id, reading);
    }
    // A clear semantic or component name on raw values the rest points at: kept, and asked about once.
    const named = layerOf(members[0]!, fileNames.get(members[0]!.fileId) ?? '');
    if (contradicted && named?.clear && named.tier !== 'base' && members.every((t) => tiers.get(t.id)!.tier === named.tier)) {
      mismatches.push({ fileId: members[0]!.fileId, group: members[0]!.keyPath.length > 1 ? members[0]!.keyPath[0]! : (fileNames.get(members[0]!.fileId) ?? ''), named: named.tier, word: named.word, tokens: members.map((t) => t.id) });
    }
  }
  const out = { tiers, mismatches };
  readings.set(model, out);
  return out;
}

/** The tier of every token in a model (computed once per model). */
export function tiersOf(model: Model): Map<string, Tier> {
  const known = cache.get(model);
  if (known) return known;
  const tiers = new Map([...read(model).tiers].map(([id, r]) => [id, r.tier]));
  cache.set(model, tiers);
  return tiers;
}

/** Each token's tier with the reason DTsanity read it so, for views and findings. */
export const tierReadings = (model: Model): Map<string, TierReading> => read(model).tiers;

/** Groups whose clear tier name their tokens contradict as a whole. */
export const tierMismatches = (model: Model): TierMismatch[] => read(model).mismatches;

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
