import { toJS, type JNode } from '../json/cst';
import { ownModes } from '../model/modes';
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

/**
 * Pasted code is often part of a set: its references to tokens that weren't
 * pasted are expected, not broken. They become one note per pasted file,
 * with how many there are, instead of a broken reference each.
 */
function outsidePasted(issues: Issue[], files: SourceFile[]): Issue[] {
  const pasted = new Set(files.filter((f) => f.origin === 'paste').map((f) => f.id));
  if (!pasted.size) return issues;
  const outside = new Map<string, number>();
  const kept = issues.filter((i) => {
    if (i.code !== 'unresolved-reference' || !i.fileId || !pasted.has(i.fileId)) return true;
    outside.set(i.fileId, (outside.get(i.fileId) ?? 0) + 1);
    return false;
  });
  const notes = [...outside].map(([fileId, n]) =>
    makeIssue('info', 'references', 'outside-reference', `${n === 1 ? '1 reference points' : `${n} references point`} to tokens outside what was pasted. Paste or load those too.`, { fileId }),
  );
  return [...kept, ...notes];
}

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
          ? makeIssue('warning', 'format', 'unsupported-format', `Holds values but no tokens in DTCG, Tokens Studio or Style Dictionary form, so DTsanity can't read it.`, { fileId: f.id })
          : makeIssue('info', 'format', 'no-tokens', `Has no “$value” anywhere.`, { fileId: f.id }),
      );
      continue;
    }
    const unsupported = unreadable(f, tokens, [...modelIssues, ...rules]);
    if (unsupported) modelIssues.push(unsupported);
    const perMode = settings.acceptLegacy ? valuesPerMode(f) : undefined;
    if (perMode) modelIssues.push(perMode);
  }
  model.issues = issuesWithPolicy(outsidePasted([...modelIssues, ...rules], files), settings.policy);
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
      ? ` ${modes.tokens} of them hold one value per mode inside “$value” (${modes.keys.map((k) => `“${k}”`).join(', ')}). Move each mode to its own file, or under “$extensions”.`
      : '';
  return makeIssue(
    'warning',
    'format',
    'unsupported-format',
    `${share} of the ${tokens} tokens can't be read as DTCG: ${top}.${why}`,
    { fileId: f.id },
  );
}

/** Tokens that hold their values by mode in the token itself (see `ownModes`), the mode keys they use and where the map sits. */
function modeValues(root: JNode): { tokens: number; keys: string[]; where: string; first: string[] } {
  let tokens = 0;
  const keys = new Set<string>();
  const where = new Set<string>();
  const first: string[] = [];
  const visit = (n: JNode, path: string[]) => {
    if (n.kind !== 'object') return;
    // Only the two places a mode map can sit are read: a token's "$value", or "sets" in place of one.
    const own = n.entries.find((e) => e.key === '$value') ?? n.entries.find((e) => e.key === 'sets');
    const modes = own?.value.kind === 'object' ? ownModes({ [own.key]: toJS(own.value) }) : undefined;
    if (modes) {
      tokens++;
      Object.keys(modes.values).forEach((k) => keys.add(k));
      where.add(modes.path[0]!);
      if (first.length < 3) first.push(path.join('.'));
      return;
    }
    for (const e of n.entries) if (!e.key.startsWith('$')) visit(e.value, [...path, e.key]);
  };
  visit(root, []);
  return { tokens, keys: [...keys].slice(0, 4), where: [...where].map((w) => `“${w}”`).join(' or '), first };
}

/**
 * Tokens whose values by mode are written in the token itself, read as
 * themes when legacy formats are accepted: one finding per file, since it is
 * one way of writing the file, fixed where the file is made.
 */
function valuesPerMode(f: SourceFile): Issue | undefined {
  const m = modeValues(f.doc.root);
  if (!m.tokens) return undefined;
  const keys = m.keys.map((k) => `“${k}”`).join(', ');
  return makeIssue(
    'warning',
    'format',
    'value-per-mode',
    `${m.tokens} tokens hold one value per mode inside ${m.where} (${keys}; first: ${m.first.map((p) => `\`${p}\``).join(', ')}). DTCG gives a token one value: each mode's values go in a file of their own, chosen by a resolver document, or under “$extensions”. DTsanity read each mode as a theme.`,
    { fileId: f.id },
  );
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
