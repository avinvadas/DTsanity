import type { Issue, Severity } from '../model/types';
import { RULE_TITLE } from '../model/rules';

/**
 * The severity policy: every check DTsanity runs, with the level it reports
 * at. The defaults below are the built-in policy; the user's changes are kept
 * in Settings.policy (only the rules they changed) and edited on the Policy
 * page. "off" stops the check from reporting at all.
 */

export type Level = Severity | 'off';
export const LEVELS: readonly Level[] = ['error', 'warning', 'info', 'off'];

/** The user's changes to the defaults, by rule id. */
export type Policy = Readonly<Record<string, Level>>;

export type RuleGroup = 'Format' | 'Structure' | 'Types and values' | 'References' | 'Tiers' | 'Metadata' | 'Contrast' | 'Color blindness' | 'Base color scales' | 'Typography';

export interface RuleDef {
  /** Issue code, or the id of a check that isn't an issue (contrast, scale and typography checks). */
  id: string;
  group: RuleGroup;
  title: string;
  /** What the rule looks for, in one sentence. */
  about: string;
  level: Severity;
}

const rule = (group: RuleGroup, id: string, level: Severity, about: string, title = RULE_TITLE[id] ?? id): RuleDef => ({ id, group, title, about, level });

export const RULES: readonly RuleDef[] = [
  rule('Format', 'legacy-format', 'error', 'A Tokens Studio or Style Dictionary file loaded while legacy formats are off.'),
  rule('Format', 'legacy-conversion', 'warning', 'Something in a legacy file that has no exact DTCG equivalent.'),
  rule('Format', 'no-tokens', 'info', 'A file with no “$value” anywhere.'),
  rule('Format', 'file-not-in-theme', 'info', 'A file that no theme reads, so it goes unchecked.'),

  rule('Structure', 'root-not-object', 'error', 'The file’s top level is not a JSON object.'),
  rule('Structure', 'duplicate-key', 'warning', 'The same key twice in one object; only the last one counts.'),
  rule('Structure', 'duplicate-path', 'warning', 'The same token defined in more than one file or set.'),
  rule('Structure', 'invalid-node', 'error', 'An entry that is neither a token nor a group.'),
  rule('Structure', 'unknown-property', 'warning', 'A “$” property the DTCG format doesn’t define.'),
  rule('Structure', 'token-has-children', 'error', 'A token that also contains tokens or groups.'),
  rule('Structure', 'legacy-property', 'error', 'An older property such as “value” or “type” without the “$”.'),
  rule('Structure', 'invalid-name', 'error', 'A name containing “{”, “}” or “.”, which break references.'),
  rule('Structure', 'empty-group', 'info', 'A group with nothing in it.'),
  rule('Structure', 'token-group-conflict', 'error', 'A name used for a token in one place and a group in another.'),

  rule('Types and values', 'missing-type', 'error', 'A token with no “$type”, on it or on a parent group.'),
  rule('Types and values', 'unknown-type', 'error', 'A “$type” the DTCG format doesn’t define.'),
  rule('Types and values', 'alias-type-mismatch', 'warning', 'A reference to a token of a different type.'),
  rule('Types and values', 'invalid-value', 'error', 'A value that doesn’t fit its type.'),
  rule('Types and values', 'legacy-value', 'warning', 'A value in an older syntax, such as a color string where DTCG expects an object.'),
  rule('Types and values', 'inconsistent-value', 'warning', 'A value DTCG accepts but that is likely a mistake or read differently by tools.'),
  rule('Types and values', 'font-fallback', 'info', 'A font family list that doesn’t end with a generic family such as sans-serif.'),

  rule('References', 'unresolved-reference', 'error', 'A reference to a token that doesn’t exist.'),
  rule('References', 'reference-to-group', 'error', 'A reference to a group instead of a token.'),
  rule('References', 'circular-reference', 'error', 'References that lead back to themselves.'),
  rule('References', 'invalid-ref', 'error', 'A “$ref” that isn’t a valid JSON pointer.'),
  rule('References', 'unresolved-ref', 'error', 'A “$ref” to something that doesn’t exist.'),
  rule('References', 'circular-extends', 'error', 'A group that extends itself through “$extends”.'),
  rule('References', 'invalid-extends', 'error', 'An “$extends” that isn’t a reference.'),
  rule('References', 'extends-token', 'error', 'An “$extends” that points at a token, not a group.'),
  rule('References', 'unresolved-extends', 'error', 'An “$extends” to a group that doesn’t exist.'),
  rule('References', 'embedded-reference', 'warning', 'A reference written inside a longer text value.'),
  rule('References', 'deprecated-reference', 'info', 'A reference to a token marked “$deprecated”.'),

  rule('Tiers', 'tier-base-reference', 'warning', 'A base token that points at another token instead of holding a value.'),
  rule('Tiers', 'tier-reference', 'warning', 'A token that points at a tier it shouldn’t, such as base pointing at semantic.'),
  rule('Tiers', 'tier-hardcoded', 'info', 'A semantic or component token with a raw value instead of a reference.'),

  rule('Metadata', 'invalid-description', 'error', 'A “$description” that isn’t text.'),
  rule('Metadata', 'invalid-type-property', 'error', 'A “$type” that isn’t text.'),
  rule('Metadata', 'invalid-deprecated', 'error', 'A “$deprecated” that is neither true, false nor text.'),
  rule('Metadata', 'invalid-extensions', 'error', 'An “$extensions” that isn’t an object.'),
  rule('Metadata', 'extension-naming', 'warning', 'An “$extensions” key that isn’t a reverse domain name.'),

  rule('Contrast', 'contrast-text', 'error', 'A text pair below the selected contrast level.', 'Low text contrast'),
  rule('Contrast', 'contrast-ui', 'warning', 'An icon, border or other UI pair below the non-text level.', 'Low UI contrast'),

  rule('Color blindness', 'cvd-pair', 'warning', 'A pair that passes with typical vision but not with a color-vision deficiency.', 'Fails with color blindness'),
  rule('Color blindness', 'cvd-siblings', 'warning', 'Status colors (danger, warning, success…) too close to tell apart.', 'Status colors too close'),

  rule('Base color scales', 'scale-inversion', 'warning', 'A step lighter or darker than the order of the scale says.', 'Lightness out of order'),
  rule('Base color scales', 'scale-near-duplicate', 'warning', 'Two neighbouring steps that look almost the same.', 'Near-duplicate steps'),
  rule('Base color scales', 'scale-outside-gamut', 'warning', 'Steps outside the target gamut.', 'Outside the gamut'),
  rule('Base color scales', 'scale-hue-drift', 'info', 'A scale whose hue wanders across its steps.', 'Hue drift'),
  rule('Base color scales', 'scale-uneven-lightness', 'info', 'Lightness gaps between steps that vary a lot.', 'Uneven lightness'),
  rule('Base color scales', 'scale-missing-steps', 'info', 'Steps the other full palettes have and this one doesn’t.', 'Missing steps'),
  rule('Base color scales', 'scale-unordered', 'info', 'Step names that don’t follow a known scale.', 'Unknown step order'),
  rule('Base color scales', 'scale-p3', 'info', 'Display P3 colors outside sRGB, when the target gamut is P3.', 'Uses Display P3'),

  rule('Typography', 'type-same', 'warning', 'Text styles that resolve to exactly the same values.', 'Styles look the same'),
  rule('Typography', 'type-close', 'warning', 'Neighbouring sizes less than 10% apart, with the same family and weight.', 'Sizes too close'),
  rule('Typography', 'type-small', 'warning', 'Text smaller than 12px.', 'Text too small'),
];

const DEFAULTS = new Map(RULES.map((r) => [r.id, r.level]));

/** The level a rule reports at under `policy`. Rules not in the list keep `fallback`. */
export function levelOf(policy: Policy | undefined, id: string, fallback?: Severity): Level {
  return policy?.[id] ?? DEFAULTS.get(id) ?? fallback ?? 'warning';
}

/** The severity a check reports at, or undefined when the policy turns it off. */
export function severityOf(policy: Policy | undefined, id: string, fallback?: Severity): Severity | undefined {
  const l = levelOf(policy, id, fallback);
  return l === 'off' ? undefined : l;
}

/**
 * Give findings the severity the policy sets for their rule, dropping the
 * ones it turns off. `idOf` maps a finding to its rule id; a finding of a
 * rule the policy doesn't list keeps its own severity.
 */
export function withPolicy<T extends { severity: Severity }>(items: readonly T[], policy: Policy | undefined, idOf: (x: T) => string): T[] {
  if (!policy || !Object.keys(policy).length) return [...items];
  return items.flatMap((x) => {
    const id = idOf(x);
    const sev = DEFAULTS.has(id) || policy[id] ? severityOf(policy, id, x.severity) : x.severity;
    if (!sev) return [];
    return sev === x.severity ? [x] : [{ ...x, severity: sev }];
  });
}

export const issuesWithPolicy = (issues: readonly Issue[], policy: Policy | undefined) => withPolicy(issues, policy, (i) => i.code);

/** Keep only valid changes that differ from the defaults: what Settings.policy stores. */
export function cleanPolicy(raw: unknown): Record<string, Level> {
  const out: Record<string, Level> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, level] of Object.entries(raw as Record<string, unknown>)) {
    if (DEFAULTS.has(id) && LEVELS.includes(level as Level) && level !== DEFAULTS.get(id)) out[id] = level as Level;
  }
  return out;
}

/** The severest of `tones`, if any. */
export function severest(tones: Iterable<Severity | undefined>): Severity | undefined {
  const all = new Set(tones);
  return all.has('error') ? 'error' : all.has('warning') ? 'warning' : all.has('info') ? 'info' : undefined;
}
