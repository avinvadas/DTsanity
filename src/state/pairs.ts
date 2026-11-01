import { VISIONS, type Vision } from '../color/cvd';
import { applyPairEdits, checkPair, colorTokenIds, detectPairs, type Pair, type PairCheck } from '../semantic/pairs';
import { checkSiblings, detectSiblings, type SiblingCheck, type SiblingGroup } from '../semantic/siblings';
import { allModels, type AppState } from './app';

export interface PairRow {
  pair: Pair;
  /** Per vision type, one check per theme (or one without themes); undefined where a token is missing. */
  seen: Record<Vision, (PairCheck | undefined)[]>;
  /** False when the pair fails in any theme it exists in, with typical vision. */
  pass: boolean;
  /** Deficiencies under which the pair fails in some theme though it passes with typical vision. */
  cvdFails: Vision[];
}

export interface SiblingRow {
  group: SiblingGroup;
  /** One check per theme; undefined where fewer than two members exist. */
  checks: (SiblingCheck | undefined)[];
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
  const key = [s.model, s.themeModels, s.pairEdits, s.settings.contrast, s.settings.cvdDistance];
  if (cache && cache.key.every((k, i) => k === key[i])) return cache.result;
  const models = allModels(s);
  const colorIds = colorTokenIds(models);
  const pairs = applyPairEdits(detectPairs(colorIds), s.pairEdits);
  const rows = pairs.map((pair) => {
    const seen = Object.fromEntries(VISIONS.map(({ id }) => [id, models.map((m) => checkPair(pair, m, s.settings.contrast, id))])) as PairRow['seen'];
    const pass = passes(seen.normal);
    return { pair, seen, pass, cvdFails: pass ? VISIONS.filter(({ id }) => !passes(seen[id])).map((v) => v.id) : [] };
  });
  const siblings = detectSiblings(colorIds).map((group) => ({ group, checks: models.map((m) => checkSiblings(group, m, s.settings.cvdDistance)) }));
  const e = s.pairEdits;
  const result = { colorIds, rows, siblings, edited: e.added.length + e.removed.length + Object.keys(e.kinds).length > 0 };
  cache = { key, result };
  return result;
}

/** Whether a sibling group can't be told apart in some theme: with any vision type but achromatopsia (rare, so only informational). */
export const siblingFails = (r: SiblingRow) => r.checks.some((c) => c?.results.some((x) => !x.pass && x.vision !== 'achroma'));
