import { VISIONS } from '../color/cvd';
import { TARGETS } from '../contrast/levels';
import { formatContrast } from '../contrast/metrics';
import { ruleTitle } from '../model/rules';
import type { Issue } from '../model/types';
import type { AppState } from '../state/app';
import { contrastRule, pairsOf, type PairRow, type SiblingRow } from '../state/pairs';
import { palettesOf } from '../state/palettes';
import { mergeModels } from '../themes/merge';
import { FLAGS, PROMPT_RULES, type PromptRule } from '../policy/principles';
import { RULES, withPolicy } from '../policy/rules';
import { BASIS, basisLabel } from '../policy/basis';
import { CRITERIA, UNREADABLE, type Criterion } from '../policy/criteria';
import { formatColor, type ColorInfo } from '../color/format';
import type { Model } from '../model/types';
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
  /**
   * Corrections listed, counted as the Issues page counts them (an issue, a
   * pair, a status group: once, however many themes it is in); 0 when there
   * is nothing to fix.
   */
  count: number;
  /** What else it lists, which the Issues count leaves out: files that couldn't be read, typography and color-scale checks, suggestions. */
  more: number;
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

/**
 * A finding's message as evidence for the prompt. The page's messages may
 * suggest a change ("Did you mean…?"), guess a type from a value, or point at
 * a DTsanity setting; the prompt keeps what they show and drops what they
 * steer, since the fix is the design system's to choose (and DTCG 5.2.2 bars
 * guessing a type from its value).
 */
export function evidence(message: string): string {
  return message
    .replace(/ Did you mean (its root token )?(\S.*?)\?/g, (_, root, x) => ` Closest existing ${root ? 'root token' : 'name'}: ${x}.`)
    .replace(/ The value looks like an? [\w-]+\./g, '')
    .replace(/ Point at one of the tokens in it; which one is a design choice\./g, '')
    .replace(/ Switch the target gamut to Display P3 if that's intended\./g, '');
}

/** A finding in the prompt: one line, standing for `n` findings of one rule. */
interface Entry {
  rule: string;
  line: string;
  n: number;
  /** Counted as the Issues page counts; the rest are listed beside the count. */
  counted: boolean;
}

/** The rules in the order the prompt lists them: unread files first, then as the Policy page groups them. */
const RULE_ORDER = [UNREADABLE, ...RULES.map((r) => r.id)];
const titleOf = (id: string) => (id === UNREADABLE ? "File couldn't be read" : (RULES.find((r) => r.id === id)?.title ?? ruleTitle(id)));
const standingOf = (id: string, apca = false) => (id === UNREADABLE ? 'required' : apca && APCA_CRITERIA[id] ? 'advice' : (BASIS[id]?.standing ?? 'advice'));
const basisOf = (id: string, apca = false) =>
  id === UNREADABLE ? 'Required · JSON RFC 8259' : apca && APCA_CRITERIA[id] ? APCA_BASIS : (basisLabel(id) ?? 'Advice · DTsanity check');

/**
 * With APCA as the contrast target, contrast findings follow APCA, the method
 * proposed for WCAG 3. It is guidance, not yet a standard, so they are advice,
 * and say APCA's levels instead of WCAG 2.2's.
 */
const APCA_BASIS = 'Advice · APCA, the contrast method proposed for WCAG 3 (not yet a standard): Lc 60 for text and Lc 45 for UI parts; Lc 75 and Lc 60 in high-contrast themes';
const APCA_CRITERIA: Record<string, Criterion> = {
  'contrast-text': {
    problem: 'Text in this foreground on this background is below the APCA level the theme is held to (Lc 60; Lc 75 in high-contrast themes), so people with low vision may not read it. DTsanity paired the two tokens by their names.',
    done: CRITERIA['contrast-text']!.done,
    decline: 'these two tokens are never used together as text on that background, the text is decorative, or your system holds contrast to another method (such as WCAG 2.2). Say which.',
  },
  'contrast-ui': {
    problem: 'An icon or other part of the interface in this color on this background is below the APCA level for non-text (Lc 45; Lc 60 in high-contrast themes), so people with low vision may not see it. DTsanity paired the two tokens by their names.',
    done: CRITERIA['contrast-ui']!.done,
    decline: 'these two tokens are never used together, the part is decorative, or your system holds contrast to another method (such as WCAG 2.2). Say which.',
  },
  'contrast-border': {
    problem: 'A border or outline below the APCA level for non-text (Lc 45) on the background around it. It matters where the border is what shows the component (its edge, or its state); the files can’t tell which borders those are.',
    done: CRITERIA['contrast-border']!.done,
    decline: CRITERIA['contrast-border']!.decline!,
  },
};

export function fixPrompt(s: AppState, scope?: PromptScope): FixPrompt {
  // Issues from every theme, not just the one on screen.
  const model = s.themeModels.length ? mergeModels(s.themeModels) : s.model;
  const apca = s.settings.contrast.includes('apca');
  const themeNames = s.themeModels.map((m) => m.theme.name);
  const models = allModels(s);
  const fileName = new Map(s.files.map((f) => [f.id, f.name]));
  const pairs = pairsOf(s);
  const palettes = palettesOf(s).palettes.filter((p) => p.included);
  // What this prompt covers: everything, or only the findings in `scope`.
  const none = () => false;
  const issues = scope ? model.issues.filter(scope.issue ?? none) : model.issues;
  const rows = scope ? pairs.rows.filter(scope.pair ?? none) : pairs.rows;
  const sibs = scope ? pairs.siblings.filter(scope.sibling ?? none) : pairs.siblings;
  const pals = scope && !scope.scales ? [] : palettes;

  const entries: Entry[] = [];
  const add = (rule: string, line: string, counted: boolean, n = 1) => entries.push({ rule, line, n, counted });

  // Files that couldn't be read: nothing in them was checked.
  const unread = !scope || scope.files ? s.loadErrors : [];
  for (const e of unread) add(UNREADABLE, `${code(e.name)}${e.line ? ` (line ${e.line}, column ${e.col})` : ''}: ${e.message}`, false);

  // Format, structure, references and tier rules: the place and what is there. The rule's
  // problem and "done when" go once, above its findings; a one-click fix isn't given, since
  // the fix is the design system's to choose.
  const themesOf = (i: Issue) => (i.themes?.length ? ` (${i.themes.join(', ')} only)` : '');
  const issueLine = (i: Issue) => {
    const file = i.fileId ? fileName.get(i.fileId) : undefined;
    const where = [file && i.pos ? `${file}:${i.pos.line}` : file, i.target ? code(i.target) : undefined].filter(Boolean).join(' › ');
    return `${where || 'All files'}${themesOf(i)}:${i.message ? ` ${evidence(i.message)}` : ''}`;
  };
  // The same finding in several places of one file (same rule, message and themes) is one line
  // that names each place, so a rule a file breaks everywhere doesn't fill the prompt with copies.
  // Messages that differ only in what they quote (“a value”, {a.reference}) count as the same;
  // each place then keeps its own quotes.
  const QUOTED = /“[^”]*”|\{[^{}]*\}/g;
  const template = (m: string) => m.replace(QUOTED, (q) => (q.startsWith('{') ? '{…}' : '“…”'));
  const quotes = (m: string) => m.match(QUOTED) ?? [];
  const addIssues = (xs: Issue[]) => {
    const groups = new Map<string, Issue[]>();
    const order: (Issue | Issue[])[] = [];
    for (const i of xs) {
      if (!i.target && !i.pos) {
        order.push(i);
        continue;
      }
      // Places with a one-click fix stay apart from those without, as the group buttons copy only the latter.
      const key = [i.fileId, i.code, template(i.message ?? ''), i.themes?.join(','), i.fix ? 'fix' : ''].join('\u0000');
      const g = groups.get(key);
      if (g) g.push(i);
      else {
        const first = [i];
        groups.set(key, first);
        order.push(first);
      }
    }
    for (const g of order) {
      const i = Array.isArray(g) ? g[0]! : g;
      const counted = i.severity !== 'info';
      if (!Array.isArray(g) || g.length === 1) {
        add(i.code, issueLine(i), counted);
        continue;
      }
      const file = i.fileId ? fileName.get(i.fileId) : undefined;
      const sameMessage = g.every((x) => x.message === i.message);
      const places = g.map((x) => {
        const own = sameMessage ? [] : quotes(evidence(x.message ?? ''));
        const notes = [x.pos ? `line ${x.pos.line}` : '', own.join(', ')].filter(Boolean).join('; ');
        return `${x.target ? code(x.target) : ''}${x.target && notes ? ' ' : ''}${notes ? (x.target ? `(${notes})` : notes) : ''}`;
      });
      const message = evidence(sameMessage ? i.message : template(i.message ?? ''));
      add(i.code, `${file ?? 'All files'}${themesOf(i)}:${message ? ` ${message}` : ''} In ${g.length} places: ${places.join(', ')}.`, counted, g.length);
    }
  };
  const byFile = (xs: Issue[]) => [...xs].sort((a, b) => (fileName.get(a.fileId ?? '') ?? '').localeCompare(fileName.get(b.fileId ?? '') ?? ''));
  addIssues(byFile(issues));

  // Contrast with typical vision: one line per pair, as the page counts it. The evidence is each
  // level it misses, in which themes, with the ratio and both colors there, and the references
  // each token follows to its value, so the reader sees which token holds the color.
  const counted = (tone: string | undefined) => tone !== undefined && tone !== 'info';
  const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const hex = (c: ColorInfo) => formatColor(c, 'hex').text;
  const chain = (id: string, m: Model | undefined) => {
    const ids = [id];
    for (let t = m?.tokens.get(id); t?.aliasOf && !ids.includes(t.aliasOf); t = m?.tokens.get(t.aliasOf)) ids.push(t.aliasOf);
    return ids.length > 1 ? ids.map(code).join(' → ') : '';
  };
  /** The references both tokens follow, once when every theme named agrees, else per theme. */
  const chains = (r: PairRow, themes: number[]) => {
    const per = themes.map((i) => [chain(r.pair.fg, models[i]), chain(r.pair.bg, models[i])].filter(Boolean).join('; '));
    if (per.every((c) => !c)) return '';
    if (per.every((c) => c === per[0])) return ` References: ${per[0]}.`;
    // Themes that follow the same references are named together.
    const same = new Map<string, string[]>();
    themes.forEach((t, k) => per[k] && same.set(per[k]!, [...(same.get(per[k]!) ?? []), themeNames[t]!]));
    return ` References: ${[...same].map(([c, names]) => `${names.join(', ')}: ${c}`).join(' | ')}.`;
  };
  for (const r of rows.filter((x) => counted(x.tone))) {
    const byLevel = new Map<string, string[]>();
    const failing: number[] = [];
    r.seen.normal.forEach((c, i) => {
      if (!c || c.pass) return;
      failing.push(i);
      const colors = `${hex(c.fg)} on ${c.under ? `${hex(c.under.bg)} over the page ${hex(c.under.page)} (together ${hex(c.bg)})` : hex(c.bg)}${c.fg.oklch.alpha < 1 ? `, shown as ${hex(c.shown)}` : ''}`;
      for (const x of c.results.filter((y) => !y.pass)) {
        const has = `${formatContrast(x.value, x.level.metric)}, ${colors}`;
        byLevel.set(x.level.label, [...(byLevel.get(x.level.label) ?? []), themeNames[i] ? `${themeNames[i]} (has ${has})` : `has ${has}`]);
      }
    });
    if (!byLevel.size) continue;
    const misses = [...byLevel].map(([level, where]) => (themeNames.length ? `below ${level} in ${andList(where)}` : `below ${level}: ${where.join(', ')}`));
    const use = r.pair.kind === 'text' ? 'text' : 'UI part';
    add(contrastRule(r.pair), `${code(r.pair.fg)} on ${code(r.pair.bg)} (${use}): ${misses.join('; ')}.${chains(r, failing)}`, true);
  }

  // Color-vision: one line per pair that passes with typical vision but not with a deficiency, naming each
  // deficiency and the themes it fails in; one per status group whose colors look alike, by theme.
  const visionLabel = (v: string) => VISIONS.find((x) => x.id === v)!.label;
  for (const r of rows.filter((x) => counted(x.cvdTone))) {
    const withs = r.cvdFails.flatMap((v) => {
      const themes = r.seen[v].flatMap((c, i) => (c && !c.pass ? [themeNames[i] ?? ''] : []));
      if (!themes.length) return [];
      return [`${visionLabel(v)}${themes.some(Boolean) ? ` (${andList(themes.filter(Boolean))})` : ''}`];
    });
    if (withs.length) add('cvd-pair', `${code(r.pair.fg)} on ${code(r.pair.bg)} drops below its contrast level with ${andList(withs)}.`, true);
  }
  const seenWith = (v: string) => (v === 'normal' ? 'typical vision' : visionLabel(v));
  for (const g of sibs.filter((x) => counted(x.tone))) {
    const members = new Set<string>();
    const parts = g.checks.flatMap((c, i) => {
      const fails = (c?.results ?? []).filter((x) => !x.pass && x.vision !== 'achroma');
      if (!fails.length) return [];
      for (const x of fails) for (const m of x.closest) members.add(m);
      return [`${themeNames[i] ? `in ${themeNames[i]} ` : ''}with ${fails.map((x) => `${seenWith(x.vision)} (${x.distance.toFixed(3)})`).join(', ')}`];
    });
    if (parts.length) add('cvd-siblings', `Status colors ${list([...members])} (${code(g.group.id)}) are too close to tell apart ${parts.join('; ')}; the distance needed is ${s.settings.cvdDistance} (ΔE OKLab).`, true);
  }

  // Typography: the range checks the tier views show, in each theme; a finding in only some themes says which.
  const typeNotes = new Map<string, { rule: string; themes: string[] }>();
  if (!scope || scope.typography) {
    models.forEach((m, i) => {
      for (const tier of ['semantic', 'component'] as const) {
        const styles = typographyIds(m, tier).map((id) => typeStyle(m.tokens.get(id)!, m));
        for (const n of withPolicy(rangeNotes(styles), s.settings.policy, (x) => `type-${x.code}`)) {
          const e = typeNotes.get(n.message) ?? { rule: `type-${n.code}`, themes: [] };
          if (themeNames[i]) e.themes.push(themeNames[i]!);
          typeNotes.set(n.message, e);
        }
      }
    });
  }
  for (const [message, e] of typeNotes) add(e.rule, `${evidence(message)}${e.themes.length && e.themes.length < themeNames.length ? ` (${e.themes.join(', ')} only)` : ''}`, false);

  // Base color scales.
  for (const p of pals) for (const f of p.flags) add(`scale-${f.kind}`, `${code(p.id)}: ${evidence(f.message)}`, false);

  const count = entries.filter((e) => e.counted).reduce((n, e) => n + e.n, 0);
  const more = entries.filter((e) => !e.counted).reduce((n, e) => n + e.n, 0);
  if (!count && !more) return { text: '', count: 0, more: 0 };

  // One section per rule: its standing and source, the problem, "done when" and "decline if"
  // once, then its findings, numbered for the report. Required rules first, then advice.
  const byRule = new Map<string, Entry[]>();
  for (const e of entries) byRule.set(e.rule, [...(byRule.get(e.rule) ?? []), e]);
  const ruleIds = [...byRule.keys()].sort((a, b) => rank(a) - rank(b));
  let no = 0;
  const part = (standing: 'required' | 'advice', title: string) => {
    const ids = ruleIds.filter((id) => standingOf(id, apca) === standing);
    if (!ids.length) return [];
    const n = ids.reduce((sum, id) => sum + byRule.get(id)!.reduce((k, e) => k + e.n, 0), 0);
    return [
      `# ${title} (${n})`,
      '',
      ...ids.flatMap((id) => {
        const xs = byRule.get(id)!;
        const c = (apca && APCA_CRITERIA[id]) || CRITERIA[id];
        return [
          `## ${titleOf(id)} [${id}] (${xs.reduce((k, e) => k + e.n, 0)})`,
          '',
          `Basis: ${basisOf(id, apca)}`,
          c ? `Problem: ${c.problem}` : '',
          c ? `Done when: ${c.done}` : '',
          c?.decline ? `Decline if: ${c.decline}` : '',
          '',
          ...xs.map((e) => `- #${++no} ${e.line}`),
          '',
        ];
      }),
    ];
  };
  const required = part('required', 'Required');
  const advice = part('advice', 'Advice');
  const listed = new Set<PromptRule['when']>(['always']);
  if (unread.length) listed.add('files');
  if (advice.length) listed.add('advice');

  const targets = TARGETS.filter((t) => s.settings.contrast.includes(t.id)).map((t) => t.label);
  const enhanced = s.themes.filter((t) => t.contrast === 'enhanced').map((t) => t.name);
  const text = [
    '# Findings in design token files',
    '',
    `DTsanity checked these design token files against the DTCG format (2025.10), ${apca ? 'APCA contrast (the method proposed for WCAG 3, not yet a standard)' : 'WCAG 2.2 contrast'} and common token conventions. This is a report, not a list of edits: each finding gives the problem, the evidence and what must be true when it is done. How to fix it is for your design system to decide.`,
    '',
    FLAGS,
    '',
    `Files: ${s.files.map((f) => f.name).join(', ')}`,
    `Checked with: DTsanity build ${__VERSION__}, ${s.settings.acceptLegacy ? 'legacy formats accepted' : 'DTCG 2025.10 only'}`,
    themeNames.length ? `Themes: ${themeNames.join(', ')}` : '',
    targets.length ? `Contrast targets: ${targets.join(', ')}` : '',
    enhanced.length ? `Enhanced contrast (AAA text, or APCA Lc 75 text and Lc 60 UI) in: ${enhanced.join(', ')}` : '',
    '',
    'How to work through it:',
    ...PROMPT_RULES.filter((r) => listed.has(r.when)).map((r) => `- ${r.text}`),
    '',
    ...required,
    ...advice,
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
    .trim();
  return { text: `${text}\n`, count, more };
}

const rank = (id: string) => {
  const i = RULE_ORDER.indexOf(id);
  return i < 0 ? RULE_ORDER.length : i;
};

/** A stable key for an issue, the same in every merge of the theme models. */
const issueKey = (i: Issue) => [i.code, i.fileId, i.target, i.keyPath?.join('.'), i.message].join('\u0000');

/** Scope: these issues. */
export const issuesScope = (issues: readonly Issue[]): PromptScope => {
  const keys = new Set(issues.map(issueKey));
  return { issue: (i) => keys.has(issueKey(i)) };
};

/** Scope: these pairs and status groups (a contrast or color-blindness section). */
export const pairsScope = (rows: readonly PairRow[], groups: readonly SiblingRow[] = []): PromptScope => {
  const pairs = new Set(rows.map((r) => `${r.pair.fg}\u0000${r.pair.bg}`));
  const ids = new Set(groups.map((g) => g.group.id));
  return { pair: (x) => pairs.has(`${x.pair.fg}\u0000${x.pair.bg}`), sibling: (x) => ids.has(x.group.id) };
};
