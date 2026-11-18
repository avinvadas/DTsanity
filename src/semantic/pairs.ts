import { simulate, type Vision } from '../color/cvd';
import { colorInfo, infoFrom, mapped, type ColorInfo } from '../color/format';
import { levelById, type ContrastTarget, type Level, type Metric } from '../contrast/levels';
import { contrast } from '../contrast/metrics';
import type { JPath } from '../json/cst';
import { modeValues } from '../model/modes';
import { PICK_FROM, TIER_LABEL, tiersOf } from '../model/tiers';
import type { Edit, Model, Token } from '../model/types';

/**
 * Foreground/background pairs in the semantic layer, inferred from token
 * names and checked for contrast in every theme.
 *
 * A name is read as words (path segments split on "-", "_" and camelCase).
 * One word gives the role: a background (bg, surface, fill, container…) or a
 * foreground (text, fg, icon, border, on-…). The other words are the
 * modifiers, such as "danger" or "subtle hover". A foreground pairs with the
 * backgrounds that share its modifiers; one with no such background is
 * checked on the default background. "on-X" pairs with X itself, as in
 * Material's primary / on-primary.
 */

/** Text must pass the text level; icons, borders and other UI parts the non-text one. */
export type PairKind = 'text' | 'ui';

export interface Pair {
  /** `${fg}|${bg}`. */
  id: string;
  fg: string;
  bg: string;
  kind: PairKind;
  /** Inferred from the names, or added by the user. */
  source: 'name' | 'user';
}

/** The user's changes to the detected pairs. In memory only: token names are token data. */
export interface PairEdits {
  added: readonly Pair[];
  removed: readonly string[];
  kinds: Readonly<Record<string, PairKind>>;
}

export const NO_PAIR_EDITS: PairEdits = { added: [], removed: [], kinds: {} };

export const pairId = (fg: string, bg: string) => `${fg}|${bg}`;

const BG = new Set(['bg', 'background', 'backgrounds', 'surface', 'surfaces', 'fill', 'canvas', 'container', 'backdrop']);
const TEXT = new Set(['fg', 'foreground', 'text', 'content', 'label', 'link', 'on', 'ink']);
const UI = new Set(['icon', 'icons', 'border', 'borders', 'outline', 'stroke', 'divider', 'separator', 'ring']);
/** Words that say nothing about which pair a token belongs to. "default" is the same as no modifier. */
const NOISE = new Set(['color', 'colors', 'colour', 'colours', 'semantic', 'semantics', 'sys', 'alias', 'aliases', 'theme', 'default', 'base']);
/** Words for a surface family of its own, whose foregrounds sit on it rather than on the page. */
const INVERSE = new Set(['inverse', 'inverted']);
/** Interaction states: a state of a foreground sits where the foreground does. */
const STATES = new Set(['hover', 'hovered', 'active', 'pressed', 'focus', 'focused', 'visited', 'selected']);
/** Roles that also tell variants apart, so they stay in the modifiers: primary-container is not primary. */
const KEPT = new Set(['container']);

/** A token name as lowercase words: path segments split on "-", "_" and camelCase. */
export const words = (id: string) =>
  id
    .split('.')
    .flatMap((seg) => seg.replace(/([a-z0-9])([A-Z])/g, '$1-$2').split(/[-_\s]+/))
    .map((w) => w.toLowerCase())
    .filter(Boolean);

interface Parsed {
  id: string;
  role: 'bg' | 'fg' | 'none';
  kind: PairKind;
  /** "on-X": pairs with X, whatever its role. */
  on: boolean;
  key: string;
  /** A line around a shape (border, outline): it must stand out from what is around the shape, not from its own fill. */
  edge: boolean;
}

/** Foreground words for a line around a shape rather than a mark on it. */
const EDGE = new Set(['border', 'borders', 'outline', 'outlines', 'stroke', 'ring', 'frame', 'edge', 'divider', 'dividers', 'separator', 'separators']);

/**
 * How a pair is drawn: "Aa" for text, a line around the background for
 * borders and outlines, a ring and bar for other UI parts (icons…). A pair
 * set to text is drawn as text, whatever its name.
 */
export type PairGlyph = 'text' | 'border' | 'ui';
export const glyphOf = (pair: Pick<Pair, 'fg' | 'kind'>): PairGlyph =>
  pair.kind === 'text' ? 'text' : words(pair.fg).some((w) => EDGE.has(w)) ? 'border' : 'ui';

/** Words for a component nobody can use right now: WCAG 1.4.3 and 1.4.11 don't ask it for contrast. */
const INACTIVE = new Set(['disabled', 'inactive']);
/** Whether a pair is a disabled or inactive state. */
export const isInactive = (pair: Pick<Pair, 'fg' | 'bg'>) => [...words(pair.fg), ...words(pair.bg)].some((w) => INACTIVE.has(w));

/** Whether a name has a background or foreground role word: true for `text.danger`, false for `red.500`. */
export const hasRole = (ws: readonly string[]) => ws.some((w) => BG.has(w) || TEXT.has(w) || UI.has(w));

const isRole = (w: string) => BG.has(w) || TEXT.has(w) || UI.has(w);

/**
 * Where a name's role word is: the last one, nearest the token, since the
 * words before it name what it belongs to (`button.outline.bgColor` is a
 * background of the outline button, not an outline). An "on-" name is the
 * exception: "on" makes it a foreground of what follows.
 */
function roleAt(ws: readonly string[]): number {
  if (ws.includes('on')) return ws.findIndex(isRole);
  for (let i = ws.length - 1; i >= 0; i--) if (isRole(ws[i]!)) return i;
  return -1;
}

function parse(id: string): Parsed {
  const ws = words(id);
  const on = ws.includes('on');
  const at = roleAt(ws);
  const w = ws[at];
  let role: Parsed['role'] = w === undefined ? 'none' : TEXT.has(w) ? 'fg' : UI.has(w) ? 'fg' : 'bg';
  const kind: PairKind = w !== undefined && UI.has(w) && !on ? 'ui' : 'text';
  // "on-surface-icon" is a foreground even though "surface" came first.
  if (on) role = 'fg';
  // An "on-" name drops every role word, as it pairs with what it sits on; any other drops only its own.
  const key = ws.filter((x, i) => !NOISE.has(x) && (KEPT.has(x) || (on ? !isRole(x) : i !== at))).sort().join(' ');
  return { id, role, kind, on, key, edge: !on && w !== undefined && EDGE.has(w) };
}

/** A name with its role word blanked out, e.g. "color.*.default" for `color.bg.default` and `color.fg.default`. */
function shape(id: string): string {
  const ws = words(id);
  const at = roleAt(ws);
  return ws.map((w, i) => (i === at ? '*' : w)).join('.');
}

/** Pairs inferred from the names of `ids` (color tokens), in the order of their foregrounds. `backgrounds` are tokens whose own description calls them a background, whatever their name says. */
export function detectPairs(ids: readonly string[], backgrounds: ReadonlySet<string> = new Set()): Pair[] {
  const parsed = ids.map(parse).map((p) => (backgrounds.has(p.id) && p.role === 'fg' ? { ...p, role: 'bg' as const, kind: 'text' as const, on: false, edge: false } : p));
  const bgs = parsed.filter((p) => p.role === 'bg');
  const byKey = (list: Parsed[], key: string) => list.filter((p) => p.key === key);
  const defaults = byKey(bgs, '');
  const pairs = new Map<string, Pair>();
  for (const fg of parsed.filter((p) => p.role === 'fg')) {
    // A border shows a shape's edge against what surrounds it (WCAG 1.4.11), so it is checked on the
    // default backgrounds, never on the fill it surrounds.
    // "on-color" names no fill (only a word like "color"): it sits on colored fills, not the page, so it has no pair to infer.
    // "on-surface" names one.
    if (fg.on && !fg.key) {
      const ws = words(fg.id);
      if (!ws.slice(ws.indexOf('on') + 1).some((w) => BG.has(w))) continue;
    }
    let match = fg.edge ? defaults : byKey(bgs, fg.key);
    // "on-primary" sits on "primary", which has no background word of its own.
    if (fg.on) match = [...match, ...byKey(parsed.filter((p) => p.role === 'none'), fg.key)];
    // A state of a foreground for inverse surfaces (`link-inverse-visited`) sits on the inverse background, not the page.
    if (!match.length && !fg.edge) {
      const ws = fg.key.split(' ');
      const family = ws.find((w) => INVERSE.has(w));
      if (family && ws.every((w) => w === family || STATES.has(w))) match = byKey(bgs, family);
    }
    // An "on-" name says what it sits on; with nothing of that name, it isn't on the page either.
    if (!match.length && fg.on) continue;
    if (!match.length) match = defaults;
    // Of several candidates, keep those named in the same shape: color.fg goes with
    // color.bg, color.fg.default with color.bg.default, not across.
    const same = match.filter((bg) => shape(bg.id) === shape(fg.id));
    if (same.length) match = same;
    for (const bg of match) {
      if (bg.id === fg.id) continue;
      const id = pairId(fg.id, bg.id);
      pairs.set(id, { id, fg: fg.id, bg: bg.id, kind: fg.kind, source: 'name' });
    }
  }
  return [...pairs.values()];
}

/**
 * The page background of a set: the first background whose name has no
 * modifier beyond role words (`background.color.default`, `color.bg`). A
 * translucent background is drawn over it, so it is blended over it before
 * it is measured.
 */
export function pageBackground(ids: readonly string[]): string | undefined {
  return ids.map(parse).find((p) => p.role === 'bg' && p.key === '')?.id;
}

/** Detected pairs with the user's additions, removals and kind changes. */
export function applyPairEdits(detected: readonly Pair[], edits: PairEdits): Pair[] {
  const removed = new Set(edits.removed);
  const seen = new Set(detected.map((p) => p.id));
  return [...detected, ...edits.added.filter((p) => !seen.has(p.id))]
    .filter((p) => !removed.has(p.id))
    .map((p) => (edits.kinds[p.id] ? { ...p, kind: edits.kinds[p.id]! } : p));
}

/**
 * How much contrast a theme must have: standard, or enhanced for a theme
 * meant for low vision (high contrast, increased contrast).
 */
export type ContrastLevel = 'standard' | 'enhanced';

/** The level each target requires of a pair: the text level, or the non-text one for UI parts. */
const REQUIRED: Record<ContrastLevel, Record<PairKind, Record<ContrastTarget, string>>> = {
  // WCAG passes at AA; AAA is shown as a level reached, not required.
  standard: { text: { wcag: 'aa', apca: 'lc60' }, ui: { wcag: 'aa-large', apca: 'lc45' } },
  // AAA for text (WCAG 1.4.6); WCAG has no stricter level for non-text, so UI parts stay at 3:1. APCA: body text and content text levels.
  enhanced: { text: { wcag: 'aaa', apca: 'lc75' }, ui: { wcag: 'aa-large', apca: 'lc60' } },
};

export function requiredLevels(kind: PairKind, targets: readonly ContrastTarget[], level: ContrastLevel = 'standard'): Level[] {
  const ids = [...new Set(targets.map((t) => REQUIRED[level][kind][t]))];
  return ids.map((id) => levelById(id)!);
}

export interface PairCheck {
  fg: ColorInfo;
  bg: ColorInfo;
  /** The foreground as it shows on the background (composited when translucent). */
  shown: ColorInfo;
  values: Partial<Record<Metric, number>>;
  /** Each required level and whether it passes. */
  results: { level: Level; value: number; pass: boolean }[];
  pass: boolean;
  /** A translucent background as written, and the page it was blended over: `bg` is then the blend. */
  under?: { bg: ColorInfo; page: ColorInfo };
}

/** A translucent foreground blended over its (opaque) background, in sRGB as a screen does. */
export function over(fg: ColorInfo, bg: ColorInfo): ColorInfo {
  const a = fg.oklch.alpha;
  if (a >= 1) return fg;
  const f = mapped(fg, 'srgb').coords;
  const b = mapped(bg, 'srgb').coords;
  const coords = f.map((x, i) => a * (Number(x) || 0) + (1 - a) * (Number(b[i]) || 0)) as [number, number, number];
  return infoFrom({ space: mapped(bg, 'srgb').space, coords, alpha: 1 });
}

/**
 * The color a token shows: the value of a color token, or the color part of a
 * composite border. `css` reads colors written as CSS strings, when legacy formats are on.
 */
export function tokenColor(t: Token | undefined, css = false): ColorInfo | undefined {
  if (!t || t.resolution !== 'ok') return undefined;
  if (t.type === 'color') return colorInfo(t.value, css);
  if (t.type === 'border' && t.value && typeof t.value === 'object') return colorInfo((t.value as { color?: unknown }).color, css);
  return undefined;
}

const REF = /^\{([^{}]+)\}$/;

/**
 * The reference that gives a token its color, and where it is written: the
 * whole value of a color alias, or the `color` part of a composite border.
 * Undefined for a literal color, or a border that is an alias of another border.
 */
export function colorRef(t: Token): { target: string; path: JPath } | undefined {
  if (t.extendedFrom) return undefined;
  if (t.type === 'color' && t.aliasOf) return { target: t.aliasOf, path: [...t.keyPath, ...t.valuePath] };
  if (t.type === 'border' && !t.aliasOf && t.rawValue && typeof t.rawValue === 'object') {
    const color = (t.rawValue as { color?: unknown }).color;
    const m = typeof color === 'string' ? REF.exec(color) : null;
    if (m) return { target: m[1]!, path: [...t.keyPath, ...t.valuePath, 'color'] };
  }
  return undefined;
}

/**
 * Where a token's color is written, and the token it references there if
 * any: the whole value of a color token, or the `color` part of a composite
 * border. Undefined for a border that is an alias of another border, or a
 * token copied in by `$extends`.
 */
export function colorSlot(t: Token): { target?: string; path: JPath } | undefined {
  if (t.extendedFrom) return undefined;
  const ref = colorRef(t);
  if (ref) return ref;
  if (t.type === 'color' && !t.aliasOf) return { path: [...t.keyPath, ...t.valuePath] };
  if (t.type === 'border' && !t.aliasOf && t.rawValue && typeof t.rawValue === 'object' && 'color' in t.rawValue) return { path: [...t.keyPath, ...t.valuePath, 'color'] };
  return undefined;
}

/**
 * The edit that points a token's color at `target`, whether it is a
 * reference now or a value of its own. With `mode`, the theme reading that
 * mode should change alone: if it reads the plain `$value`, which other modes
 * share, the color goes into the token's entry for this mode instead (in the
 * mode shape the token already uses, or `$extensions.mode`), and the other
 * modes keep reading `$value`.
 */
export function pointColor(model: Model, id: string, target: string, mode?: string): Edit | undefined {
  const t = model.tokens.get(id);
  const slot = t && colorSlot(t);
  if (!slot) return undefined;
  const ref = `{${target}}`;
  if (mode === undefined || t.valuePath.length !== 1 || t.valuePath[0] !== '$value') return { fileId: t.fileId, path: slot.path, value: ref };
  const modePath = modeValues(t.extensions)?.path ?? ['$extensions', 'mode'];
  // A border's color part: this mode's entry is the whole border, with the color changed.
  const part = slot.path.slice(t.keyPath.length + 1);
  const value = part.length && t.rawValue && typeof t.rawValue === 'object' ? { ...(t.rawValue as Record<string, unknown>), [part[0]!]: ref } : ref;
  return { fileId: t.fileId, path: [...t.keyPath, ...modePath, mode], value };
}

const colorOf = (model: Model, id: string) => tokenColor(model.tokens.get(id), model.settings.acceptLegacy);

/** Check a foreground on a background for a pair of `kind`. */
export function checkColors(fg: ColorInfo, bg: ColorInfo, kind: PairKind, targets: readonly ContrastTarget[], level: ContrastLevel = 'standard'): PairCheck {
  const shown = over(fg, bg);
  const levels = requiredLevels(kind, targets, level);
  const values: Partial<Record<Metric, number>> = {};
  for (const m of new Set(levels.map((l) => l.metric))) values[m] = contrast(shown, bg, m);
  const results = levels.map((level) => ({ level, value: values[level.metric]!, pass: values[level.metric]! >= level.threshold }));
  return { fg, bg, shown, values, results, pass: results.every((r) => r.pass) };
}

/**
 * Check a pair in one model (theme), as seen with `vision`. Undefined when
 * either token is missing or not a color there.
 */
export function checkPair(pair: Pair, model: Model, targets: readonly ContrastTarget[], vision: Vision = 'normal', level: ContrastLevel = 'standard', page?: string): PairCheck | undefined {
  const fg = colorOf(model, pair.fg);
  const raw = colorOf(model, pair.bg);
  if (!fg || !raw) return undefined;
  // A translucent background shows the page through it: measure the blend, as a screen shows it.
  const under = raw.oklch.alpha < 1 && page && page !== pair.bg ? colorOf(model, page) : undefined;
  const blended = under && under.oklch.alpha >= 1;
  const bg = blended ? over(raw, under) : raw;
  const check = checkColors(simulate(fg, vision), simulate(bg, vision), pair.kind, targets, level);
  return blended ? { ...check, under: { bg: raw, page: under } } : check;
}

export interface AliasCandidate {
  id: string;
  info: ColorInfo;
}

/**
 * Tokens `id` can be pointed at, grouped by tier and parent group: the tiers
 * its own tier may reference (semantic: base and semantic; component:
 * semantic and base), leaving out itself and any token that already leads
 * back to it, which would make a loop. Without `id`, base colors only.
 */
export function aliasCandidates(model: Model, id?: string): { label: string; tokens: AliasCandidate[] }[] {
  const tiers = tiersOf(model);
  const allowed = id ? PICK_FROM[tiers.get(id) ?? 'semantic'] : (['base'] as const);
  const loops = id ? leadsTo(model, id) : new Set<string>();
  const groups = new Map<string, AliasCandidate[]>();
  const tokens = [...model.tokens.values()].sort((a, b) => allowed.indexOf(tiers.get(a.id)!) - allowed.indexOf(tiers.get(b.id)!) || a.order - b.order);
  for (const t of tokens) {
    const tier = tiers.get(t.id)!;
    if (t.type !== 'color' || !allowed.includes(tier) || t.id === id || loops.has(t.id)) continue;
    const info = tokenColor(t, model.settings.acceptLegacy);
    if (!info) continue;
    const label = `${TIER_LABEL[tier]} · ${t.path.slice(0, -1).join('.') || 'top level'}`;
    groups.set(label, [...(groups.get(label) ?? []), { id: t.id, info }]);
  }
  return [...groups].map(([label, tokens]) => ({ label, tokens }));
}

/** Tokens whose references lead to `id`, directly or through others. */
export function leadsTo(model: Model, id: string): Set<string> {
  const back = new Map<string, string[]>();
  for (const t of model.tokens.values()) for (const r of t.refs) back.set(r, [...(back.get(r) ?? []), t.id]);
  const found = new Set<string>();
  const queue = [id];
  while (queue.length) for (const from of back.get(queue.pop()!) ?? []) if (!found.has(from)) found.add(from), queue.push(from);
  return found;
}

/**
 * The edit that points an alias token at `target` instead, in the file and
 * mode it is read from in this model. The reference changes; no value is written.
 * Undefined when the token is not an alias here.
 */
export function realias(model: Model, id: string, target: string): Edit | undefined {
  const t = model.tokens.get(id);
  const ref = t && colorRef(t);
  return ref ? { fileId: t.fileId, path: ref.path, value: `{${target}}` } : undefined;
}

/** Tokens with a color across `models` (every theme): color tokens and composite borders, in source order. */
/**
 * Color tokens whose own description says they are a background or fill
 * (“Background color for the selected option”), for names whose words read
 * otherwise (`content-switcher-selected`, where “content” names the component).
 */
export function describedBackgrounds(models: readonly Model[]): Set<string> {
  const out = new Set<string>();
  for (const m of models) for (const t of m.tokens.values()) if (t.description && /^\s*(the\s+)?(background|fill)\b/i.test(t.description)) out.add(t.id);
  return out;
}

export function colorTokenIds(models: readonly Model[]): string[] {
  const seen = new Map<string, number>();
  for (const m of models) for (const t of m.tokens.values()) if ((t.type === 'color' || t.type === 'border') && !seen.has(t.id) && tokenColor(t, m.settings.acceptLegacy)) seen.set(t.id, t.order);
  return [...seen].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}
