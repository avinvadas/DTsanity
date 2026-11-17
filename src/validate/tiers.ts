import { makeIssue } from '../model/build';
import { MAY_REFERENCE, pointsAt, TIER_LABEL, tierMismatches, tierReadings, tiersOf } from '../model/tiers';
import type { Issue, Model } from '../model/types';

/**
 * Tier rules: base tokens hold values of their own; semantic tokens point at
 * base or semantic tokens; component tokens at semantic or base tokens.
 * Semantic and component tokens with values of their own are noted.
 */
export function tierRules(model: Model): Issue[] {
  const tiers = tiersOf(model);
  const readings = tierReadings(model);
  const mismatches = tierMismatches(model);
  const asked = new Set(mismatches.flatMap((m) => m.tokens));
  const issues: Issue[] = [];
  // Asked once per group, not once per token: the name and what the group does disagree.
  for (const m of mismatches) {
    const first = model.tokens.get(m.tokens[0]!)!;
    issues.push(
      makeIssue(
        'info',
        'references',
        'tier-name-mismatch',
        `The group is named “${m.word}” (${TIER_LABEL[m.named].toLowerCase()}), but its ${m.tokens.length} tokens hold raw values that other tokens point at, as a palette does. Read as ${TIER_LABEL[m.named].toLowerCase()}, as named.`,
        { fileId: first.fileId, target: first.id, keyPath: first.keyPath.slice(0, 1), pos: groupPos(model, first.fileId, first.keyPath[0]!) ?? first.pos },
      ),
    );
  }
  for (const t of model.tokens.values()) {
    if (t.extendedFrom) continue;
    const tier = tiers.get(t.id)!;
    const why = ` Read as ${TIER_LABEL[tier].toLowerCase()}: ${readings.get(t.id)!.why}.`;
    const at = { fileId: t.fileId, target: t.id, keyPath: t.keyPath, pos: t.pos };
    if (tier === 'base' && t.refs.length) {
      // A whole-value reference that resolves can be replaced by the value it gives.
      const fix =
        t.aliasOf && t.resolution === 'ok' && t.value !== undefined
          ? {
              label: 'Write the value instead',
              preview: { before: String(t.rawValue), after: short(t.value) },
              edits: [{ fileId: t.fileId, path: [...t.keyPath, ...t.valuePath], value: t.value }],
            }
          : undefined;
      issues.push(
        makeIssue(
          'warning',
          'references',
          'tier-base-reference',
          `Points at ${t.refs.map((r) => `{${r}}`).join(', ')}; base tokens hold raw values.${why}`,
          at,
          fix,
        ),
      );
      continue;
    }
    for (const ref of new Set(t.refs)) {
      const to = tiers.get(ref);
      if (!to || MAY_REFERENCE[tier].includes(to)) continue;
      issues.push(
        makeIssue(
          'warning',
          'references',
          'tier-reference',
          `Points at ${TIER_LABEL[to].toLowerCase()} token {${ref}}; ${TIER_LABEL[tier].toLowerCase()} tokens point at ${MAY_REFERENCE[tier].map((x) => TIER_LABEL[x].toLowerCase()).join(' or ')}.${why}`,
          at,
        ),
      );
    }
    // A reference kept beside the value (Style Dictionary's originalValue) counts: the token does point at its base.
    if (tier !== 'base' && !pointsAt(t, model).length && !asked.has(t.id)) {
      issues.push(
        makeIssue(
          'info',
          'references',
          'tier-hardcoded',
          `${TIER_LABEL[tier]} token with a raw value; point it at a base token.${why}`,
          at,
        ),
      );
    }
  }
  return issues;
}

/** Where a top-level group starts in its file, for findings about the whole group. */
const groupPos = (model: Model, fileId: string, key: string) =>
  [...model.groups.values()].find((g) => g.fileId === fileId && g.keyPath.length === 1 && g.keyPath[0] === key)?.pos;

const short = (v: unknown) => {
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};
