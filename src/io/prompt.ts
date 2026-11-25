import { VISIONS } from '../color/cvd';
import { TARGETS } from '../contrast/levels';
import { formatContrast } from '../contrast/metrics';
import { ruleTitle } from '../model/rules';
import type { Issue } from '../model/types';
import type { JNode } from '../json/cst';
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
  /** Each finding as listed, in report order (the #n numbering); for the offline check's --json. */
  entries: readonly Entry[];
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
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const list = (xs: string[]) => xs.map(code).join(', ');

/** The heading of the part at the end of a prompt that lists every place of the findings whose line gives only examples. */
export const PLACES_TITLE = 'Places (reference data, not findings)';
/** Stands for a finding's number until the findings are numbered. */
const NO = '#\u0000';
/** How many examples, values and groups a finding with its places at the end names on its line. */
const SHOWN = 3;

/** A place of a grouped finding: a token (its path), or a line where there is none, with what it quotes when that differs. */
interface Place {
  name?: string;
  line?: number;
  quotes: string;
}

const n = (x: number) => x.toLocaleString('en-US');

/**
 * Token paths with their parent written once: `a.b.{c, d}` for `a.b.c` and `a.b.d`, in the order
 * they first appear; parents with the same last names, once too: `{a, b}.{c, d}` for `a.c`, `a.d`,
 * `b.c` and `b.d`. A name with a brace or comma in it is kept whole, so the form stays unambiguous.
 */
function pathParts(ids: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const cut = id.lastIndexOf('.');
    const whole = cut <= 0 || /[{},]/.test(id);
    const key = whole ? `\u0000${id}` : id.slice(0, cut);
    groups.set(key, [...(groups.get(key) ?? []), whole ? id : id.slice(cut + 1)]);
  }
  const out: (string | { parents: string[]; leaves: string[] })[] = [];
  const same = new Map<string, { parents: string[]; leaves: string[] }>();
  for (const [k, leaves] of groups) {
    if (k.startsWith('\u0000')) {
      out.push(code(leaves[0]!));
      continue;
    }
    const key = [...leaves].sort().join('\u0000');
    const g = same.get(key);
    if (g) g.parents.push(k);
    else {
      const first = { parents: [k], leaves };
      same.set(key, first);
      out.push(first);
    }
  }
  const brace = (xs: string[]) => (xs.length === 1 ? xs[0]! : `{${xs.join(', ')}}`);
  return out.map((x) => (typeof x === 'string' ? x : code(`${brace(x.parents)}.${brace(x.leaves)}`)));
}

/** Names a list of token paths by a search that finds exactly them, when there is one. */
type Search = (names: string[]) => string | undefined;

/** Places by what they quote, in the order they first appear; each group's tokens and lines. */
function byQuote(ps: Place[]): [string, Place[]][] {
  const out = new Map<string, Place[]>();
  for (const p of ps) out.set(p.quotes, [...(out.get(p.quotes) ?? []), p]);
  return [...out];
}

const whereParts = (ps: Place[], search?: Search) => {
  const lines = ps.flatMap((p) => (!p.name && p.line ? [p.line] : []));
  const names = ps.flatMap((p) => (p.name ? [p.name] : []));
  const found = names.length > 1 ? search?.(names) : undefined;
  return [...(found ? [found] : pathParts(names)), ...(lines.length ? [`${lines.length === 1 ? 'line' : 'lines'} ${lines.join(', ')}`] : [])];
};

/** Every place on the finding's line: each value it quotes once, with the places that hold it. */
function placesInline(ps: Place[], search?: Search): string {
  const groups = byQuote(ps);
  return groups.map(([q, xs]) => `${q ? `${q}${groups.length > 1 && xs.length > 1 ? ` (${n(xs.length)})` : ''} at ` : ''}${whereParts(xs, search).join(', ')}`).join('; ');
}

/** A finding's places as its line names them when every place is in the places file: values, where they sit, examples. */
function placesSummary(ps: Place[]): string {
  const more = (k: number, what: string) => (k > 0 ? `, and ${n(k)} more ${what}` : '');
  const values = byQuote(ps)
    .filter(([q]) => q)
    .sort((a, b) => b[1].length - a[1].length);
  const parents = new Map<string, number>();
  for (const p of ps) if (p.name && p.name.lastIndexOf('.') > 0) parents.set(p.name.slice(0, p.name.lastIndexOf('.')), (parents.get(p.name.slice(0, p.name.lastIndexOf('.'))) ?? 0) + 1);
  const under = [...parents].sort((a, b) => b[1] - a[1]);
  const example = (p: Place) => `${p.name ? code(p.name) : `line ${p.line}`}${p.quotes ? ` (${p.quotes})` : ''}`;
  return [
    values.length ? `Values: ${values.slice(0, SHOWN).map(([q, xs]) => `${q} (${n(xs.length)})`).join(', ')}${more(values.length - SHOWN, values.length - SHOWN === 1 ? 'value' : 'values')}.` : '',
    under.length ? `Under: ${under.slice(0, SHOWN).map(([k, c]) => `${code(k)} (${n(c)})`).join(', ')}${more(under.length - SHOWN, under.length - SHOWN === 1 ? 'group' : 'groups')}.` : '',
    `Examples: ${ps.slice(0, SHOWN).map(example).join(', ')}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** A finding's part in the places at the end: one line per value and parent group. */
function placesSection(ps: Place[], search?: Search): string {
  return byQuote(ps)
    .flatMap(([q, xs]) => whereParts(xs, search).map((w) => `- ${q ? `${q}: ` : ''}${w}`))
    .join('\n');
}

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
export interface Entry {
  rule: string;
  line: string;
  n: number;
  /** Counted as the Issues page counts; the rest are listed beside the count. */
  counted: boolean;
  /** Every place of a finding whose line gives only examples: its part in the places at the end. */
  places?: string;
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

/**
 * `appendix`: a finding with more places than its line can say briefly lists them in the
 * places part at the end of the prompt, kept apart from the findings so they read short. Off,
 * every place stays on its line (the offline check, whose output is read line by line).
 */
export function fixPrompt(s: AppState, scope?: PromptScope, { appendix = true }: { appendix?: boolean } = {}): FixPrompt {
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
  const entry = (rule: string, line: string, counted: boolean, n = 1, places?: string): Entry => ({ rule, line, n, counted, ...(places ? { places } : {}) });
  const add = (rule: string, line: string, counted: boolean, n = 1, places?: string) => entries.push(entry(rule, line, counted, n, places));
  // Themes a finding is in, named from the shorter side: the themes it is in, or the ones it isn't.
  const only = (ts: string[]) => {
    const rest = themeNames.filter((t) => !ts.includes(t));
    const listed = ` (${ts.join(', ')} only)`;
    const but = ` (all themes but ${rest.join(', ')})`;
    return rest.length && but.length < listed.length ? but : listed;
  };

  // Files that couldn't be read: nothing in them was checked.
  const unread = !scope || scope.files ? s.loadErrors : [];
  for (const e of unread) add(UNREADABLE, `${code(e.name)}${e.line ? ` (line ${e.line}, column ${e.col})` : ''}: ${e.message}`, false);

  // Format, structure, references and tier rules: the place and what is there. The rule's
  // problem and "done when" go once, above its findings; a one-click fix isn't given, since
  // the fix is the design system's to choose.
  const themesOf = (i: Issue) => (i.themes?.length ? only(i.themes) : '');
  // A token's path is its exact place; a line number is given only where there is no path (and goes stale with the first edit).
  const issueLine = (i: Issue) => {
    const file = i.fileId ? fileName.get(i.fileId) : undefined;
    const where = [file && i.pos && !i.target ? `${file}:${i.pos.line}` : file, i.target ? code(i.target) : undefined].filter(Boolean).join(' › ');
    return `${where || 'All files'}${themesOf(i)}:${i.message ? ` ${evidence(i.message)}` : ''}`;
  };
  // Every key path in a file whose last key is `k`, to name a list of places by a search when the
  // search finds exactly them (“every “$schema” key”). Paths are dot-joined, as targets are.
  const keysByName = new Map<string, Map<string, Set<string>>>();
  const keyPaths = (fileId: string) => {
    let byName = keysByName.get(fileId);
    if (byName) return byName;
    byName = new Map();
    const walk = (node: JNode | undefined, path: string) => {
      if (node?.kind !== 'object') return;
      for (const e of node.entries) {
        const at = path ? `${path}.${e.key}` : e.key;
        byName!.set(e.key, (byName!.get(e.key) ?? new Set()).add(at));
        walk(e.value, at);
      }
    };
    walk(s.files.find((f) => f.id === fileId)?.doc.root, '');
    keysByName.set(fileId, byName);
    return byName;
  };
  const searchIn =
    (fileIds: (string | undefined)[]): Search =>
    (names) => {
      const key = names[0]!.slice(names[0]!.lastIndexOf('.') + 1);
      if (!key || /[{},]/.test(key) || !names.every((x) => x === key || x.endsWith(`.${key}`))) return undefined;
      const want = new Set(names);
      if (want.size !== names.length) return undefined;
      // Exactly these places in every file named: no more, no fewer.
      for (const id of fileIds) {
        const all = id ? keyPaths(id).get(key) : undefined;
        if (!all || all.size !== want.size || [...all].some((x) => !want.has(x))) return undefined;
      }
      return `every “${key}” key (${n(names.length)})`;
    };

  // The same finding in several places (same rule and message) is one line that names each place,
  // so a rule broken everywhere doesn't fill the prompt with copies. Messages that differ only in
  // what they quote (“a value”, {a.reference}) count as the same; each place then keeps its own
  // quotes. Its places in several files are said once, with the files each is in, when that is
  // shorter than a line per file.
  const QUOTED = /“[^”]*”|\{[^{}]*\}/g;
  const template = (m: string) => m.replace(QUOTED, (q) => (q.startsWith('{') ? '{…}' : '“…”'));
  const quotes = (m: string) => m.match(QUOTED) ?? [];
  const placeOf = (x: Issue, sameMessage: boolean): Place => ({
    ...(x.target ? { name: x.target } : x.pos ? { line: x.pos.line } : {}),
    quotes: sameMessage ? '' : quotes(evidence(x.message ?? '')).join(', '),
  });
  const fileLabel = (i: Issue) => `${(i.fileId && fileName.get(i.fileId)) || 'All files'}${themesOf(i)}`;
  /** One file's places of a finding (one theme set): its line, and its places at the end when the line gives only examples. */
  const inFile = (g: Issue[]): Entry => {
    const i = g[0]!;
    const counted = i.severity !== 'info';
    if (g.length === 1) return entry(i.code, issueLine(i), counted);
    const sameMessage = g.every((x) => x.message === i.message);
    const places = g.map((x) => placeOf(x, sameMessage));
    const message = evidence(sameMessage ? i.message : template(i.message ?? ''));
    const head = `${fileLabel(i)}:${message ? ` ${message}` : ''} In ${g.length} places`;
    const search = searchIn([i.fileId]);
    const inline = `${head}: ${placesInline(places, search)}.`;
    // A list longer than what it would say about itself goes to the places at the end: the line
    // keeps the values, where they sit and a few examples, and says where every place is.
    const summary = `${head}, every one listed under Places ${NO} at the end. ${placesSummary(places)}`;
    return appendix && summary.length < inline.length ? entry(i.code, summary, counted, g.length, placesSection(places, search)) : entry(i.code, inline, counted, g.length);
  };
  /** A finding's places in several files, each place once with the files it is in; none when a file holds a place twice. */
  const acrossFiles = (subs: Issue[][]): Entry | undefined => {
    const all = subs.flat();
    const i = all[0]!;
    const counted = i.severity !== 'info';
    const sameMessage = all.every((x) => x.message === i.message);
    const at = new Map<string, { place: Place; files: number[] }>();
    for (const [k, g] of subs.entries())
      for (const x of g) {
        const place = placeOf(x, sameMessage);
        const id = `${place.name !== undefined ? `n${place.name}` : `l${k}:${place.line}`}\u0000${place.quotes}`;
        const a = at.get(id);
        if (a?.files.includes(k)) return undefined;
        if (a) a.files.push(k);
        else at.set(id, { place, files: [k] });
      }
    const parts = new Map<string, { files: number[]; places: Place[] }>();
    for (const { place, files } of at.values()) {
      const key = files.join(',');
      const part = parts.get(key) ?? { files, places: [] };
      part.places.push(place);
      parts.set(key, part);
    }
    const name = (k: number) => (subs[k]![0]!.fileId && fileName.get(subs[k]![0]!.fileId!)) || 'All files';
    const where = (ks: number[]) => (ks.length === subs.length ? `in all ${subs.length} files` : ks.length === 1 ? `only in ${name(ks[0]!)}` : `only in ${ks.length} files (${ks.map(name).join(', ')})`);
    const search = (ks: number[]) => searchIn(ks.map((k) => subs[k]![0]!.fileId));
    const message = evidence(sameMessage ? i.message : template(i.message ?? ''));
    const head = `${andList(subs.map((g) => fileLabel(g[0]!)))}:${message ? ` ${message}` : ''} In ${all.length} places`;
    const inline = `${head}: ${[...parts.values()].map((p) => `${where(p.files)}, ${placesInline(p.places, search(p.files))}`).join(' | ')}.`;
    const spread = [...parts.values()].sort((a, b) => b.places.length - a.places.length);
    const more = spread.length - SHOWN;
    const summary = `${head}, every one listed under Places ${NO} at the end. Files: ${spread
      .slice(0, SHOWN)
      .map((p) => `${n(p.places.length)} ${where(p.files)}`)
      .join(', ')}${more > 0 ? `, and ${n(more)} more ${more === 1 ? 'set' : 'sets'} of files` : ''}. ${placesSummary([...at.values()].map((a) => a.place))}`;
    if (!(appendix && summary.length < inline.length)) return entry(i.code, inline, counted, all.length);
    const section = [...parts.values()].map((p) => `${where(p.files).replace(/^./, (c) => c.toUpperCase())}:\n\n${placesSection(p.places, search(p.files))}`).join('\n\n');
    return entry(i.code, summary, counted, all.length, section);
  };
  const size = (es: Entry[]) => es.reduce((k, e) => k + e.line.length + (e.places?.length ?? 0), 0);
  const addIssues = (xs: Issue[]) => {
    const kinds = new Map<string, Map<string, Issue[]>>();
    const order: (Issue | Map<string, Issue[]>)[] = [];
    for (const i of xs) {
      if (!i.target && !i.pos) {
        order.push(i);
        continue;
      }
      // Places with a one-click fix stay apart from those without, as the group buttons copy only the latter.
      const key = [i.code, template(i.message ?? ''), i.fix ? 'fix' : ''].join('\u0000');
      let byFile = kinds.get(key);
      if (!byFile) {
        byFile = new Map();
        kinds.set(key, byFile);
        order.push(byFile);
      }
      const sub = [i.fileId, i.themes?.join(',')].join('\u0000');
      byFile.set(sub, [...(byFile.get(sub) ?? []), i]);
    }
    for (const g of order) {
      if (!(g instanceof Map)) {
        add(g.code, issueLine(g), g.severity !== 'info');
        continue;
      }
      const subs = [...g.values()];
      const apart = subs.map(inFile);
      const together = subs.length > 1 ? acrossFiles(subs) : undefined;
      entries.push(...(together && size([together]) < size(apart) ? [together] : apart));
    }
  };
  const byFile = (xs: Issue[]) => [...xs].sort((a, b) => (fileName.get(a.fileId ?? '') ?? '').localeCompare(fileName.get(b.fileId ?? '') ?? ''));
  addIssues(byFile(issues));

  // Contrast with typical vision: one line per pair, as the page counts it. The evidence is each
  // level it misses, in which themes, with the ratio and both colors there, and the references
  // each token follows to its value, so the reader sees which token holds the color.
  const counted = (tone: string | undefined) => tone !== undefined && tone !== 'info';
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
  for (const [message, e] of typeNotes) add(e.rule, `${evidence(message)}${e.themes.length && e.themes.length < themeNames.length ? only(e.themes) : ''}`, false);

  // Base color scales.
  for (const p of pals) for (const f of p.flags) add(`scale-${f.kind}`, `${code(p.id)}: ${evidence(f.message)}`, false);

  const count = entries.filter((e) => e.counted).reduce((n, e) => n + e.n, 0);
  const more = entries.filter((e) => !e.counted).reduce((n, e) => n + e.n, 0);
  if (!count && !more) return { text: '', count: 0, more: 0, entries: [] };

  // One section per rule: its standing and source, the problem, "done when" and "decline if"
  // once, then its findings, numbered for the report. Required rules first, then advice.
  const byRule = new Map<string, Entry[]>();
  for (const e of entries) byRule.set(e.rule, [...(byRule.get(e.rule) ?? []), e]);
  const ruleIds = [...byRule.keys()].sort((a, b) => rank(a) - rank(b));
  let no = 0;
  const listedEntries: Entry[] = [];
  const placeSections: string[] = [];
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
          ...xs.map((e) => {
            const line = e.line.replace(NO, `#${++no}`);
            listedEntries.push({ ...e, line });
            if (e.places) placeSections.push(`## Places #${no}: ${e.line.slice(0, e.line.indexOf(', every one listed under Places'))}`, '', e.places, '');
            return `- #${no} ${line}`;
          }),
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
  if (placeSections.length) listed.add('places');

  const targets = TARGETS.filter((t) => s.settings.contrast.includes(t.id)).map((t) => t.label);
  const enhanced = s.themes.filter((t) => t.contrast === 'enhanced').map((t) => t.name);
  const text = [
    '# Findings in design token files',
    '',
    `DTsanity checked these design token files against the DTCG format (2025.10), ${apca ? 'APCA contrast (the method proposed for WCAG 3, not yet a standard)' : 'WCAG 2.2 contrast'} and common token conventions. This is a report, not a list of edits: each finding gives the problem, the evidence and what must be true when it is done. How to fix it is for your design system to decide.`,
    '',
    FLAGS,
    '',
    // What was checked, and how: only the lines that apply.
    ...[
      `Files: ${s.files.map((f) => f.name).join(', ')}`,
      `Checked with: DTsanity build ${__VERSION__}, ${s.settings.acceptLegacy ? 'legacy formats accepted' : 'DTCG 2025.10 only'}`,
      themeNames.length ? `Themes: ${themeNames.join(', ')}` : '',
      targets.length ? `Contrast targets: ${targets.join(', ')}` : '',
      enhanced.length ? `Enhanced contrast (AAA text, or APCA Lc 75 text and Lc 60 UI) in: ${enhanced.join(', ')}` : '',
      // Read once: the form a token path takes when several share a parent.
      ...(() => {
        const all = [...required, ...advice, ...placeSections];
        const after = all.some((l) => /`[^`]*\.\{[^`]*\}`/.test(l));
        const before = all.some((l) => /`\{[^`]*\}\.[^`]*`/.test(l));
        return [
          after || before ? `Paths: \`a.b.{c, d}\` stands for \`a.b.c\` and \`a.b.d\`${before ? '; `{a, b}.{c, d}` for `a.c`, `a.d`, `b.c` and `b.d`' : ''}.` : '',
          all.some((l) => /every “[^”]+” key \(/.test(l)) ? 'Every “k” key: each key named k, at any depth of that file. DTsanity checked that these are exactly the finding’s places there.' : '',
        ];
      })(),
    ].filter(Boolean),
    '',
    'How to work through it:',
    ...PROMPT_RULES.filter((r) => listed.has(r.when)).map((r) => `- ${r.text}`),
    '',
    ...required,
    ...advice,
    // Lookup data, kept last and marked apart, so the findings above read short and whole.
    ...(placeSections.length
      ? [
          `# ${PLACES_TITLE}`,
          '',
          'Every place of the findings above whose line gives only examples, under the same numbers. These aren’t more findings: open a finding’s places when you work on it.',
          '',
          ...placeSections,
        ]
      : []),
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
    .trim();
  return { text: `${text}\n`, count, more, entries: listedEntries };
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
