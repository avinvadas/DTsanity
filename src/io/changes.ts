import type { AppState } from '../state/app';
import type { SourceFile } from '../model/types';
import { exportText } from './export';

/**
 * What changed in each file since it was loaded, token by token, for the
 * CHANGES.md that goes with the fixed files. Measured on the documents
 * themselves (not on the edit history), so undone edits don't show and
 * several edits to one token read as one change.
 */

export interface TokenChange {
  /** Dot-joined path of the token or property. */
  path: string;
  kind: 'changed' | 'added' | 'removed';
  before?: unknown;
  after?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isToken = (v: unknown) => isObject(v) && '$value' in v;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Token-level differences between two token documents: a token is compared whole, groups are walked. */
export function diffTokens(before: unknown, after: unknown, path: string[] = []): TokenChange[] {
  const at = path.join('.') || '(root)';
  if (same(before, after)) return [];
  if (before === undefined) return [{ path: at, kind: 'added', after }];
  if (after === undefined) return [{ path: at, kind: 'removed', before }];
  if (isObject(before) && isObject(after) && !isToken(before) && !isToken(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((k) => diffTokens(before[k], after[k], [...path, k]));
  }
  // A token whose value alone changed reads best as that value.
  if (isToken(before) && isToken(after)) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !same(b[k], a[k]));
    if (keys.length === 1 && keys[0] === '$value') return [{ path: at, kind: 'changed', before: b.$value, after: a.$value }];
  }
  return [{ path: at, kind: 'changed', before, after }];
}

/** A value as short readable text: references and strings as written, colors by hex, the rest as compact JSON. */
export function show(v: unknown): string {
  if (typeof v === 'string') return v;
  if (isObject(v) && typeof v.hex === 'string') return `${v.hex}${v.colorSpace && v.colorSpace !== 'srgb' ? ` (${v.colorSpace})` : ''}`;
  const json = JSON.stringify(v);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Changes per file, in DTCG terms: what was loaded (or its conversion) against what is there now. */
export function fileChanges(f: SourceFile): TokenChange[] {
  return diffTokens(parse(f.baseText), parse(exportText(f)));
}

const code = (s: string) => `\`${s.replaceAll('`', 'ˋ')}\``;

/**
 * CHANGES.md: the edits made in DTsanity, per file and token, then
 * the actions as they were applied. `notes` lists values that couldn't be
 * written back to a legacy format, per file name.
 */
export function changesMarkdown(s: Pick<AppState, 'files' | 'past'>, notes: ReadonlyMap<string, string[]> = new Map(), now = new Date()): string {
  const perFile = s.files.map((f) => ({ f, changes: fileChanges(f) }));
  const edited = perFile.filter((x) => x.changes.length);
  const total = edited.reduce((n, x) => n + x.changes.length, 0);
  const lines = [
    '# Token changes',
    '',
    `Made in DTsanity on ${now.toISOString().slice(0, 10)}. This folder holds the whole token set as it was loaded, with these changes applied; every file keeps its name and format.`,
    '',
    `${total} ${total === 1 ? 'change' : 'changes'} in ${edited.length} of ${s.files.length} ${s.files.length === 1 ? 'file' : 'files'}.`,
    '',
  ];
  for (const { f, changes } of edited) {
    lines.push(`## ${f.name}`, '');
    for (const c of changes) {
      if (c.kind === 'added') lines.push(`- Added ${code(c.path)}: ${code(show(c.after))}`);
      else if (c.kind === 'removed') lines.push(`- Removed ${code(c.path)} (was ${code(show(c.before))})`);
      else lines.push(`- ${code(c.path)}: ${code(show(c.before))} → ${code(show(c.after))}`);
    }
    lines.push('');
  }
  const unchanged = perFile.filter((x) => !x.changes.length).map((x) => x.f.name);
  if (unchanged.length) lines.push('## Unchanged', '', ...unchanged.map((n) => `- ${n}`), '');
  if (s.past.length) lines.push('## Actions, in order', '', ...s.past.map((p, i) => `${i + 1}. ${p.label}`), '');
  const lost = [...notes].filter(([, n]) => n.length);
  if (lost.length) {
    lines.push('## Not written back', '', 'These values have no equivalent in the file’s original format and were left out of it:', '');
    for (const [name, n] of lost) lines.push(`- ${name}: ${n.join('; ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
