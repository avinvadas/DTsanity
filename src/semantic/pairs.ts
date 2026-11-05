import { simulate, type Vision } from '../color/cvd';
import { colorInfo, infoFrom, mapped, type ColorInfo } from '../color/format';
import { levelById, type ContrastTarget, type Level, type Metric } from '../contrast/levels';
import { contrast } from '../contrast/metrics';
import type { JPath } from '../json/cst';
import { MAY_REFERENCE, TIER_LABEL, tiersOf } from '../model/tiers';
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
}

/** Foreground words for a line around a shape rather than a mark on it. */
const EDGE = new Set(['border', 'borders', 'outline', 'outlines', 'stroke', 'ring', 'frame', 'edge']);

/**
 * How a pair is drawn: "Aa" for text, a line around the background for
 * borders and outlines, a ring and bar for other UI parts (icons…). A pair
 * set to text is drawn as text, whatever its name.
 */
export type PairGlyph = 'text' | 'border' | 'ui';
export const glyphOf = (pair: Pick<Pair, 'fg' | 'kind'>): PairGlyph =>
  pair.kind === 'text' ? 'text' : words(pair.fg).some((w) => EDGE.has(w)) ? 'border' : 'ui';

/** Whether a name has a background or foreground role word: true for `text.danger`, false for `red.500`. */
export const hasRole = (ws: readonly string[]) => ws.some((w) => BG.has(w) || TEXT.has(w) || UI.has(w));

function parse(id: string): Parsed {
  const ws = words(id);
  let role: Parsed['role'] = 'none';
  let kind: PairKind = 'text';
  let on = false;
  for (const w of ws) {
    if (w === 'on') on = true;
    if (role !== 'none') continue;
    if (TEXT.has(w)) role = 'fg';
    else if (UI.has(w)) (role = 'fg'), (kind = 'ui');
    else if (BG.has(w)) role = 'bg';
  }
  // "on-surface-icon" is a foreground even though "surface" came first.
  if (on) role = 'fg';
  const key = ws.filter((w) => !NOISE.has(w) && (KEPT.has(w) || !(BG.has(w) || TEXT.has(w) || UI.has(w)))).sort().join(' ');
  return { id, role, kind, on, key };
}

/** A name with its role word blanked out, e.g. "color.*.default" for `color.bg.default` and `color.fg.default`. */
function shape(id: string): string {
  let done = false;
  return words(id)
    .map((w) => {
      if (done || !(BG.has(w) || TEXT.has(w) || UI.has(w))) return w;
      done = true;
      return '*';
    })
    .join('.');
}

/** Pairs inferred from the names of `ids` (color tokens), in the order of their foregrounds. */
export function detectPairs(ids: readonly string[]): Pair[] {
  const parsed = ids.map(parse);
  const bgs = parsed.filter((p) => p.role === 'bg');
  const byKey = (list: Parsed[], key: string) => list.filter((p) => p.key === key);
  const defaults = byKey(bgs, '');
  const pairs = new Map<string, Pair>();
  for (const fg of parsed.filter((p) => p.role === 'fg')) {
    let match = byKey(bgs, fg.key);
    // "on-primary" sits on "primary", which has no background word of its own.
    if (fg.on) match = [...match, ...byKey(parsed.filter((p) => p.role === 'none'), fg.key)];
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

/** Detected pairs with the user's additions, removals and kind changes. */
export function applyPairEdits(detected: readonly Pair[], edits: PairEdits): Pair[] {
  const removed = new Set(edits.removed);
  const seen = new Set(detected.map((p) => p.id));
  return [...detected, ...edits.added.filter((p) => !seen.has(p.id))]
    .filter((p) => !removed.has(p.id))
    .map((p) => (edits.kinds[p.id] ? { ...p, kind: edits.kinds[p.id]! } : p));
}

/** The level each target requires of a pair: the text level, or the non-text one for UI parts. */
const REQUIRED: Record<PairKind, Record<ContrastTarget, string>> = {
  // WCAG passes at AA; AAA is shown as a level reached, not required.
  text: { wcag: 'aa', apca: 'lc60' },
  ui: { wcag: 'aa-large', apca: 'lc45' },
};

export function requiredLevels(kind: PairKind, targets: readonly ContrastTarget[]): Level[] {
  const ids = [...new Set(targets.map((t) => REQUIRED[kind][t]))];
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

/** The color a token shows: the value of a color token, or the color part of a composite border. */
export function tokenColor(t: Token | undefined): ColorInfo | undefined {
  if (!t || t.resolution !== 'ok') return undefined;
  if (t.type === 'color') return colorInfo(t.value);
  if (t.type === 'border' && t.value && typeof t.value === 'object') return colorInfo((t.value as { color?: unknown }).color);
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

const colorOf = (model: Model, id: string) => tokenColor(model.tokens.get(id));

/** Check a foreground on a background for a pair of `kind`. */
export function checkColors(fg: ColorInfo, bg: ColorInfo, kind: PairKind, targets: readonly ContrastTarget[]): PairCheck {
  const shown = over(fg, bg);
  const levels = requiredLevels(kind, targets);
  const values: Partial<Record<Metric, number>> = {};
  for (const m of new Set(levels.map((l) => l.metric))) values[m] = contrast(shown, bg, m);
  const results = levels.map((level) => ({ level, value: values[level.metric]!, pass: values[level.metric]! >= level.threshold }));
  return { fg, bg, shown, values, results, pass: results.every((r) => r.pass) };
}

/**
 * Check a pair in one model (theme), as seen with `vision`. Undefined when
 * either token is missing or not a color there.
 */
export function checkPair(pair: Pair, model: Model, targets: readonly ContrastTarget[], vision: Vision = 'normal'): PairCheck | undefined {
  const fg = colorOf(model, pair.fg);
  const bg = colorOf(model, pair.bg);
  return fg && bg ? checkColors(simulate(fg, vision), simulate(bg, vision), pair.kind, targets) : undefined;
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
  const allowed = id ? MAY_REFERENCE[tiers.get(id) ?? 'semantic'] : (['base'] as const);
  const loops = id ? leadsTo(model, id) : new Set<string>();
  const groups = new Map<string, AliasCandidate[]>();
  const tokens = [...model.tokens.values()].sort((a, b) => allowed.indexOf(tiers.get(a.id)!) - allowed.indexOf(tiers.get(b.id)!) || a.order - b.order);
  for (const t of tokens) {
    const tier = tiers.get(t.id)!;
    if (t.type !== 'color' || !allowed.includes(tier) || t.id === id || loops.has(t.id)) continue;
    const info = tokenColor(t);
    if (!info) continue;
    const label = `${TIER_LABEL[tier]} · ${t.path.slice(0, -1).join('.') || 'top level'}`;
    groups.set(label, [...(groups.get(label) ?? []), { id: t.id, info }]);
  }
  return [...groups].map(([label, tokens]) => ({ label, tokens }));
}

/** Tokens whose references lead to `id`, directly or through others. */
function leadsTo(model: Model, id: string): Set<string> {
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
export function colorTokenIds(models: readonly Model[]): string[] {
  const seen = new Map<string, number>();
  for (const m of models) for (const t of m.tokens.values()) if ((t.type === 'color' || t.type === 'border') && !seen.has(t.id) && tokenColor(t)) seen.set(t.id, t.order);
  return [...seen].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}
