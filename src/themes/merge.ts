import { makeIssue } from '../model/build';
import type { Edit, Issue, Model, SourceFile } from '../model/types';
import type { Theme } from './detect';

export interface ThemeModel {
  theme: Theme;
  model: Model;
}

const issueKey = (i: Issue) => [i.code, i.fileId, (i.keyPath ?? []).join('\u0000'), i.target, i.message].join('\u0001');

/**
 * The "all themes" view: every theme's issues together, each tagged with the
 * themes it occurs in (untagged when it occurs in all of them). Tokens and
 * palettes come from the first theme.
 *
 * A fix is kept only when it is safe for every theme that reads the file it
 * edits. A fix worked out from one theme's resolved values (writing a
 * reference's value in its place) can differ by theme; applied to a file the
 * themes share, it would give every theme that one theme's value. So a fix is
 * dropped when the themes offer different fixes for the same issue, or when
 * a theme that doesn't report the issue would see the edit too.
 */
export function mergeModels(list: readonly ThemeModel[]): Model {
  const seen = new Map<string, { issue: Issue; themes: string[]; fixes: Set<string> }>();
  for (const { theme, model } of list) {
    for (const issue of model.issues) {
      const key = issueKey(issue);
      const fix = issue.fix ? JSON.stringify(issue.fix) : '';
      const entry = seen.get(key);
      if (entry) {
        entry.themes.push(theme.name);
        entry.fixes.add(fix);
      } else seen.set(key, { issue, themes: [theme.name], fixes: new Set([fix]) });
    }
  }
  /**
   * Whether a theme that doesn't report the issue would still see the edit:
   * it reads the edited token, and the edit isn't confined to another mode's
   * value (`$extensions.mode.dark` is only read by the dark theme).
   */
  const sees = (model: Model, target: string | undefined, e: Edit) => {
    if (!model.files.some((f) => f.id === e.fileId)) return false;
    const t = target ? model.tokens.get(target) : undefined;
    if (!t || t.fileId !== e.fileId || !t.keyPath.every((k, i) => e.path[i] === k)) return !t && !target;
    const rel = e.path.slice(t.keyPath.length);
    const modeValue = rel[0] === '$extensions' && rel.length >= 3;
    return !modeValue || t.valuePath.every((k, i) => rel[i] === k);
  };
  const safe = ({ issue, themes, fixes }: { issue: Issue; themes: string[]; fixes: Set<string> }) => {
    if (!issue.fix || !('edits' in issue.fix)) return true;
    if (fixes.size > 1) return false;
    const others = list.filter((m) => !themes.includes(m.theme.name));
    return issue.fix.edits.every((e) => others.every((m) => !sees(m.model, issue.target, e)));
  };
  const issues = [...seen.values()].map((entry) => {
    const { issue, themes } = entry;
    let out = themes.length === list.length ? issue : { ...issue, themes };
    if (!safe(entry)) {
      const { fix: _, ...rest } = out;
      out = rest;
    }
    return out;
  });
  return { ...list[0]!.model, issues };
}

/** An info issue for each file that no theme reads (it would otherwise go unchecked). */
export function orphanIssues(orphans: readonly SourceFile[]): Issue[] {
  return orphans.map((f) =>
    makeIssue('info', 'format', 'file-not-in-theme', `${f.name} goes unchecked; add it to a theme in Themes.`, { fileId: f.id }),
  );
}
