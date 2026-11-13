import { VISIONS } from '../color/cvd';
import { TARGETS } from '../contrast/levels';
import { formatContrast } from '../contrast/metrics';
import { ruleTitle } from '../model/rules';
import type { Issue } from '../model/types';
import type { AppState } from '../state/app';
import { pairsOf, siblingFails, type PairRow, type SiblingRow } from '../state/pairs';
import { palettesOf } from '../state/palettes';
import { mergeModels } from '../themes/merge';
import { PRINCIPLE, PROMPT_RULES, type PromptRule } from '../policy/principles';
import { withPolicy } from '../policy/rules';
import { rangeNotes, typeStyle, typographyIds } from '../semantic/typography';
import { allModels } from '../state/app';

/**
 * A prompt that lists every correction the checks found, for pasting into an
 * AI assistant or a ticket alongside the token files. Built only on request
 * and only copied to the clipboard: it names tokens, so it never leaves the
 * browser any other way.
 */

export interface FixPrompt {
  text: string;
  /** Corrections listed (required and optional), 0 when there is nothing to fix. */
  count: number;
}

/**
 * The findings a prompt covers, when not all of them: the issues, pairs and
 * status groups each test accepts, and the color scales when `scales` is set.
 * A kind with no test is left out.
 */
export interface PromptScope {
  issue?: (i: Issue) => boolean;
  pair?: (r: PairRow) => boolean;
  sibling?: (g: SiblingRow) => boolean;
  scales?: boolean;
  /** The typography range checks (styles alike, sizes too close, text too small). */
  typography?: boolean;
  /** Files that couldn't be read. */
  files?: boolean;
}

const code = (s: string) => `\`${s}\``;
const list = (xs: string[]) => xs.map(code).join(', ');

export function fixPrompt(s: AppState, scope?: PromptScope): FixPrompt {
  // Issues from every theme, not just the one on screen.
  const model = s.themeModels.length ? mergeModels(s.themeModels) : s.model;
  const themeNames = s.themeModels.map((m) => m.theme.name);
  const inTheme = (i: number) => (themeNames[i] ? ` in ${themeNames[i]}` : '');
  const fileName = new Map(s.files.map((f) => [f.id, f.name]));
  const pairs = pairsOf(s);
  const palettes = palettesOf(s).palettes.filter((p) => p.included);
  // What this prompt covers: everything, or only the findings in `scope`.
  const none = () => false;
  const issues = scope ? model.issues.filter(scope.issue ?? none) : model.issues;
  const rows = scope ? pairs.rows.filter(scope.pair ?? none) : pairs.rows;
  const sibs = scope ? pairs.siblings.filter(scope.sibling ?? none) : pairs.siblings;
  const pals = scope && !scope.scales ? [] : palettes;

  const required: string[] = [];
  // The kinds of findings listed, so the rules section states only the rules that apply to them.
  const listed = new Set<PromptRule['when']>(['always']);
  const optional: string[] = [];
  let count = 0;
  const section = (into: string[], title: string, items: string[]) => {
    if (!items.length) return;
    count += items.length;
    into.push(`## ${title} (${items.length})`, '', ...items.map((x) => `- ${x}`), '');
  };

  // Format, structure, references and tier rules, by file.
  // One line per issue, in the order the page shows it: place, title [rule], detail, fix.
  const issueLine = (i: Issue) => {
    const file = i.fileId ? fileName.get(i.fileId) : undefined;
    const where = [file && i.pos ? `${file}:${i.pos.line}` : file, i.target ? code(i.target) : undefined].filter(Boolean).join(' › ');
    const themes = i.themes?.length ? ` (${i.themes.join(', ')} only)` : '';
    const fix = i.fix ? ` Fix: ${i.fix.label}${i.fix.preview ? ` (${i.fix.preview.before} → ${i.fix.preview.after})` : ''}.` : '';
    return `${where ? `${where}: ` : ''}${ruleTitle(i.code)} [${i.code}]${themes}.${i.message ? ` ${i.message}` : ''}${fix}`;
  };
  const byFile = (xs: Issue[]) => [...xs].sort((a, b) => (fileName.get(a.fileId ?? '') ?? '').localeCompare(fileName.get(b.fileId ?? '') ?? ''));
  if (issues.some((i) => i.code.startsWith('tier-'))) listed.add('tiers');
  section(required, 'Errors', byFile(issues.filter((i) => i.severity === 'error')).map(issueLine));
  section(required, 'Warnings', byFile(issues.filter((i) => i.severity === 'warning')).map(issueLine));

  // Contrast with typical vision: every theme a pair fails in, with its value and the levels it misses.
  // Findings the policy sets to info go under Suggestions with the other info-level ones.
  const counted = (tone: string | undefined) => tone !== undefined && tone !== 'info';
  const contrastOf = (rows: typeof pairs.rows) => rows.flatMap((r) =>
    r.seen.normal.flatMap((c, i) => {
      if (!c || c.pass) return [];
      const misses = c.results.filter((x) => !x.pass).map((x) => `${x.level.label}, has ${formatContrast(x.value, x.level.metric)}`);
      return [`${code(r.pair.fg)} on ${code(r.pair.bg)} (${r.pair.kind === 'text' ? 'text' : 'UI part'})${inTheme(i)}: below ${misses.join('; ')}.`];
    }),
  );
  section(required, 'Contrast', contrastOf(rows.filter((r) => counted(r.tone))));

  // Color-vision: pairs that pass with typical vision but not with a deficiency, and status colors that look alike.
  const cvdOf = (rows: typeof pairs.rows) => rows.flatMap((r) =>
    r.cvdFails.flatMap((v) => {
      const label = VISIONS.find((x) => x.id === v)!.label;
      return r.seen[v].flatMap((c, i) => (c && !c.pass ? [`${code(r.pair.fg)} on ${code(r.pair.bg)}${inTheme(i)} drops below its contrast level with ${label}.`] : []));
    }),
  );
  // One line per status group and theme, naming every vision type it fails with.
  const seenWith = (v: string) => (v === 'normal' ? 'typical vision' : VISIONS.find((x) => x.id === v)!.label);
  const siblingsOf = (groups: typeof pairs.siblings) => groups.flatMap((g) =>
    g.checks.flatMap((c, i) => {
      const fails = (c?.results ?? []).filter((x) => !x.pass && x.vision !== 'achroma');
      if (!fails.length) return [];
      const members = [...new Set(fails.flatMap((x) => x.closest))];
      return [`Status colors ${list(members)} (${code(g.group.id)})${inTheme(i)} are too close to tell apart with ${fails.map((x) => `${seenWith(x.vision)} (${x.distance.toFixed(3)})`).join(', ')}; they need a difference of at least ${s.settings.cvdDistance} (ΔE OKLab). Separate them by lightness, not only hue.`];
    }),
  );
  section(required, 'Color-vision', [...cvdOf(rows.filter((r) => counted(r.cvdTone))), ...siblingsOf(sibs.filter((g) => counted(g.tone)))]);

  // Files that couldn't be read: they come first, since nothing in them was checked.
  const unread = !scope || scope.files ? s.loadErrors : [];
  if (unread.length) listed.add('files');
  section(required, "Files that couldn't be read", unread.map((e) => `${code(e.name)}${e.line ? ` (line ${e.line}, column ${e.col})` : ''}: ${e.message}`));

  // Typography: the range checks the tier views show, in each theme; a finding in only some themes says which.
  const typeNotes = new Map<string, { severity: string; themes: string[] }>();
  if (!scope || scope.typography) {
    allModels(s).forEach((m, i) => {
      for (const tier of ['semantic', 'component'] as const) {
        const styles = typographyIds(m, tier).map((id) => typeStyle(m.tokens.get(id)!, m));
        for (const n of withPolicy(rangeNotes(styles), s.settings.policy, (x) => `type-${x.code}`)) {
          const e = typeNotes.get(n.message) ?? { severity: n.severity, themes: [] };
          if (themeNames[i]) e.themes.push(themeNames[i]!);
          typeNotes.set(n.message, e);
        }
      }
    });
  }
  const typeLines = (sevs: string[]) =>
    [...typeNotes].filter(([, e]) => sevs.includes(e.severity)).map(([message, e]) => `${message}${e.themes.length && e.themes.length < themeNames.length ? ` (${e.themes.join(', ')} only)` : ''}`);
  section(required, 'Typography', typeLines(['error', 'warning']));

  // Base color scales.
  const scale = (...sevs: string[]) => pals.flatMap((p) => p.flags.filter((f) => sevs.includes(f.severity)).map((f) => `${code(p.id)}: ${f.message}`));
  section(required, 'Base color scales', scale('error', 'warning'));

  section(optional, 'Suggestions', [
    ...byFile(issues.filter((i) => i.severity === 'info')).map(issueLine),
    ...scale('info'),
    ...contrastOf(rows.filter((r) => r.tone === 'info')),
    ...cvdOf(rows.filter((r) => r.cvdTone === 'info')),
    ...siblingsOf(sibs.filter((g) => g.tone === 'info')),
    ...typeLines(['info']),
  ]);
  if (rows.some((r) => !r.pass || r.cvdFails.length)) listed.add('contrast');
  if (sibs.some(siblingFails)) listed.add('status');

  if (!count) return { text: '', count: 0 };
  // Be clear about what DTsanity could have done itself: those lines carry "Fix:", the rest it can't fix.
  const withFix = issues.filter((i) => i.fix).length;
  const fixNote = withFix
    ? `${withFix} of these ${withFix === 1 ? 'has' : 'have'} a one-click fix in DTsanity, given after “Fix:”. DTsanity can't make the other changes itself; they need a decision about the design.`
    : `DTsanity can't make these changes itself; they need a decision about the design.`;
  const targets = TARGETS.filter((t) => s.settings.contrast.includes(t.id)).map((t) => t.label);
  const enhanced = s.themes.filter((t) => t.contrast === 'enhanced').map((t) => t.name);
  const text = [
    '# Corrections for design token files',
    '',
    'DTsanity checked these design token files (DTCG format) for format, token tiers, contrast and color-vision accessibility. Apply the corrections below to the files.',
    '',
    fixNote,
    '',
    `Files: ${s.files.map((f) => f.name).join(', ')}`,
    themeNames.length ? `Themes: ${themeNames.join(', ')}` : '',
    targets.length ? `Contrast targets: ${targets.join(', ')}` : '',
    enhanced.length ? `Enhanced contrast (AAA text, or APCA Lc 75 text and Lc 60 UI) in: ${enhanced.join(', ')}` : '',
    '',
    `Rules (${PRINCIPLE.replace(/\.$/, '')}):`,
    ...PROMPT_RULES.filter((r) => listed.has(r.when)).map((r) => `- ${r.text}`),
    '',
    ...required,
    ...(optional.length ? ['# Optional', '', ...optional] : []),
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
    .trim();
  return { text: `${text}\n`, count };
}
