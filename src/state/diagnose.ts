import { colorInfo } from '../color/format';
import { isMetaFile } from '../model/format';
import { ownModes } from '../model/modes';
import { tiersOf } from '../model/tiers';
import type { Category, Issue, Model, Token } from '../model/types';
import { tokenColor } from '../semantic/pairs';
import { allModels, store, type AppState } from './app';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Why a view shows nothing, or less than the files hold, and where that is
 * handled. Follows the view's tokens through the stages a token passes to
 * reach it (files, format, types, values, references, tier) and names the
 * first stage where nothing is left. The cases are curated in
 * corpus/empty-views.md. The view says it and links to the place
 * (ui/blocked.ts); it fixes nothing itself.
 */

export type DiagnosedView = 'base' | 'semantic' | 'component' | 'tokens' | 'themes';

/** Where a case is handled. */
export type Place = { issues: Category } | 'tiers' | 'files';

export interface Cause {
  /** A problem (the data is there but can't be read), or nothing of this kind in the files. */
  kind: 'problem' | 'nothing';
  /** What the files hold, in one or two sentences. */
  text: string;
  /** How many tokens or files it accounts for, to put the largest first. */
  weight: number;
  to?: Place;
}

/**
 * What leaves a color token without a color, as the cause it names: `n` colors with the
 * problem themselves, and `via` references that lead to one of them.
 */
const more = (via: number) => (via ? `, and ${via} more refer to ${via === 1 ? 'one' : 'them'}` : '');
const COLOR_CAUSE: Record<string, (n: number, via: number) => string> = {
  // Not a finding: a value by mode inside "$value", found in the token itself.
  modes: (n, via) => `${plural(n, 'color holds', 'colors hold')} one value per mode inside “$value”${more(via)}. DTCG doesn’t define that; with legacy formats on, the modes are read as themes.`,
  'legacy-value': (n, via) => `${plural(n, 'color is', 'colors are')} written as CSS strings, such as "#0c1927"${more(via)}. DTCG reads colors only as color objects.`,
  'legacy-conversion': (n, via) => `${plural(n, 'color is', 'colors are')} computed from an expression${more(via)}. DTCG doesn’t read expressions.`,
  'embedded-reference': (n, via) => `${plural(n, 'color is', 'colors are')} computed from an expression${more(via)}. DTCG doesn’t read expressions.`,
  'invalid-value': (n, via) => `${plural(n, 'color value doesn’t', 'color values don’t')} fit the color type${more(via)}.`,
  'alias-type-mismatch': (n, via) => `${plural(n, 'color refers', 'colors refer')} to a token of another type${more(via)}.`,
  'unresolved-reference': (n, via) => `${plural(n, 'color refers', 'colors refer')} to a token that isn’t loaded${more(via)}.`,
  'circular-reference': (n, via) => `${plural(n, 'color has', 'colors have')} references that lead back to themselves${more(via)}.`,
  'reference-to-group': (n, via) => `${plural(n, 'color refers', 'colors refer')} to a group instead of a token${more(via)}.`,
};
/** When a token has several causes, the first one listed is its cause. */
const COLOR_ORDER = Object.keys(COLOR_CAUSE);

function deduped(models: readonly Model[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const i of models.flatMap((m) => m.issues)) {
    const k = `${i.code}|${i.fileId ?? ''}|${i.target ?? ''}|${i.message}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(i);
    }
  }
  return out;
}

/**
 * Files whose tokens never came in: unreadable, set aside, in an older format, or not an object (`hard`);
 * and files read only in part, in a format of their own (`soft`), whose finding says what stops them.
 */
function fileCauses(s: AppState, issues: readonly Issue[]): { hard?: Cause; soft?: Cause & { modes: boolean } } {
  const out: Cause[] = [];
  const filesWith = (code: string) => issues.filter((i) => i.code === code && i.fileId);
  const count = (list: Issue[]) => new Set(list.map((i) => i.fileId)).size;
  const n = s.loadErrors.length;
  if (n) out.push({ kind: 'problem', text: `${plural(n, 'file isn’t', 'files aren’t')} valid JSON, so nothing in ${n === 1 ? 'it' : 'them'} is read.`, weight: n, to: 'files' });
  const aside = s.setAside.length;
  if (aside) out.push({ kind: 'problem', text: `${plural(aside, 'file was', 'files were')} set aside as not token files.`, weight: aside, to: 'files' });
  const legacy = filesWith('legacy-format');
  if (legacy.length) out.push({ kind: 'problem', text: `${plural(count(legacy), 'file is', 'files are')} in an older format (Tokens Studio or Style Dictionary), and legacy formats are off.`, weight: count(legacy), to: { issues: legacy[0]!.category } });
  const root = filesWith('root-not-object');
  if (root.length) out.push({ kind: 'problem', text: `${plural(count(root), 'file has', 'files have')} a top level that isn’t a JSON object.`, weight: count(root), to: { issues: root[0]!.category } });
  const own = filesWith('unsupported-format');
  const k = count(own);
  const soft = k
    ? {
        kind: 'problem' as const,
        text: `${plural(k, 'file is', 'files are')} in a format of ${k === 1 ? 'its' : 'their'} own, so ${k === 1 ? 'its' : 'their'} tokens can’t be read as DTCG.`,
        weight: k,
        to: { issues: own[0]!.category },
        // The finding says when the format of its own is values by mode inside "$value".
        modes: own.some((i) => /per mode/.test(i.message)),
      }
    : undefined;
  return { hard: out.sort((a, b) => b.weight - a.weight)[0], soft };
}

/** Tokens with no type DTsanity knows, when no token at all is a color: none can be read as one. */
function untypedCause(issues: readonly Issue[]): Cause | undefined {
  const untyped = issues.filter((i) => (i.code === 'missing-type' || i.code === 'unknown-type') && i.target);
  const ids = new Set(untyped.map((i) => i.target));
  if (!ids.size) return undefined;
  return { kind: 'problem', text: `${plural(ids.size, 'token has', 'tokens have')} no type DTsanity knows, so none can be read as a color.`, weight: ids.size, to: { issues: untyped[0]!.category } };
}

/**
 * Color tokens without a color to show, by the finding that says why: the largest group first.
 * A reference without a finding of its own takes the finding of the color it leads to.
 */
function colorCauses(colors: readonly Token[], issues: readonly Issue[], byId: ReadonlyMap<string, Token>): Cause[] {
  const byTarget = new Map<string, Issue[]>();
  for (const i of issues) if (i.target) byTarget.set(i.target, [...(byTarget.get(i.target) ?? []), i]);
  // Its own cause: values by mode first (the findings on such a value only say it isn't a color), then its findings in order.
  const own = (t: Token): { code: string; category: Category } | undefined => {
    if (t.rawValue && typeof t.rawValue === 'object' && ownModes({ $value: t.rawValue })) return { code: 'modes', category: 'format' };
    const found = (byTarget.get(t.id) ?? []).filter((i) => COLOR_CAUSE[i.code]).sort((a, b) => COLOR_ORDER.indexOf(a.code) - COLOR_ORDER.indexOf(b.code))[0];
    return found && { code: found.code === 'embedded-reference' ? 'legacy-conversion' : found.code, category: found.category };
  };
  const groups = new Map<string, { direct: Set<string>; via: Set<string>; category: Category }>();
  for (const t of colors) {
    const seen = new Set<string>();
    for (let at: Token | undefined = t; at && !seen.has(at.id); at = at.aliasOf ? byId.get(at.aliasOf) : undefined) {
      seen.add(at.id);
      const c = own(at);
      if (!c) continue;
      const g = groups.get(c.code) ?? { direct: new Set<string>(), via: new Set<string>(), category: c.category };
      (at === t ? g.direct : g.via).add(t.id);
      groups.set(c.code, g);
      break;
    }
  }
  return [...groups]
    .filter(([, g]) => g.direct.size)
    .map(([code, g]) => ({ kind: 'problem' as const, text: COLOR_CAUSE[code]!(g.direct.size, g.via.size), weight: g.direct.size + g.via.size, to: { issues: g.category } }))
    .sort((a, b) => b.weight - a.weight);
}

export interface Diagnosis {
  /** The view has nothing to show: it shows this in place of its content. */
  empty?: Cause;
  /** The view shows some data, and this is the largest share of what it can't: one line above it. */
  partial?: Cause;
}

/**
 * Why a view shows nothing, or less. `shown` is how many items the view shows
 * (colors, pairs, tokens, themes). A view that shows something gets at most
 * the one line for its largest problem; an empty one the case it is in, or
 * nothing when the view explains its own emptiness (naming, components, themes).
 */
export function diagnose(view: DiagnosedView, shown: number): Diagnosis {
  const s = store.get();
  const models = allModels(s);
  const issues = deduped(models);
  const { hard, soft } = fileCauses(s, issues);
  // The base view reads the theme on show (the first, with all themes); the others read every theme.
  const scope = view === 'base' ? [s.model] : models;
  const tokens = scope.flatMap((m) => [...m.tokens.values()]);
  const byId = new Map(tokens.map((t) => [t.id, t]));
  const legacy = s.settings.acceptLegacy;
  const at = (empty: Cause | undefined, partial?: Cause): Diagnosis => (shown ? (partial ? { partial } : {}) : empty ? { empty } : {});

  // Stage 1, files: none with tokens, or none read.
  if (s.files.length && s.files.every(isMetaFile)) return at({ kind: 'problem', text: 'Only theme or metadata files are loaded, with no token files.', weight: 1, to: 'files' });
  if (!tokens.length) return at(hard ?? soft ?? { kind: 'nothing', text: 'The loaded files have no tokens.', weight: 0, to: 'files' });

  if (view === 'tokens') return at(undefined, hard ?? soft);
  if (view === 'themes') {
    // Values by mode in each token are read as themes only with legacy formats on; a format of its own may hold them too.
    const perMode = issues.find((i) => i.code === 'value-per-mode');
    if (!shown && perMode && !legacy) return { empty: { kind: 'problem', text: 'Values by mode are written inside each token, and legacy formats are off, so no themes are read from them.', weight: 1, to: { issues: perMode.category } } };
    if (!shown && soft?.modes) return { empty: { ...soft, text: 'Values by mode are written inside each token’s “$value”, which DTCG doesn’t define, so no themes are read from them.' + (legacy ? '' : ' With legacy formats on, they’re read as themes.') } };
    return at(undefined, hard ?? soft);
  }

  // The color views. Stage 2 and 3, format and types: no token can be read as a color.
  const colorTyped = tokens.filter((t) => t.type === 'color' || t.type === 'border');
  if (!colorTyped.length) return at(hard ?? soft ?? untypedCause(issues) ?? { kind: 'nothing', text: 'The loaded files have no color tokens.', weight: 0 });
  // Stage 4 and 5, values and references: colors that can't be read, by their cause.
  const unreadable = colorTyped.filter((t) => !tokenColor(t, legacy));
  const colorProblems = colorCauses(unreadable, issues, byId);

  if (view === 'base') {
    // Colors written as CSS strings have their own line in the view, with the switch: no second line for them here.
    const line = hard ?? colorProblems.find((c) => !c.text.includes('CSS strings')) ?? soft;
    const own = colorTyped.filter((t) => t.type === 'color' && !t.aliasOf && t.refs.length === 0 && !t.extendedFrom);
    if (!own.length) return at(hard ?? { kind: 'nothing', text: 'Every color in the loaded files refers to another token. Base colors hold values of their own: load the files that have them.', weight: 0, to: 'files' }, line);
    // Stage 6, tier: what is left is read as another tier.
    const tiers = tiersOf(s.model);
    const inBase = own.filter((t) => tiers.get(t.id) === 'base');
    if (!inBase.length) return at({ kind: 'problem', text: `All ${plural(own.length, 'color', 'colors')} with values of their own are read as semantic or component tokens.`, weight: own.length, to: 'tiers' }, line);
    if (!inBase.some((t) => colorInfo(t.value, legacy))) return at(hard ?? colorCauses(inBase, issues, byId)[0] ?? soft, line);
    return at(undefined, line);
  }

  // Semantic and component: pairs are found by name among the colors that can be read.
  const line = hard ?? colorProblems[0] ?? soft;
  if (unreadable.length === colorTyped.length) return at(hard ?? colorProblems[0] ?? soft, line);
  // Colors are there. With colors that can't be read, those are the likely missing pairs; else no pairs
  // is a naming or component matter, which the view explains itself.
  return at(view === 'semantic' ? (hard ?? colorProblems[0]) : undefined, line);
}
