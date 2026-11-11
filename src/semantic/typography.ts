import { FONT_WEIGHT_NAMES } from '../legacy/types';
import { MAY_REFERENCE, PICK_FROM, TIER_LABEL, tiersOf, type Tier } from '../model/tiers';
import type { Edit, Model, Token } from '../model/types';
import { leadsTo } from './pairs';

/**
 * Typography styles of one tier, each with the parts it is made of: the
 * token every part references, or its own value, and where a new reference
 * would be written. Parts are found by the DTCG composite keys and candidate
 * tokens by type, never by name.
 */

export const PARTS = [
  { key: 'fontFamily', type: 'fontFamily', label: 'Family' },
  { key: 'fontSize', type: 'dimension', label: 'Size' },
  { key: 'fontWeight', type: 'fontWeight', label: 'Weight' },
  { key: 'lineHeight', type: 'number', label: 'Line height' },
  { key: 'letterSpacing', type: 'dimension', label: 'Letter spacing' },
] as const;

export type PartKey = (typeof PARTS)[number]['key'];

const REF = /^\{([^{}]+)\}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface StylePart {
  key: PartKey;
  /** The token the part references, when it is a reference. */
  ref?: string;
  /** The part as written, when it is a value of its own. */
  literal?: unknown;
  /** The resolved part. */
  value?: unknown;
}

export interface TypeStyle {
  id: string;
  token: Token;
  /** Set when the whole style is a reference to another style: its parts are that style's. */
  aliasOf?: string;
  parts: StylePart[];
  /** The resolved style; undefined when a reference is broken. */
  value?: Record<string, unknown>;
  /** Whether references can be written here (not a copy made by `$extends`). */
  editable: boolean;
  /** Set on an alias of another style: its parts are read from the style the alias leads to. */
  inherited?: boolean;
}

/** The parts written on the style an alias leads to, following aliases of aliases. */
function aliasedParts(model: Model, t: Token): Record<string, unknown> | undefined {
  const seen = new Set<string>();
  let cur: Token | undefined = t;
  while (cur?.aliasOf && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = model.tokens.get(cur.aliasOf);
  }
  return cur && !cur.aliasOf && isObj(cur.rawValue) ? cur.rawValue : undefined;
}

/**
 * A typography token's parts, as written and resolved. For an alias of
 * another style, given the model, the parts are those of the style it leads to.
 */
export function typeStyle(t: Token, model?: Model): TypeStyle {
  const value = t.resolution === 'ok' && isObj(t.value) ? t.value : undefined;
  const raw = t.aliasOf ? (model ? aliasedParts(model, t) : undefined) : isObj(t.rawValue) ? t.rawValue : undefined;
  const parts = PARTS.map(({ key }): StylePart => {
    const w = raw?.[key];
    const m = typeof w === 'string' ? REF.exec(w) : null;
    return { key, ...(m ? { ref: m[1]! } : raw && w !== undefined ? { literal: w } : {}), value: value?.[key] };
  });
  return { id: t.id, token: t, ...(t.aliasOf ? { aliasOf: t.aliasOf, inherited: true } : {}), parts, ...(value ? { value } : {}), editable: !t.extendedFrom };
}

/** Typography tokens of `tier` in `model`, in source order. */
export function typographyIds(model: Model, tier: Tier): string[] {
  const tiers = tiersOf(model);
  return [...model.tokens.values()]
    .filter((t) => t.type === 'typography' && tiers.get(t.id) === tier)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id);
}

/** Typography tokens of `tier` across every theme, in source order. */
export function typographyIdsIn(models: readonly Model[], tier: Tier): string[] {
  const seen = new Map<string, number>();
  for (const m of models) for (const id of typographyIds(m, tier)) if (!seen.has(id)) seen.set(id, m.tokens.get(id)!.order);
  return [...seen].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

export interface PartCandidate {
  id: string;
  value: unknown;
  /** Its value equals the part's own value. */
  same: boolean;
}

/**
 * Tokens a part of style `id` may point at: tokens of the part's type in a
 * tier the style may reference, that don't lead back to it. Groups whose
 * tokens other styles already use for this part come first. With `key`
 * undefined, other typography styles the whole style may alias.
 */
export function partCandidates(model: Model, id: string, key?: PartKey): { label: string; tokens: PartCandidate[] }[] {
  const tiers = tiersOf(model);
  // Parts follow the picker tiers (a semantic style's parts point at base tokens); a whole style may alias another style of its tier.
  const allowed = (key ? PICK_FROM : MAY_REFERENCE)[tiers.get(id) ?? 'semantic'];
  const type = key ? PARTS.find((p) => p.key === key)!.type : 'typography';
  const loops = leadsTo(model, id);
  const own = model.tokens.get(id);
  const literal = key && own ? typeStyle(own, model).parts.find((p) => p.key === key)?.literal : undefined;
  const used = new Set<string>();
  if (key)
    for (const t of model.tokens.values()) {
      if (t.type !== 'typography' || t.id === id) continue;
      const ref = typeStyle(t).parts.find((p) => p.key === key)?.ref;
      if (ref) used.add(ref);
    }
  const groups = new Map<string, { used: boolean; rank: number; order: number; tokens: PartCandidate[] }>();
  for (const t of model.tokens.values()) {
    const tier = tiers.get(t.id)!;
    if (t.type !== type || t.resolution !== 'ok' || t.id === id || loops.has(t.id) || !allowed.includes(tier)) continue;
    const label = `${TIER_LABEL[tier]} · ${t.path.slice(0, -1).join('.') || 'top level'}`;
    const g = groups.get(label) ?? { used: false, rank: allowed.indexOf(tier), order: t.order, tokens: [] };
    g.used ||= used.has(t.id);
    g.order = Math.min(g.order, t.order);
    g.tokens.push({ id: t.id, value: t.value, same: literal !== undefined && sameValue(key!, literal, t.value) });
    groups.set(label, g);
  }
  return [...groups]
    .sort(([, a], [, b]) => Number(b.used) - Number(a.used) || a.rank - b.rank || a.order - b.order)
    .map(([label, g]) => ({ label, tokens: g.tokens.sort((a, b) => model.tokens.get(a.id)!.order - model.tokens.get(b.id)!.order) }));
}

/**
 * The edits that point part `key` of style `id` at `target` (or, with `key`
 * undefined, the whole style), in every model given — every theme the
 * caller shows the part in — in the file and mode each reads it from.
 * Only the reference changes; no value is written. A part of a style that
 * is an alias of another is written by giving the style its own parts:
 * those of the style it led to, with this part changed.
 */
export function pointPart(models: readonly Model[], id: string, key: PartKey | undefined, target: string): Edit[] {
  const edits = new Map<string, Edit>();
  for (const m of models) {
    const t = m.tokens.get(id);
    if (!t || t.extendedFrom) continue;
    if (key && t.aliasOf) {
      const parts = aliasedParts(m, t);
      if (!parts) continue;
      const path = [...t.keyPath, ...t.valuePath];
      edits.set(`${t.fileId}|${path.join('\u0000')}`, { fileId: t.fileId, path, value: { ...parts, [key]: `{${target}}` } });
      continue;
    }
    if (key && !isObj(t.rawValue)) continue;
    const path = [...t.keyPath, ...t.valuePath, ...(key ? [key] : [])];
    edits.set(`${t.fileId}|${path.join('\u0000')}`, { fileId: t.fileId, path, value: `{${target}}` });
  }
  return [...edits.values()];
}

/** A part's value as people write it: `1.5rem`, `Inter, sans-serif`, `600`. */
export function formatPart(v: unknown): string {
  if (v === undefined) return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (isObj(v) && 'value' in v) return `${v.value}${typeof v.unit === 'string' ? v.unit : ''}`;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

const weight = (v: unknown) => (typeof v === 'string' ? (FONT_WEIGHT_NAMES[v.toLowerCase().replace(/[\s_]+/g, '-')] ?? v) : v);
const families = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')) : []);
const dimension = (v: unknown) => {
  if (isObj(v)) return `${Number(v.value)}${v.unit}`;
  const m = typeof v === 'string' ? /^(-?\d*\.?\d+)\s*([a-z%]*)$/i.exec(v.trim()) : null;
  return m ? `${Number(m[1])}${m[2] || 'px'}` : typeof v === 'number' ? `${v}px` : String(v);
};

/** Whether two values of a part are the same, however each is written. */
export function sameValue(key: PartKey, a: unknown, b: unknown): boolean {
  switch (key) {
    case 'fontFamily':
      return families(a).join('\u0000').toLowerCase() === families(b).join('\u0000').toLowerCase();
    case 'fontWeight':
      return String(weight(a)) === String(weight(b));
    case 'lineHeight':
      return Number(a) === Number(b);
    default:
      return dimension(a) === dimension(b) || (Number.parseFloat(dimension(a)) === 0 && Number.parseFloat(dimension(b)) === 0);
  }
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);

/** CSS that renders a resolved style. Values the browser rejects are dropped by it. */
export function styleCss(v: Record<string, unknown>): Partial<Record<'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing', string>> {
  const css: ReturnType<typeof styleCss> = {};
  const fam = families(v.fontFamily);
  if (fam.length) css.fontFamily = fam.map((f) => (GENERIC.has(f.toLowerCase()) ? f : `"${f.replace(/["\\]/g, '')}"`)).join(', ');
  if (v.fontSize !== undefined) css.fontSize = dimension(v.fontSize);
  if (v.fontWeight !== undefined) css.fontWeight = String(weight(v.fontWeight));
  if (typeof v.lineHeight === 'number') css.lineHeight = String(v.lineHeight);
  if (v.letterSpacing !== undefined) css.letterSpacing = dimension(v.letterSpacing);
  return css;
}

/** The root font size `rem` is read against. */
export const ROOT_PX = 16;

/** A font size in px, when it is in px or rem. */
export function sizePx(v: unknown): number | undefined {
  const d = dimension(v);
  const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(d);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Math.round((m[2] === 'rem' ? n * ROOT_PX : n) * 100) / 100;
}

export interface RangeNote {
  severity: 'warning' | 'info';
  code: 'same' | 'close' | 'small';
  /** The styles the note is about. */
  ids: string[];
  message: string;
}

/** Styles below this size are hard to read. */
export const MIN_PX = 12;
/** Neighbouring sizes closer than this ratio, with the same family and weight, are hard to tell apart. */
export const MIN_STEP = 1.1;

/**
 * Checks across a whole range of styles, as resolved in one mode: styles
 * that look the same, neighbouring sizes too close to tell apart, and text
 * too small to read. A style that is an alias of another is meant to look
 * the same, so it is left out of the comparisons.
 */
export function rangeNotes(styles: readonly { id: string; aliasOf?: string; value?: Record<string, unknown> }[]): RangeNote[] {
  const notes: RangeNote[] = [];
  const own = styles.filter((s) => s.value && !s.aliasOf);
  const looks = new Map<string, string[]>();
  for (const s of own) {
    const key = JSON.stringify(styleCss(s.value!));
    looks.set(key, [...(looks.get(key) ?? []), s.id]);
  }
  for (const ids of looks.values())
    if (ids.length > 1) notes.push({ severity: 'warning', code: 'same', ids, message: `${ids.join(', ')} look the same: every part resolves to the same value.` });
  const same = new Set([...looks.values()].filter((ids) => ids.length > 1).flatMap((ids) => ids.slice(1)));
  const sized = own
    .filter((s) => !same.has(s.id))
    .map((s) => ({ s, px: sizePx(s.value!.fontSize), css: styleCss(s.value!) }))
    .filter((x): x is typeof x & { px: number } => x.px !== undefined && x.px > 0)
    .sort((a, b) => b.px - a.px);
  for (let i = 1; i < sized.length; i++) {
    const [a, b] = [sized[i - 1]!, sized[i]!];
    if (a.css.fontWeight === b.css.fontWeight && a.css.fontFamily === b.css.fontFamily && a.px / b.px < MIN_STEP && JSON.stringify(a.css) !== JSON.stringify(b.css)) {
      notes.push({
        severity: 'warning',
        code: 'close',
        ids: [a.s.id, b.s.id],
        message: `${a.s.id} (${a.px}px) and ${b.s.id} (${b.px}px) are less than ${Math.round((MIN_STEP - 1) * 100)}% apart in size, with the same family and weight: hard to tell apart.`,
      });
    }
  }
  for (const x of sized) if (x.px < MIN_PX) notes.push({ severity: 'warning', code: 'small', ids: [x.s.id], message: `${x.s.id} is ${x.px}px; text under ${MIN_PX}px is hard to read.` });
  return notes;
}
