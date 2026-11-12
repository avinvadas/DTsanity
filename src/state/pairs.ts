import { VISIONS, type Vision } from '../color/cvd';
import { applyPairEdits, checkPair, colorTokenIds, detectPairs, type Pair, type PairCheck } from '../semantic/pairs';
import { checkSiblings, detectSiblings, type SiblingCheck, type SiblingGroup } from '../semantic/siblings';
import { componentOf, tiersOf, type Tier } from '../model/tiers';
import { severityOf } from '../policy/rules';
import type { Severity } from '../model/types';
import { allModels, type AppState } from './app';

export interface PairRow {
  pair: Pair;
  /** Per vision type, one check per theme (or one without themes); undefined where a token is missing. */
  seen: Record<Vision, (PairCheck | undefined)[]>;
  /** False when the pair fails in any theme it exists in, with typical vision. True when the policy turns its contrast check off. */
  pass: boolean;
  /** The severity a contrast failure of this pair reports at (by the policy, for its kind). */
  tone: Severity;
  /** The severity of its color-vision failures. */
  cvdTone: Severity;
  /** Deficiencies under which the pair fails in some theme though it passes with typical vision. */
  cvdFails: Vision[];
  /** Component when either token is a component token in some theme; semantic otherwise. */
  tier: 'semantic' | 'component';
  /** Which of the two tokens are component tokens. */
  components: { fg: boolean; bg: boolean };
  /** Each token's tier, from the first theme that has it. */
  tiers: { fg: Tier; bg: Tier };
  /** For a component pair, the component it belongs to (`button`). */
  component?: string;
}

export interface SiblingRow {
  group: SiblingGroup;
  /** For a component group, the component it belongs to. */
  component?: string;
  /** Component when its members are component tokens; semantic otherwise. */
  tier: 'semantic' | 'component';
  /** One check per theme; undefined where fewer than two members exist. */
  checks: (SiblingCheck | undefined)[];
  /** The severity of the group's failures; undefined when the policy turns the check off. */
  tone?: Severity;
}

export interface PairsResult {
  /** Color tokens across every theme, for adding pairs by hand. */
  colorIds: string[];
  rows: PairRow[];
  siblings: SiblingRow[];
  /** True when the user changed the detected pairs. */
  edited: boolean;
}

let cache: { key: unknown[]; result: PairsResult } | undefined;

const passes = (checks: (PairCheck | undefined)[]) => checks.every((c) => !c || c.pass);

/** Pairs and sibling groups for the current state, checked in every theme and vision type; recomputed only when their inputs change. */
export function pairsOf(s: AppState): PairsResult {
  const key = [s.model, s.themeModels, s.pairEdits, s.settings.contrast, s.settings.cvdDistance, s.settings.policy];
  const policy = s.settings.policy;
  const cvdLevel = severityOf(policy, 'cvd-pair');
  const siblingLevel = severityOf(policy, 'cvd-siblings');
  if (cache && cache.key.every((k, i) => k === key[i])) return cache.result;
  const models = allModels(s);
  const colorIds = colorTokenIds(models);
  const pairs = applyPairEdits(detectPairs(colorIds), s.pairEdits);
  const tiers = models.map(tiersOf);
  const isComponent = (id: string) => tiers.some((t) => t.get(id) === 'component');
  const tierOfId = (id: string): Tier => tiers.map((t) => t.get(id)).find(Boolean) ?? 'semantic';
  const componentName = (id: string) => {
    const t = models.map((m) => m.tokens.get(id)).find(Boolean);
    return t ? componentOf(t) : id;
  };
  const rows = pairs.map((pair) => {
    const seen = Object.fromEntries(VISIONS.map(({ id }) => [id, models.map((m) => checkPair(pair, m, s.settings.contrast, id))])) as PairRow['seen'];
    const level = severityOf(policy, pair.kind === 'text' ? 'contrast-text' : 'contrast-ui');
    const measured = passes(seen.normal);
    // A check the policy turns off doesn't fail.
    const pass = measured || !level;
    const components = { fg: isComponent(pair.fg), bg: isComponent(pair.bg) };
    const tier: PairRow['tier'] = components.fg || components.bg ? 'component' : 'semantic';
    const component = tier === 'component' ? componentName(components.fg ? pair.fg : pair.bg) : undefined;
    return { pair, seen, pass, tier, components, tiers: { fg: tierOfId(pair.fg), bg: tierOfId(pair.bg) }, ...(component ? { component } : {}), tone: level ?? 'info', cvdTone: cvdLevel ?? 'info', cvdFails: measured && cvdLevel ? VISIONS.filter(({ id }) => !passes(seen[id])).map((v) => v.id) : [] };
  });
  const siblings = detectSiblings(colorIds).map((group) => ({
    group,
    tier: group.members.some(isComponent) ? ('component' as const) : ('semantic' as const),
    ...(group.members.some(isComponent) ? { component: componentName(group.members.find(isComponent)!) } : {}),
    checks: models.map((m) => checkSiblings(group, m, s.settings.cvdDistance)),
    ...(siblingLevel ? { tone: siblingLevel } : {}),
  }));
  const e = s.pairEdits;
  const result = { colorIds, rows, siblings, edited: e.added.length + e.removed.length + Object.keys(e.kinds).length > 0 };
  cache = { key, result };
  return result;
}

/** Whether a sibling group can't be told apart in some theme: with any vision type but achromatopsia (rare, so only informational). */
export const siblingFails = (r: SiblingRow) => r.tone !== undefined && r.checks.some((c) => c?.results.some((x) => !x.pass && x.vision !== 'achroma'));
