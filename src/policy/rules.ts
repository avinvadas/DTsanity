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
  /** What DTsanity can do about a finding: see REMEDY. */
  remedy: Remedy;
}

/**
 * What DTsanity does about a rule's findings, stated so users know what is
 * fixed for them and what is left to them:
 * - fix: every finding comes with a one-click fix;
 * - sometimes: a fix when the right change is clear (a close match, an inferable type), otherwise none;
 * - guided: no automatic fix, but a tool here to work on it (re-aliasing, the curve editor, the themes matrix);
 * - none: reported and explained, and listed in the fix prompt, but the change is yours to make.
 * tests/remedy.test.ts holds the labels to what the checks actually do.
 */
export type Remedy = 'fix' | 'sometimes' | 'guided' | 'none';

export const REMEDY: Record<Remedy, { label: string; about: string }> = {
  fix: { label: 'Auto-fix', about: 'Every finding comes with a one-click fix.' },
  sometimes: { label: 'Fix when clear', about: 'A one-click fix when the right change is clear; otherwise the change is yours.' },
  guided: { label: 'Guided', about: 'No automatic fix, but DTsanity has a tool to work on it.' },
  none: { label: 'Report only', about: 'DTsanity finds and explains it; the change is yours to make.' },
};

/** Where to work on a guided rule's findings in DTsanity. */
const GUIDE: Record<string, string> = {
  'file-not-in-theme': 'Add the file to a theme in the themes matrix.',
  'contrast-text': 'Re-alias the pair in its tier view to a token that passes, or reshape the scale in the curve editor.',
  'contrast-ui': 'Re-alias the pair in its tier view to a token that passes, or reshape the scale in the curve editor.',
  'cvd-pair': 'Re-alias the pair in its tier view, or reshape the scale in the curve editor.',
  'cvd-siblings': 'Re-alias the status tokens in their tier view so they differ in lightness.',
};

const rule = (group: RuleGroup, id: string, level: Severity, remedy: Remedy, about: string, title = RULE_TITLE[id] ?? id): RuleDef => ({ id, group, title, about, level, remedy });

export const RULES: readonly RuleDef[] = [
  rule('Format', 'legacy-format', 'error', 'fix', 'A Tokens Studio or Style Dictionary file loaded while legacy formats are off.'),
  rule('Format', 'legacy-conversion', 'warning', 'none', 'Something in a legacy file that has no exact DTCG equivalent.'),
  rule('Format', 'no-tokens', 'info', 'none', 'A file with no “$value” anywhere.'),
  rule('Format', 'file-not-in-theme', 'info', 'guided', 'A file that no theme reads, so it goes unchecked.'),

  rule('Structure', 'root-not-object', 'error', 'none', 'The file’s top level is not a JSON object.'),
  rule('Structure', 'duplicate-key', 'warning', 'none', 'The same key twice in one object; only the last one counts.'),
  rule('Structure', 'duplicate-path', 'warning', 'none', 'The same token defined in more than one file or set.'),
  rule('Structure', 'invalid-node', 'error', 'none', 'An entry that is neither a token nor a group.'),
  rule('Structure', 'unknown-property', 'warning', 'sometimes', 'A “$” property the DTCG format doesn’t define.'),
  rule('Structure', 'token-has-children', 'error', 'none', 'A token that also contains tokens or groups.'),
  rule('Structure', 'legacy-property', 'error', 'sometimes', 'An older property such as “value” or “type” without the “$”.'),
  rule('Structure', 'invalid-name', 'error', 'sometimes', 'A name containing “{”, “}” or “.”, which break references.'),
  rule('Structure', 'empty-group', 'info', 'fix', 'A group with nothing in it.'),
  rule('Structure', 'token-group-conflict', 'error', 'none', 'A name used for a token in one place and a group in another.'),

  rule('Types and values', 'missing-type', 'error', 'sometimes', 'A token with no “$type”, on it or on a parent group.'),
  rule('Types and values', 'unknown-type', 'error', 'sometimes', 'A “$type” the DTCG format doesn’t define.'),
  rule('Types and values', 'alias-type-mismatch', 'warning', 'sometimes', 'A reference to a token of a different type.'),
  rule('Types and values', 'invalid-value', 'error', 'sometimes', 'A value that doesn’t fit its type.'),
  rule('Types and values', 'legacy-value', 'warning', 'fix', 'A value in an older syntax, such as a color string where DTCG expects an object.'),
  rule('Types and values', 'inconsistent-value', 'warning', 'sometimes', 'A value DTCG accepts but that is likely a mistake or read differently by tools.'),
  rule('Types and values', 'font-fallback', 'info', 'none', 'A font family list that doesn’t end with a generic family such as sans-serif.'),

  rule('References', 'unresolved-reference', 'error', 'sometimes', 'A reference to a token that doesn’t exist.'),
  rule('References', 'reference-to-group', 'error', 'sometimes', 'A reference to a group instead of a token.'),
  rule('References', 'circular-reference', 'error', 'none', 'References that lead back to themselves.'),
  rule('References', 'invalid-ref', 'error', 'none', 'A “$ref” that isn’t a valid JSON pointer.'),
  rule('References', 'unresolved-ref', 'error', 'none', 'A “$ref” to something that doesn’t exist.'),
  rule('References', 'circular-extends', 'error', 'none', 'A group that extends itself through “$extends”.'),
  rule('References', 'invalid-extends', 'error', 'none', 'An “$extends” that isn’t a reference.'),
  rule('References', 'extends-token', 'error', 'none', 'An “$extends” that points at a token, not a group.'),
  rule('References', 'unresolved-extends', 'error', 'none', 'An “$extends” to a group that doesn’t exist.'),
  rule('References', 'embedded-reference', 'warning', 'none', 'A reference written inside a longer text value.'),
  rule('References', 'deprecated-reference', 'info', 'none', 'A reference to a token marked “$deprecated”.'),

  rule('Tiers', 'tier-base-reference', 'warning', 'sometimes', 'A base token that points at another token instead of holding a value.'),
  rule('Tiers', 'tier-reference', 'warning', 'none', 'A token that points at a tier it shouldn’t, such as base pointing at semantic.'),
  rule('Tiers', 'tier-hardcoded', 'info', 'none', 'A semantic or component token with a raw value instead of a reference.'),

  rule('Metadata', 'invalid-description', 'error', 'fix', 'A “$description” that isn’t text.'),
  rule('Metadata', 'invalid-type-property', 'error', 'none', 'A “$type” that isn’t text.'),
  rule('Metadata', 'invalid-deprecated', 'error', 'none', 'A “$deprecated” that is neither true, false nor text.'),
  rule('Metadata', 'invalid-extensions', 'error', 'none', 'An “$extensions” that isn’t an object.'),
  rule('Metadata', 'extension-naming', 'warning', 'none', 'An “$extensions” key that isn’t a reverse domain name.'),

  rule('Contrast', 'contrast-text', 'error', 'guided', 'A text pair below the selected contrast level.', 'Low text contrast'),
  rule('Contrast', 'contrast-ui', 'warning', 'guided', 'An icon, border or other UI pair below the non-text level.', 'Low UI contrast'),

  rule('Color blindness', 'cvd-pair', 'warning', 'guided', 'A pair that passes with typical vision but not with a color-vision deficiency.', 'Fails with color blindness'),
  rule('Color blindness', 'cvd-siblings', 'warning', 'guided', 'Status colors (danger, warning, success…) too close to tell apart.', 'Status colors too close'),

  rule('Base color scales', 'scale-inversion', 'warning', 'guided', 'A step lighter or darker than the order of the scale says.', 'Lightness out of order'),
  rule('Base color scales', 'scale-near-duplicate', 'warning', 'guided', 'Two neighbouring steps that look almost the same.', 'Near-duplicate steps'),
  rule('Base color scales', 'scale-outside-gamut', 'warning', 'guided', 'Steps outside the target gamut.', 'Outside the gamut'),
  rule('Base color scales', 'scale-hue-drift', 'info', 'guided', 'A scale whose hue wanders across its steps.', 'Hue drift'),
  rule('Base color scales', 'scale-uneven-lightness', 'info', 'guided', 'Lightness gaps between steps that vary a lot.', 'Uneven lightness'),
  rule('Base color scales', 'scale-missing-steps', 'info', 'none', 'Steps the other full palettes have and this one doesn’t.', 'Missing steps'),
  rule('Base color scales', 'scale-unordered', 'info', 'none', 'Step names that don’t follow a known scale.', 'Unknown step order'),
  rule('Base color scales', 'scale-p3', 'info', 'none', 'Display P3 colors outside sRGB, when the target gamut is P3.', 'Uses Display P3'),

  rule('Typography', 'type-same', 'warning', 'none', 'Text styles that resolve to exactly the same values.', 'Styles look the same'),
  rule('Typography', 'type-close', 'warning', 'none', 'Neighbouring sizes less than 10% apart, with the same family and weight.', 'Sizes too close'),
  rule('Typography', 'type-small', 'warning', 'none', 'Text smaller than 12px.', 'Text too small'),
];

const DEFAULTS = new Map(RULES.map((r) => [r.id, r.level]));
const BY_ID = new Map(RULES.map((r) => [r.id, r]));

/** What DTsanity can do about a rule's findings; rules not in the list are report only. */
export const remedyOf = (id: string): Remedy => BY_ID.get(id)?.remedy ?? 'none';

/**
 * The line shown with a finding that has no one-click fix, saying so and
 * where the change can be made instead.
 */
export function noFixNote(id: string): string {
  const remedy = remedyOf(id);
  if (remedy === 'guided') return `No automatic fix. ${GUIDE[id] ?? (id.startsWith('scale-') ? 'Reshape the scale in the curve editor.' : 'Use the tools in its view.')}`;
  if (remedy === 'sometimes') return 'No automatic fix here: the right change isn’t clear. Edit the file, or use the fix prompt.';
  return 'DTsanity doesn’t fix this one: edit the file, or use the fix prompt.';
}

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
