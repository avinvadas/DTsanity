import { VISIONS } from '../color/cvd';
import { TARGETS } from '../contrast/levels';
import { formatContrast } from '../contrast/metrics';
import { ruleTitle } from '../model/rules';
import type { Issue } from '../model/types';
import type { AppState } from '../state/app';
import { pairsOf } from '../state/pairs';
import { palettesOf } from '../state/palettes';
import { mergeModels } from '../themes/merge';

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

const code = (s: string) => `\`${s}\``;
const list = (xs: string[]) => xs.map(code).join(', ');

export function fixPrompt(s: AppState): FixPrompt {
  // Issues from every theme, not just the one on screen.
  const model = s.themeModels.length ? mergeModels(s.themeModels) : s.model;
  const themeNames = s.themeModels.map((m) => m.theme.name);
  const inTheme = (i: number) => (themeNames[i] ? ` in ${themeNames[i]}` : '');
  const fileName = new Map(s.files.map((f) => [f.id, f.name]));
  const pairs = pairsOf(s);
  const palettes = palettesOf(s).palettes.filter((p) => p.included);

  const required: string[] = [];
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
  section(required, 'Errors', byFile(model.issues.filter((i) => i.severity === 'error')).map(issueLine));
  section(required, 'Warnings', byFile(model.issues.filter((i) => i.severity === 'warning')).map(issueLine));

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
  section(required, 'Contrast', contrastOf(pairs.rows.filter((r) => counted(r.tone))));

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
  section(required, 'Color-vision', [...cvdOf(pairs.rows.filter((r) => counted(r.cvdTone))), ...siblingsOf(pairs.siblings.filter((g) => counted(g.tone)))]);

  // Base color scales.
  const scale = (...sevs: string[]) => palettes.flatMap((p) => p.flags.filter((f) => sevs.includes(f.severity)).map((f) => `${code(p.id)}: ${f.message}`));
  section(required, 'Base color scales', scale('error', 'warning'));

  section(optional, 'Suggestions', [
    ...byFile(model.issues.filter((i) => i.severity === 'info')).map(issueLine),
    ...scale('info'),
    ...contrastOf(pairs.rows.filter((r) => r.tone === 'info')),
    ...cvdOf(pairs.rows.filter((r) => r.cvdTone === 'info')),
    ...siblingsOf(pairs.siblings.filter((g) => g.tone === 'info')),
  ]);

  if (!count) return { text: '', count: 0 };
  // Be clear about what DTsanity could have done itself: those lines carry "Fix:", the rest it can't fix.
  const withFix = model.issues.filter((i) => i.fix).length;
  const fixNote = withFix
    ? `${withFix} of these ${withFix === 1 ? 'has' : 'have'} a one-click fix in DTsanity, given after “Fix:”. DTsanity can't make the other changes itself; they need a decision about the design.`
    : `DTsanity can't make these changes itself; they need a decision about the design.`;
  const targets = TARGETS.filter((t) => s.settings.contrast.includes(t.id)).map((t) => t.label);
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
    '',
    'Rules:',
    '- Keep each file\'s structure, token names and order unless a correction says otherwise.',
    '- Tiers: base tokens hold values only; semantic tokens point at base or semantic tokens; component tokens point at semantic or base tokens.',
    '- To fix contrast, prefer pointing a semantic or component token at another existing base token over changing base values. Change a base value only when no existing token works, and say which.',
    '- List every change you make, per file.',
    '',
    ...required,
    ...(optional.length ? ['# Optional', '', ...optional] : []),
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
    .trim();
  return { text: `${text}\n`, count };
}
