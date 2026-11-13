import { entry, toJS, type JNode } from '../json/cst';
import { buildModel, tokenSets } from '../model/build';
import { findFile } from '../model/build';
import { isMetaFile, isResolverFile } from '../model/format';
import { modeValues } from '../model/modes';
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
 *  4. per-mode values in `$extensions` (`mode` or `<vendor>.modes`).
 * The user can edit the result.
 */

export type ThemeSource = 'resolver' | 'tokens-studio' | 'file-names' | 'modes' | 'manual';

export interface Theme {
  id: string;
  name: string;
  source: ThemeSource;
  /** Files the theme reads, in load order. */
  fileIds: string[];
  scope: ThemeScope;
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
  return fromResolver(files) ?? fromTokensStudio(files) ?? fromFileNames(files) ?? fromModes(files, settings) ?? [];
}

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
    for (const s of order) {
      const sources = s.contexts ? (s.contexts[combo[s.name]!] ?? []) : (s.sources ?? []);
      for (const src of sources) {
        if (typeof src.$ref !== 'string') {
          missing.push(`a source written inside the resolver (in “${s.name}”)`);
          continue;
        }
        const f = findFile(files, src.$ref.split('#')[0]!, file.name);
        if (!f) missing.push(src.$ref);
        else if (!fileIds.includes(f.id)) fileIds.push(f.id);
      }
    }
    const name = mods.length === 1 ? combo[mods[0]!.name]! : mods.length ? mods.map((m) => `${m.name}: ${combo[m.name]}`).join(' / ') : typeof doc.name === 'string' ? doc.name : 'Resolver';
    const theme: Theme = { id: `resolver:${i}`, name, source: 'resolver', fileIds, scope: {} };
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

function fromFileNames(files: SourceFile[]): Theme[] | undefined {
  // Grouped without regard to case or spelling (hc, highcontrast, high-contrast); named as the first file writes it.
  const spelled = (f: SourceFile) => THEME_WORD.exec(baseName(f.name))?.[1];
  const word = (f: SourceFile) => spelled(f)?.toLowerCase().replace(/^highcontrast$/, 'high-contrast').replace(/^hc$/, 'high-contrast');
  const keys = [...new Set(files.map(word).filter((k): k is string => !!k))];
  if (keys.length < 2) return undefined;
  const shared = files.filter((f) => !word(f) && !isMetaFile(f)).map((f) => f.id);
  return keys.map((k) => ({
    id: `file:${k}`,
    name: spelled(files.find((f) => word(f) === k)!)!,
    source: 'file-names' as const,
    fileIds: files.filter((f) => shared.includes(f.id) || word(f) === k).map((f) => f.id),
    scope: {},
  }));
}

// ---------------------------------------------------------------------------
// $extensions modes

function fromModes(files: SourceFile[], settings: Settings): Theme[] | undefined {
  const model = buildModel(files, settings);
  const names: string[] = [];
  for (const t of model.tokens.values()) {
    const modes = modeValues(t.extensions);
    if (modes) for (const m of Object.keys(modes.values)) if (!names.includes(m)) names.push(m);
  }
  if (names.length < 2) return undefined;
  const ids = files.filter((f) => !isMetaFile(f)).map((f) => f.id);
  return names.map((m) => ({ id: `mode:${m}`, name: m, source: 'modes' as const, fileIds: ids, scope: { mode: m } }));
}
