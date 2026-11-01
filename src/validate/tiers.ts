import { makeIssue, quote } from '../model/build';
import { MAY_REFERENCE, TIER_LABEL, tiersOf } from '../model/tiers';
import type { Issue, Model } from '../model/types';

/**
 * Tier rules: base tokens hold values of their own; semantic tokens point at
 * base or semantic tokens; component tokens at semantic or base tokens.
 * Semantic and component tokens with values of their own are noted.
 */
export function tierRules(model: Model): Issue[] {
  const tiers = tiersOf(model);
  const issues: Issue[] = [];
  for (const t of model.tokens.values()) {
    if (t.extendedFrom) continue;
    const tier = tiers.get(t.id)!;
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
          `${quote(t.id)} is a base token but points at ${t.refs.map(quote).join(', ')}. Base tokens hold values of their own; semantic and component tokens point at them.`,
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
          `${quote(t.id)} is a ${TIER_LABEL[tier].toLowerCase()} token but points at ${quote(ref)}, a ${TIER_LABEL[to].toLowerCase()} token. ${TIER_LABEL[tier]} tokens point at ${MAY_REFERENCE[tier].map((x) => TIER_LABEL[x].toLowerCase()).join(' or ')} tokens.`,
          at,
        ),
      );
    }
    if (tier !== 'base' && !t.refs.length) {
      issues.push(
        makeIssue(
          'info',
          'references',
          'tier-hardcoded',
          `${quote(t.id)} is a ${TIER_LABEL[tier].toLowerCase()} token with a value of its own. Pointing it at a base token keeps the value in one place.`,
          at,
        ),
      );
    }
  }
  return issues;
}

const short = (v: unknown) => {
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};
