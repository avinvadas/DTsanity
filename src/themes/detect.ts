import { entry, toJS, type JNode } from '../json/cst';
import { buildModel, tokenSets } from '../model/build';
import { findFile } from '../model/build';
import type { ContrastLevel } from '../semantic/pairs';
import { isMetaFile, isResolverFile } from '../model/format';
import { tokenModes } from '../model/modes';
import type { Settings, SourceFile, ThemeScope } from '../model/types';

/**
 * Themes: alternative versions of the token set (light/dark, brands, high
 * contrast) that are checked separately over shared primitives.
 *
 * Detected from, in order of preference:
 *  1. a DTCG resolver document (`*.resolver.json`): its sets and modifiers;
 *  2. Tokens Studio `$themes` (in a multi-set file, or a separate `$themes.json`);
 *  3. file names: `semantic.light.json` + `semantic.dark.json`, with files
 *     that carry no theme word shared by every theme;
 *  4. files that define nearly the same tokens: alternatives of one set
 *     (`sap_horizon`, `sap_horizon_dark`, `sap_horizon_hcb`), one theme each;
 *  5. per-mode values in `$extensions` (`mode` or `<vendor>.modes`).
 * The user can edit the result.
 */

export type ThemeSource = 'resolver' | 'tokens-studio' | 'file-names' | 'same-tokens' | 'modes' | 'manual';

export interface Theme {
  id: string;
  name: string;
  source: ThemeSource;
  /** Files the theme reads, in load order. */
  fileIds: string[];
  scope: ThemeScope;
  /** How much contrast its pairs must have: enhanced for a high-contrast theme (from its name), editable. */
  contrast?: ContrastLevel;
  /** Tokens Studio: the theme's group (“Color scheme”), as written; the name is the theme's own (“Dark”). */
  group?: string;
  /** Tokens Studio: every theme this one is made of, one per group, as written (its own first). */
  combo?: { group: string; name: string }[];
  /** What the theme's source names but couldn't be read: files that aren't loaded, sources given inline. */
  missing?: string[];
}


const THEME_WORD = /(?:^|[^a-z0-9])(light|dark|dim|night|day|high-?contrast|hc)(?=[^a-z0-9]|$)/i;

const baseName = (name: string) => name.split('/').at(-1)!.replace(/\.(tokens\.)?json[5c]?$|\.tokens$/i, '');

export function detectThemes(files: SourceFile[], settings: Settings): Theme[] {
  const themes = fromResolver(files) ?? fromTokensStudio(files) ?? fromFileNames(files, settings) ?? fromSameTokens(files, settings) ?? fromModes(files, settings) ?? [];
  return themes.map((t) => (isHighContrast(t) ? { ...t, contrast: 'enhanced' as const } : t));
}

/** Names that mean a theme for low vision: high contrast, increased contrast, hc (SAP's hcb and hcw too). */
const HIGH_CONTRAST = /high[\s_-]?contrast|increased[\s_-]?contrast|(^|[^a-z])hc[bw]?($|[^a-z])/i;

/** A theme meant for high contrast, by its name, its group or what it is combined from. */
export const isHighContrast = (t: Pick<Theme, 'name' | 'group' | 'combo'>) =>
  [t.name, t.group ?? '', ...(t.combo ?? []).map((c) => c.name)].some((n) => HIGH_CONTRAST.test(n));

// ---------------------------------------------------------------------------
// DTCG resolver (2025.10)

type Source = { $ref?: unknown } & Record<string, unknown>;
interface Step {
  name: string;
  /** A set: its sources. A modifier: the sources of each context. */
  sources?: Source[];
  contexts?: Record<string, Source[]>;
  default?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sourcesOf = (v: unknown): Source[] => (Array.isArray(v) ? v.filter(isObj) : []);

/**
 * Themes from a resolver: one per combination of its modifiers' contexts
 * (Carbon's `theme` modifier gives white, g10, g90 and g100), each reading
 * the files of every set and of its contexts in `resolutionOrder`, so later
 * files override earlier ones as the resolver says.
 */
function fromResolver(files: SourceFile[]): Theme[] | undefined {
  const file = files.find((f) => isResolverFile(f));
  if (!file) return undefined;
  const doc = toJS(file.doc.root);
  if (!isObj(doc)) return undefined;
  const sets = isObj(doc.sets) ? doc.sets : {};
  const modifiers = isObj(doc.modifiers) ? doc.modifiers : {};
  const step = (item: unknown): Step | undefined => {
    if (!isObj(item)) return undefined;
    const ref = typeof item.$ref === 'string' ? /^#\/(sets|modifiers)\/(.+)$/.exec(item.$ref) : null;
    const def = ref ? (ref[1] === 'sets' ? sets : modifiers)[decodeURIComponent(ref[2]!).replace(/~1/g, '/').replace(/~0/g, '~')] : item;
    if (!isObj(def)) return undefined;
    const name = ref ? ref[2]! : typeof def.name === 'string' ? def.name : 'inline';
    if (isObj(def.contexts)) {
      const contexts = Object.fromEntries(Object.entries(def.contexts).map(([k, v]) => [k, sourcesOf(v)]));
      return { name, contexts, ...(typeof def.default === 'string' ? { default: def.default } : {}) };
    }
    return { name, sources: sourcesOf(def.sources) };
  };
  const order = (Array.isArray(doc.resolutionOrder) ? doc.resolutionOrder : []).map(step).filter((s): s is Step => !!s);
  if (!order.length) return undefined;

  const mods = order.filter((s) => s.contexts && Object.keys(s.contexts).length);
  // Every combination of one context per modifier.
  let combos: Record<string, string>[] = [{}];
  for (const m of mods) {
    const names = Object.keys(m.contexts!);
    // The default context first, so it is the first theme.
    if (m.default && names.includes(m.default)) names.sort((a, b) => (a === m.default ? -1 : b === m.default ? 1 : 0));
    combos = combos.flatMap((c) => names.map((n) => ({ ...c, [m.name]: n })));
  }
  return combos.map((combo, i) => {
    const fileIds: string[] = [];
    const missing: string[] = [];
    // Files a later step of the resolution order adds override earlier ones, as the resolver says (not a duplicate).
    const overlays: string[] = [];
    for (const [k, s] of order.entries()) {
      const sources = s.contexts ? (s.contexts[combo[s.name]!] ?? []) : (s.sources ?? []);
      for (const src of sources) {
        if (typeof src.$ref !== 'string') {
          missing.push(`a source written inside the resolver (in “${s.name}”)`);
          continue;
        }
        const f = findFile(files, src.$ref.split('#')[0]!, file.name);
        if (!f) missing.push(src.$ref);
        else if (!fileIds.includes(f.id)) {
          fileIds.push(f.id);
          if (k > 0) overlays.push(f.id);
        }
      }
    }
    const name = mods.length === 1 ? combo[mods[0]!.name]! : mods.length ? mods.map((m) => `${m.name}: ${combo[m.name]}`).join(' / ') : typeof doc.name === 'string' ? doc.name : 'Resolver';
    const theme: Theme = { id: `resolver:${i}`, name, source: 'resolver', fileIds, scope: overlays.length ? { overlays } : {} };
    if (missing.length) theme.missing = missing;
    return theme;
  });
}

// ---------------------------------------------------------------------------
// Tokens Studio

interface StudioTheme {
  name: string;
  group?: string;
  sets: string[];
}

function readStudioThemes(node: JNode | undefined): StudioTheme[] {
  if (node?.kind !== 'array') return [];
  const out: StudioTheme[] = [];
  for (const item of node.items) {
    const t = toJS(item.value) as { name?: unknown; group?: unknown; selectedTokenSets?: unknown };
    if (typeof t?.name !== 'string' || !t.selectedTokenSets || typeof t.selectedTokenSets !== 'object') continue;
    // "source" sets are read for references but not exported; both count for checking.
    const sets = Object.entries(t.selectedTokenSets as Record<string, unknown>)
      .filter(([, state]) => state === 'enabled' || state === 'source')
      .map(([set]) => set);
    const theme: StudioTheme = { name: t.name, sets };
    if (typeof t.group === 'string') theme.group = t.group;
    out.push(theme);
  }
  return out;
}

/**
 * Tokens Studio theme groups are dimensions that combine: one size, one
 * typography, one color scheme… A theme on its own is only part of a set. So
 * each theme is checked together with one theme from every other group: the
 * first one each group lists. The first combination is every group's first
 * theme; then each other theme of each group in turn, the rest unchanged. All
 * combinations would be too many to check (3 × 2 × 2 × 8 for Designsystemet);
 * these give every theme once, each with a whole set to resolve against.
 * Themes without a group stay themes of their own, as before.
 */
interface Combined {
  /** The theme that varies, and the group it is in. */
  name: string;
  group?: string;
  combo: StudioTheme[];
  /** The sets of every theme in the combination, in order, each once. */
  sets: string[];
}

function combine(defs: StudioTheme[]): Combined[] {
  const one = (d: StudioTheme): Combined => ({ name: d.name, ...(d.group ? { group: d.group } : {}), combo: [d], sets: d.sets });
  const groups = [...new Set(defs.map((d) => d.group ?? ''))].map((g) => defs.filter((d) => (d.group ?? '') === g));
  // No groups, or one: nothing to combine.
  if (groups.length < 2) return defs.map(one);
  const defaults = groups.map((g) => g[0]!);
  const make = (pick: StudioTheme, at: number): Combined => {
    const combo = [pick, ...defaults.filter((_, i) => i !== at)];
    return { name: pick.name, ...(pick.group ? { group: pick.group } : {}), combo, sets: [...new Set(combo.flatMap((d) => d.sets))] };
  };
  // The all-first combination is no one theme's: named by every theme in it, as written.
  const base = make(defaults[0]!, 0);
  const out: Combined[] = [{ ...base, name: defaults.map((d) => d.name).join(' · '), group: undefined }];
  groups.forEach((g, at) => g.slice(1).forEach((d) => out.push(make(d, at))));
  return out;
}

const comboOf = (c: Combined) => (c.combo.length > 1 ? { combo: c.combo.map((d) => ({ group: d.group ?? '', name: d.name })) } : {});
const groupOf = (c: Combined) => (c.group ? { group: c.group } : {});

function fromTokensStudio(files: SourceFile[]): Theme[] | undefined {
  // One multi-set file with $themes inside.
  for (const f of files) {
    const root = f.doc.root;
    const defs = root.kind === 'object' ? readStudioThemes(entry(root, '$themes')?.value) : [];
    const sets = tokenSets(root);
    if (defs.length < 2 || !sets) continue;
    const others = files.filter((x) => x !== f && !isMetaFile(x)).map((x) => x.id);
    return combine(defs).map((d, i) => ({
      id: `ts:${i}`,
      name: d.name,
      ...groupOf(d),
      ...comboOf(d),
      source: 'tokens-studio' as const,
      fileIds: [f.id, ...others],
      // In the file's own order of sets, which is the order Tokens Studio applies them in.
      scope: { sets: { [f.id]: sets.filter((s) => d.sets.includes(s)) } },
    }));
  }
  // A Tokens Studio folder export: $themes.json plus one file per set.
  const themesFile = files.find((f) => /(^|\/)\$themes\.json$/.test(f.name));
  const defs = themesFile ? readStudioThemes(themesFile.doc.root) : [];
  if (defs.length < 2) return undefined;
  // Sets are named by their path in the project ("primitives/modes/size/large"): a file is a set when its path
  // (less the extension) ends with it, so same-named files in different folders stay different sets.
  // Files dropped one by one have no folders: then a set is the one file with its last name, if only one has it.
  const path = (f: SourceFile) => f.name.replace(/\.json[5c]?$/i, '');
  const setFiles = new Map<string, Set<string>>();
  for (const set of new Set(defs.flatMap((d) => d.sets))) {
    const byPath = files.filter((f) => path(f) === set || path(f).endsWith(`/${set}`));
    const byName = files.filter((f) => path(f).split('/').at(-1) === set.split('/').at(-1));
    setFiles.set(set, new Set((byPath.length ? byPath : byName.length === 1 ? byName : []).map((f) => f.id)));
  }
  const isSet = (f: SourceFile, set: string) => !!setFiles.get(set)?.has(f.id);
  const allSets = defs.flatMap((d) => d.sets);
  const shared = files.filter((f) => !isMetaFile(f) && !allSets.some((set) => isSet(f, set))).map((f) => f.id);
  return combine(defs).map((d, i) => {
    const wanted = { has: (f: SourceFile) => d.sets.some((set) => isSet(f, set)) };
    return {
      id: `ts:${i}`,
      name: d.name,
      ...groupOf(d),
      ...comboOf(d),
      source: 'tokens-studio' as const,
      fileIds: files.filter((f) => shared.includes(f.id) || wanted.has(f)).map((f) => f.id),
      scope: {},
    };
  });
}

// ---------------------------------------------------------------------------
// File names

/** A theme while it is detected: with the names of the themes it builds on, if it is a variant. */
type Draft = Theme & { variantOf?: string[] };

/**
 * The file a theme file builds on: another file of the same theme whose name
 * it extends (`dark.dimmed` and `dark.high-contrast` on `dark`,
 * `atlassian-light-increased-contrast` on `atlassian-light`). The longest such
 * name, so a variant of a variant builds on its nearest parent.
 */
function parentOf(f: SourceFile, sameTheme: SourceFile[]): SourceFile | undefined {
  const name = baseName(f.name).toLowerCase();
  let best: SourceFile | undefined;
  for (const p of sameTheme) {
    const pn = baseName(p.name).toLowerCase();
    if (p === f || !name.startsWith(pn) || !/^[._-]./.test(name.slice(pn.length))) continue;
    if (!best || pn.length > baseName(best.name).length) best = p;
  }
  return best;
}

function fromFileNames(files: SourceFile[], settings: Settings): Theme[] | undefined {
  // Grouped without regard to case or spelling (hc, highcontrast, high-contrast); named as the first file writes it.
  const spelled = (f: SourceFile) => THEME_WORD.exec(baseName(f.name))?.[1];
  const word = (f: SourceFile) => spelled(f)?.toLowerCase().replace(/^highcontrast$/, 'high-contrast').replace(/^hc$/, 'high-contrast');
  const keys = [...new Set(files.map(word).filter((k): k is string => !!k))];
  if (keys.length < 2) return undefined;
  const shared = files.filter((f) => !word(f) && !isMetaFile(f)).map((f) => f.id);
  const themes: Draft[] = [];
  for (const k of keys) {
    const own = files.filter((f) => word(f) === k);
    const parent = new Map(own.map((f) => [f, parentOf(f, own)] as const));
    // Variants are themes of their own, read over the files they build on; the theme itself reads the rest.
    const variants = own.filter((f) => parent.get(f));
    const name = spelled(own[0]!)!;
    const base = own.filter((f) => !variants.includes(f));
    // A variant's files load last, each after the one it builds on, so they win.
    const fileIdsOf = (extra: SourceFile[]) => [...files.filter((f) => shared.includes(f.id) || base.includes(f)), ...extra].map((f) => f.id);
    themes.push({ id: `file:${k}`, name, source: 'file-names', fileIds: fileIdsOf([]), scope: {} });
    for (const v of variants) {
      const chain: SourceFile[] = [];
      for (let p: SourceFile | undefined = v; p && variants.includes(p); p = parent.get(p)) chain.unshift(p);
      // Named by what each step adds to the theme: dark → dark-dimmed → dark-dimmed-high-contrast.
      const steps = chain.map((c) => baseName(c.name).slice(baseName(parent.get(c)!.name).length + 1));
      const names = steps.map((_, i) => [name, ...steps.slice(0, i + 1)].join('-'));
      themes.push({ id: `file:${k}:${names.at(-1)}`, name: names.at(-1)!, source: 'file-names', fileIds: fileIdsOf(chain), scope: { overlays: chain.map((c) => c.id) }, variantOf: [name, ...names.slice(0, -1)] });
    }
  }
  return withModes(themes, files, settings);
}

/**
 * Themes named like the modes in `$extensions` read those modes: Primer's
 * `org.primer.overrides` hold each token's value in `dark`,
 * `dark-high-contrast`… A variant also reads the modes of the themes it
 * builds on, where it has none of its own.
 */
function withModes(themes: Draft[], files: SourceFile[], settings: Settings): Theme[] {
  const names = modeNames(files, settings);
  if (!names.size) return themes.map(({ variantOf: _, ...t }) => t);
  const has = (n: string) => names.has(n.toLowerCase());
  return themes.map(({ variantOf, ...t }) => {
    const chain = [...(variantOf ?? []), t.name].filter(has).map((n) => [...names.get(n.toLowerCase())!][0]!);
    if (!chain.length) return t;
    const mode = chain.at(-1)!;
    const fallback = chain.slice(0, -1);
    return { ...t, scope: { ...t.scope, mode, ...(fallback.length ? { modeFallback: fallback } : {}) } };
  });
}

/** The mode names tokens give values for, by lower-case name, as written. */
function modeNames(files: SourceFile[], settings: Settings): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const t of buildModel(files, settings).tokens.values()) {
    const modes = tokenModes(t, settings.acceptLegacy);
    if (modes) for (const m of Object.keys(modes.values)) out.set(m.toLowerCase(), (out.get(m.toLowerCase()) ?? new Set()).add(m));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Files that define the same tokens

/** How much of two files' tokens both define, as a share of each: alternatives define nearly all of each other's. */
const SAME_TOKENS = 0.8;
/** Files this small say too little to be told apart from a split set. */
const MIN_TOKENS = 10;

/**
 * Files that each define nearly every token the others define are
 * alternatives of one set, not parts of it: loaded together, every token
 * would be defined several times. Each becomes a theme, read over the files
 * that are not alternatives, and is named by what its file name adds to the
 * name they share (`sap_horizon_dark` → `dark`).
 */
function fromSameTokens(files: SourceFile[], settings: Settings): Theme[] | undefined {
  const candidates = files.filter((f) => !isMetaFile(f));
  const paths = new Map(candidates.map((f) => [f, new Set(buildModel([f], settings).tokens.keys())] as const));
  const big = candidates.filter((f) => paths.get(f)!.size >= MIN_TOKENS);
  const same = (a: SourceFile, b: SourceFile) => {
    const pa = paths.get(a)!;
    const pb = paths.get(b)!;
    let both = 0;
    for (const p of pa) if (pb.has(p)) both++;
    return both / pa.size >= SAME_TOKENS && both / pb.size >= SAME_TOKENS;
  };
  // Groups of alternatives; the largest one gives the themes.
  const groups: SourceFile[][] = [];
  for (const f of big) {
    const g = groups.find((members) => members.every((m) => same(m, f)));
    if (g) g.push(f);
    else groups.push([f]);
  }
  const alternatives = groups.filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (!alternatives) return undefined;
  const names = alternatives.map((f) => baseName(f.name));
  let common = names[0]!;
  for (const n of names) while (!n.startsWith(common)) common = common.slice(0, -1);
  const shared = candidates.filter((f) => !alternatives.includes(f));
  return alternatives.map((f, i) => {
    const own = names[i]!.slice(common.length).replace(/^[._\s-]+/, '');
    const name = own || names[i]!;
    return { id: `same:${name}`, name, source: 'same-tokens' as const, fileIds: [...shared, f].map((x) => x.id), scope: {} };
  });
}

// ---------------------------------------------------------------------------
// $extensions modes

function fromModes(files: SourceFile[], settings: Settings): Theme[] | undefined {
  const model = buildModel(files, settings);
  const names: string[] = [];
  for (const t of model.tokens.values()) {
    const modes = tokenModes(t, settings.acceptLegacy);
    if (modes) for (const m of Object.keys(modes.values)) if (!names.includes(m)) names.push(m);
  }
  if (names.length < 2) return undefined;
  const ids = files.filter((f) => !isMetaFile(f)).map((f) => f.id);
  return names.map((m) => ({ id: `mode:${m}`, name: m, source: 'modes' as const, fileIds: ids, scope: { mode: m } }));
}
