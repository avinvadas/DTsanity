/**
 * Every issue has a stable rule code (for tools, tests and the fix prompt)
 * and a short title naming the rule (for people). An issue reads as
 * Title · target · detail: the title says what's wrong in a few words, the
 * target says where, and the message adds only the facts the two leave out.
 */
export const RULE_TITLE: Record<string, string> = {
  // Format
  'legacy-format': 'Legacy format',
  'legacy-conversion': 'Converted from legacy',
  'no-tokens': 'No tokens',
  'unsupported-format': 'Unsupported format',
  'json5-syntax': 'JSON5 in a .json file',
  'resolver-missing': 'Resolver file not loaded',
  'file-not-in-theme': 'Not in any theme',
  // Structure
  'root-not-object': 'Top level not an object',
  'duplicate-key': 'Duplicate key',
  'duplicate-path': 'Defined twice',
  'invalid-node': 'Neither token nor group',
  'unknown-property': 'Unknown property',
  'token-has-children': 'Token contains children',
  'legacy-property': 'Legacy property',
  'invalid-name': 'Invalid name',
  'empty-group': 'Empty group',
  'token-group-conflict': 'Token and group clash',
  // References
  'unresolved-reference': 'Broken reference',
  'reference-to-group': 'Reference to a group',
  'circular-reference': 'Circular reference',
  'invalid-ref': 'Invalid $ref',
  'unresolved-ref': 'Broken $ref',
  'circular-extends': 'Circular $extends',
  'invalid-extends': 'Invalid $extends',
  'extends-token': '$extends targets a token',
  'unresolved-extends': 'Broken $extends',
  'embedded-reference': 'Reference inside text',
  'deprecated-reference': 'Uses a deprecated token',
  'tier-base-reference': 'Base token is an alias',
  'tier-reference': 'Wrong tier reference',
  'tier-hardcoded': 'Hard-coded value',
  // Types and values
  'unknown-type': 'Unknown type',
  'missing-type': 'Missing type',
  'alias-type-mismatch': 'Type mismatch',
  'invalid-value': 'Invalid value',
  'legacy-value': 'Legacy value',
  'inconsistent-value': 'Inconsistent value',
  // Metadata
  'invalid-description': 'Invalid $description',
  'invalid-type-property': 'Invalid $type',
  'invalid-deprecated': 'Invalid $deprecated',
  'invalid-extensions': 'Invalid $extensions',
  'extension-naming': 'Extension key naming',
};

/** The title for a rule code; an unknown code reads as words. */
export const ruleTitle = (code: string) => RULE_TITLE[code] ?? code.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
