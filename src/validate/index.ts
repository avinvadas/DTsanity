import type { JNode } from '../json/cst';
import { buildModel, makeIssue } from '../model/build';
import { ruleTitle } from '../model/rules';
import { issuesWithPolicy } from '../policy/rules';
import { isMetaFile } from '../model/format';
import type { Issue, Model, Settings, SourceFile, ThemeScope } from '../model/types';
import { metadataRules } from './metadata';
import { referenceRules } from './references';
import { structureRules } from './structure';
import { tierRules } from './tiers';
import { typeAndValueRules } from './values';

const key = (i: Issue) => `${i.fileId}\u0000${(i.keyPath ?? []).join('\u0000')}`;

/** Build the model and run every rule. The result's `issues` holds model and rule findings together. */
export function analyze(files: SourceFile[], settings: Settings, scope: ThemeScope = {}): Model {
  const model = buildModel(files, settings, scope);
  const ruleIssues = [...structureRules(model), ...typeAndValueRules(model), ...referenceRules(model), ...metadataRules(model), ...tierRules(model)];

  // A legacy property in a group (`"value": "#fff"`) is reported, with a fix,
  // by the structure rules; drop the model's generic "not a token or group" for it.
  const legacy = new Set(ruleIssues.filter((i) => i.code === 'legacy-property').map(key));
  const modelIssues = model.issues.filter((i) => !(i.code === 'invalid-node' && legacy.has(key(i))));
  // A conversion note already explains an expression the converter couldn't translate.
  const noted = new Set(modelIssues.filter((i) => i.code === 'legacy-conversion').map(key));
  const rules = ruleIssues.filter((i) => !(i.code === 'embedded-reference' && noted.has(key(i))));

  for (const f of files) {
    if (f.doc.root.kind !== 'object' || (f.format === 'legacy' && !f.converted) || isMetaFile(f)) continue;
    // Counted in the file itself: tokens that a later file overrides are still this file's tokens.
    const tokens = countTokens(f.doc.root);
    if (tokens === 0) {
      // Content, but nothing DTCG or a supported legacy format calls a token: a format of its own.
      modelIssues.push(
        hasValues(f.doc.root)
          ? makeIssue('warning', 'format', 'unsupported-format', `${f.name} holds values but no tokens: it isn't DTCG, Tokens Studio or Style Dictionary, so DTsanity can't read it.`, { fileId: f.id })
          : makeIssue('info', 'format', 'no-tokens', `${f.name} has no “$value” anywhere.`, { fileId: f.id }),
      );
      continue;
    }
    const unsupported = unreadable(f, tokens, [...modelIssues, ...rules]);
    if (unsupported) modelIssues.push(unsupported);
  }
  model.issues = issuesWithPolicy([...modelIssues, ...rules], settings.policy);
  return model;
}

/**
 * Findings that mean a token can't be read as DTCG at all: no type or one
 * DTCG doesn't define, a value that doesn't fit, a structure DTCG doesn't
 * have, a name that breaks references. A type from Tokens Studio's own
 * vocabulary (`fontSizes`) is a supported legacy format: it comes with a fix,
 * and doesn't count.
 */
const UNREADABLE = new Set(['missing-type', 'unknown-type', 'invalid-value', 'invalid-node', 'unknown-property', 'invalid-name', 'token-has-children']);

/** Most of a file can't be read: it seems to use a format of its own. One warning for the file, saying what stops it. */
function unreadable(f: SourceFile, tokens: number, issues: Issue[]): Issue | undefined {
  if (tokens < 5) return undefined;
  const hit = new Map<string, Set<string>>();
  for (const i of issues) {
    if (i.fileId !== f.id || !UNREADABLE.has(i.code) || (i.code === 'unknown-type' && i.fix)) continue;
    // The token a finding is about: a property finding names the property after the token.
    const path = i.keyPath ?? [];
    const token = (i.code === 'unknown-property' || i.code === 'invalid-node' ? path.slice(0, -1) : path).join('.');
    hit.set(i.code, (hit.get(i.code) ?? new Set()).add(token));
  }
  const affected = new Set([...hit.values()].flatMap((s) => [...s])).size;
  if (affected < tokens / 2) return undefined;
  const top = [...hit]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 3)
    .map(([code, s]) => `${ruleTitle(code).toLowerCase()} (${s.size})`)
    .join(', ');
  const share = Math.min(affected, tokens);
  // The most common format of its own: one value per mode inside "$value" (GitLab's {"default", "dark"}, Cloudscape's {"light", "dark"}).
  const modes = modeValues(f.doc.root);
  const why =
    modes.tokens >= share / 2
      ? ` ${modes.tokens} of them hold one value per mode inside “$value” (${modes.keys.map((k) => `“${k}”`).join(', ')}), which DTCG doesn't define; DTCG puts modes in separate files or in “$extensions”.`
      : ' It seems to use a format of its own, not DTCG, Tokens Studio or Style Dictionary.';
  return makeIssue(
    'warning',
    'format',
    'unsupported-format',
    `${share} of the ${tokens} tokens in ${f.name} can't be read as DTCG: ${top}.${why} Checks that need values skip what they can't read.`,
    { fileId: f.id },
  );
}

/** Words that name a mode or theme. */
const MODE_KEY = /^(default|base|light|dark|day|night|dim|dimmed|high-?contrast|hc|contrast)$/i;

/** Tokens whose "$value" is an object of values by mode, and the mode keys they use. */
function modeValues(root: JNode): { tokens: number; keys: string[] } {
  let tokens = 0;
  const keys = new Set<string>();
  const visit = (n: JNode) => {
    if (n.kind !== 'object') return;
    const v = n.entries.find((e) => e.key === '$value')?.value;
    if (v?.kind === 'object' && v.entries.length >= 2 && v.entries.every((e) => !e.key.startsWith('$')) && v.entries.some((e) => MODE_KEY.test(e.key))) {
      tokens++;
      v.entries.forEach((e) => keys.add(e.key));
    }
    for (const e of n.entries) if (!e.key.startsWith('$')) visit(e.value);
  };
  visit(root);
  return { tokens, keys: [...keys].slice(0, 4) };
}

/** Tokens in a document: objects with a "$value". */
function countTokens(n: JNode): number {
  if (n.kind !== 'object') return 0;
  return (n.entries.some((e) => e.key === '$value') ? 1 : 0) + n.entries.reduce((sum, e) => sum + (e.key.startsWith('$') ? 0 : countTokens(e.value)), 0);
}

/** Whether a document holds any values outside "$" properties: content in some format. */
function hasValues(n: JNode): boolean {
  if (n.kind === 'object') return n.entries.some((e) => !e.key.startsWith('$') && hasValues(e.value));
  if (n.kind === 'array') return n.items.length > 0;
  return true;
}
