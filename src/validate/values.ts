import { DTCG_SPACES, cssToDtcg, round, toHex } from '../color/dtcg';
import { DTCG_TYPES, FONT_WEIGHT_NAMES, LEGACY_EXT, LEGACY_TO_DTCG, VALUE_EXTRAS } from '../legacy/types';
import { convertLegacyValue, isAlias, parseCubicBezier, parseDimension, parseDuration, parseFontFamily, parseFontWeight, parseNumber, type Dimension } from '../legacy/values';
import { makeIssue, parseAlias } from '../model/build';
import { closest } from '../model/suggest';
import { modeValues } from '../model/modes';
import type { Edit, Fix, Issue, Model, Token } from '../model/types';
import { findEmbedded } from './references';

/**
 * Type and value rules. Each token's `$value` is checked against its type's
 * DTCG 2025.10 shape. Problems with a mechanical fix (legacy strings, 0–255
 * components, a stale hex) are corrected in one combined fix per token, so
 * fixes never overwrite each other.
 */

const TYPES = new Set<string>(DTCG_TYPES);
const STROKE_STYLES = ['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'outset', 'inset'];
const LINE_CAPS = ['round', 'butt', 'square'];
const UNIT_SPACES = new Set(['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020']);
const TYPOGRAPHY_FIELDS = { fontFamily: 'fontFamily', fontSize: 'dimension', fontWeight: 'fontWeight', letterSpacing: 'letterSpacing', lineHeight: 'lineHeight' };
/** Tokens Studio typography properties DTCG has no place for. A fix keeps them in the legacy extension, which converts back on export. */
export const TYPOGRAPHY_EXTRAS = ['textCase', 'textDecoration', 'paragraphSpacing', 'paragraphIndent'];
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);
const RELATIVE_RE = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(%|em)\s*$/;
/** Root font size for comparing px with rem. */
const ROOT_PX = 16;

interface Problem {
  message: string;
  /** True when the corrected value fixes it. */
  fixable: boolean;
  /** Legacy forms and likely mistakes are warnings; everything else is an error. */
  level: 'legacy' | 'warning' | 'error';
  /** Label for the fix when this is the only fixable problem. */
  fixLabel?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isRef = (v: unknown) => isAlias(v) || (isObj(v) && Object.keys(v).length === 1 && typeof v.$ref === 'string');
const show = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const toPx = (d: Dimension) => (d.unit === 'rem' ? d.value * ROOT_PX : d.value);
const dim = (d: Dimension) => `${d.value}${d.unit}`;
const asDimension = (v: unknown): Dimension | undefined =>
  isObj(v) ? (typeof v.value === 'number' && (v.unit === 'px' || v.unit === 'rem') ? (v as unknown as Dimension) : undefined) : typeof v === 'string' && /(px|rem)\s*$/.test(v) ? parseDimension(v) : undefined;

class Checker {
  problems: Problem[] = [];
  /** Typography properties moved out of the value, to keep in the legacy extension. */
  moved?: Record<string, unknown>;
  /** The font size the typography's relative values are measured against. */
  private size?: Dimension;

  /** `fontSize` is the resolved font size of a typography token, for when its own value is a reference. */
  constructor(
    private fontSize?: Dimension,
    /** True when that referenced size changes between modes, so no single conversion is right. */
    private sizeVaries = false,
  ) {}

  /** Why a relative value can't be converted here. */
  private get noSize() {
    return this.sizeVaries ? 'the font size it uses changes between modes, so each mode needs its own value' : "the font size isn't known here to convert it";
  }

  private add(message: string, fixable: boolean, legacy = false, fixLabel?: string) {
    const p: Problem = { message, fixable, level: legacy ? 'legacy' : 'error' };
    if (fixLabel) p.fixLabel = fixLabel;
    this.problems.push(p);
  }

  private warn(message: string, fixLabel: string) {
    this.problems.push({ message, fixable: true, level: 'warning', fixLabel });
  }

  /** A likely mistake that may be intended, so it's a warning; fixable when the right value is known. */
  private suspect(message: string, fixable: boolean) {
    this.problems.push({ message, fixable, level: 'warning' });
  }

  /** Check `v` as `type`; return the value with every mechanical fix applied. */
  check(type: string, v: unknown, at: string): unknown {
    if (isRef(v)) return v;
    switch (type) {
      case 'color':
        return this.color(v, at);
      case 'dimension':
        return this.unitValue(v, at, 'dimension', ['px', 'rem'], parseDimension);
      case 'duration':
        return this.unitValue(v, at, 'duration', ['ms', 's'], parseDuration);
      case 'number': {
        if (typeof v === 'number') return v;
        const n = parseNumber(v);
        this.add(`${at} must be a number, not ${show(v)}.`, n !== undefined, n !== undefined);
        return n ?? v;
      }
      case 'fontWeight': {
        if (typeof v === 'number' && v >= 1 && v <= 1000) return v;
        if (typeof v === 'string' && v in FONT_WEIGHT_NAMES) return v;
        const w = parseFontWeight(v);
        this.add(`${at} must be a number from 1 to 1000 or a keyword like "bold", not ${show(v)}.`, w !== undefined, w !== undefined);
        return w ?? v;
      }
      case 'fontFamily': {
        if (typeof v === 'string' && v.includes(',')) {
          // CSS stack syntax: DTCG reads the whole string as one font name.
          const list = parseFontFamily(v);
          this.add(`${at} is a CSS font stack (${show(v)}); DTCG reads a string as one font name, so a stack is a list: ${JSON.stringify(list)}.`, true, true);
          return list;
        }
        if (typeof v === 'string' || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string'))) return v;
        this.add(`${at} must be a font name or a list of font names.`, false);
        return v;
      }
      case 'cubicBezier': {
        if (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number' || isRef(x))) {
          const [x1, , x2] = v as number[];
          if ((typeof x1 === 'number' && (x1 < 0 || x1 > 1)) || (typeof x2 === 'number' && (x2 < 0 || x2 > 1))) {
            this.add(`${at}: the x coordinates (1st and 3rd numbers) must be between 0 and 1.`, false);
          }
          return v;
        }
        const b = parseCubicBezier(v);
        this.add(`${at} must be an array of four numbers, not ${show(v)}.`, b !== undefined, b !== undefined);
        return b ?? v;
      }
      case 'strokeStyle':
        if (typeof v === 'string') {
          if (!STROKE_STYLES.includes(v)) this.add(`${at} must be one of ${STROKE_STYLES.join(', ')}, not ${show(v)}.`, false);
          return v;
        }
        return this.composite(v, at, { dashArray: 'dashArray', lineCap: 'lineCap' }, ['dashArray', 'lineCap']);
      case 'border':
        return this.composite(v, at, { color: 'color', width: 'dimension', style: 'strokeStyle' });
      case 'transition':
        return this.composite(v, at, { duration: 'duration', delay: 'duration', timingFunction: 'cubicBezier' });
      case 'shadow': {
        const one = (s: unknown, where: string) => {
          if (isObj(s) && ('x' in s || 'y' in s) && !('offsetX' in s)) {
            this.add(`${where} uses Tokens Studio shadow properties (x, y, type).`, true, true);
            return this.check('shadow', convertLegacyValue('shadow', s, () => {}), where);
          }
          const out = this.composite(s, where, { color: 'color', offsetX: 'dimension', offsetY: 'dimension', blur: 'dimension', spread: 'dimension', inset: 'boolean' }, ['color', 'offsetX', 'offsetY', 'blur', 'spread']);
          return out;
        };
        return Array.isArray(v) ? v.map((s, i) => one(s, `${at}[${i}]`)) : one(v, at);
      }
      case 'gradient':
        if (!Array.isArray(v)) {
          this.add(`${at} must be an array of color stops.`, false);
          return v;
        }
        return v.map((stop, i) => {
          const out = this.composite(stop, `${at}[${i}]`, { color: 'color', position: 'number' });
          if (isObj(out) && typeof out.position === 'number' && (out.position < 0 || out.position > 1)) this.add(`${at}[${i}].position must be between 0 and 1.`, false);
          return out;
        });
      case 'typography':
        return this.typography(v, at);
      case 'letterSpacing':
        return this.letterSpacing(v, at);
      case 'lineHeight':
        return this.lineHeight(v, at);
      case 'boolean':
        if (typeof v !== 'boolean') this.add(`${at} must be true or false.`, false);
        return v;
      case 'dashArray':
        if (!Array.isArray(v)) {
          this.add(`${at} must be an array of dimensions.`, false);
          return v;
        }
        return v.map((x, i) => this.check('dimension', x, `${at}[${i}]`));
      case 'lineCap':
        if (!LINE_CAPS.includes(v as string)) this.add(`${at} must be one of ${LINE_CAPS.join(', ')}.`, false);
        return v;
      default:
        return v;
    }
  }

  private typography(v: unknown, at: string): unknown {
    if (!isObj(v)) {
      this.add(`${at} must be an object with ${Object.keys(TYPOGRAPHY_FIELDS).join(', ')}.`, false);
      return v;
    }
    const extras = Object.keys(v).filter((k) => TYPOGRAPHY_EXTRAS.includes(k));
    let rest: Record<string, unknown> = v;
    if (extras.length) {
      this.moved = Object.fromEntries(extras.map((k) => [k, v[k]]));
      rest = Object.fromEntries(Object.entries(v).filter(([k]) => !extras.includes(k)));
      this.add(`${at} has Tokens Studio properties DTCG typography doesn't define: ${extras.map((k) => `“${k}”`).join(', ')}. The fix keeps them under “$extensions”.`, true, true);
    }
    this.size = isRef(rest.fontSize) ? this.fontSize : asDimension(rest.fontSize) ?? (typeof rest.fontSize === 'number' ? parseDimension(rest.fontSize) : undefined);
    const out = this.composite(rest, at, TYPOGRAPHY_FIELDS) as Record<string, unknown>;
    const size = asDimension(out.fontSize);
    if (size && size.value <= 0) this.add(`${at}.fontSize must be greater than 0.`, false);
    return out;
  }

  /** DTCG letter spacing is a px or rem dimension; "%" and "em" are relative to the font size. */
  private letterSpacing(v: unknown, at: string): unknown {
    const m = typeof v === 'string' ? RELATIVE_RE.exec(v) : null;
    if (!m) return this.check('dimension', v, at);
    const share = m[2] === '%' ? Number(m[1]) / 100 : Number(m[1]);
    if (share === 0) {
      this.add(`${at} is ${show(v)}; DTCG letter spacing is a dimension like {"value": 0, "unit": "px"}.`, true, true);
      return { value: 0, unit: 'px' };
    }
    if (!this.size) {
      this.add(`${at} is ${show(v)}, relative to the font size; DTCG letter spacing must be px or rem, and ${this.noSize}.`, false);
      return v;
    }
    const out: Dimension = { value: Math.round(share * this.size.value * 10000) / 10000, unit: this.size.unit };
    this.add(`${at} is ${show(v)} of the font size; DTCG letter spacing must be px or rem: ${dim(out)} at ${dim(this.size)}.`, true, true);
    return out;
  }

  /** DTCG line height is a number that multiplies the font size. */
  private lineHeight(v: unknown, at: string): unknown {
    let n: number | undefined;
    if (typeof v === 'number') n = v;
    else {
      const length = asDimension(v);
      if (length) {
        if (!this.size) {
          this.add(`${at} is a length (${dim(length)}); DTCG line height is a number that multiplies the font size, like 1.5, and ${this.noSize}.`, false);
          return v;
        }
        const ratio = round3(toPx(length) / toPx(this.size));
        this.add(`${at} is a length (${dim(length)}); DTCG line height is a multiplier of the font size: ${dim(length)} ÷ ${dim(this.size)} = ${ratio}.`, true, true);
        return ratio;
      }
      if (typeof v === 'string' && /^\s*(auto|normal)\s*$/i.test(v)) {
        this.add(`${at} is ${show(v)}; DTCG needs a number. Most fonts' normal spacing is about 1.2.`, false);
        return v;
      }
      n = parseNumber(v);
      if (n === undefined) {
        this.add(`${at} must be a number that multiplies the font size, like 1.5, not ${show(v)}.`, false);
        return v;
      }
      this.add(`${at} must be a number, not ${show(v)}.`, true, true);
    }
    if (n <= 0) {
      this.add(`${at} must be greater than 0.`, false);
      return n;
    }
    // A plain number this large reads as a multiplier but was almost certainly meant as pixels.
    if (n >= 4) {
      if (this.size) {
        const ratio = round3(n / toPx(this.size));
        this.suspect(`${at} is ${n}, so lines would be ${n} times the font size. It looks like pixels: ${n}px ÷ ${dim(this.size)} = ${ratio}.`, true);
        return ratio;
      }
      this.suspect(`${at} is ${n}, so lines would be ${n} times the font size. If it's meant as pixels, divide it by the font size.`, false);
    }
    return n;
  }

  private unitValue(v: unknown, at: string, what: string, units: string[], parse: (x: unknown) => { value: number; unit: string } | undefined): unknown {
    if (isObj(v)) {
      const okValue = typeof v.value === 'number' && Number.isFinite(v.value);
      const okUnit = typeof v.unit === 'string' && units.includes(v.unit);
      if (okValue && okUnit) return v;
      if (!okValue) this.add(`${at}.value must be a number.`, false);
      if (!okUnit) this.add(`${at}.unit must be ${units.map((u) => `"${u}"`).join(' or ')}${typeof v.unit === 'string' ? `, not "${v.unit}"` : ''}.`, false);
      return v;
    }
    const parsed = parse(v);
    this.add(
      parsed
        ? `${at} is written as ${show(v)}; DTCG ${what}s are objects like {"value": ${parsed.value}, "unit": "${parsed.unit}"}.`
        : `${at} must be a ${what} object with a unit of ${units.join(' or ')}, not ${show(v)}.`,
      !!parsed,
      !!parsed,
    );
    return parsed ?? v;
  }

  private composite(v: unknown, at: string, fields: Record<string, string>, required = Object.keys(fields)): unknown {
    if (!isObj(v)) {
      this.add(`${at} must be an object with ${required.join(', ')}.`, false);
      return v;
    }
    const missing = required.filter((k) => !(k in v));
    if (missing.length) this.add(`${at} is missing ${missing.map((k) => `“${k}”`).join(', ')}.`, false);
    const extra = Object.keys(v).filter((k) => !(k in fields));
    if (extra.length) this.add(`${at} has properties DTCG doesn't define: ${extra.map((k) => `“${k}”`).join(', ')}.`, false);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = fields[k] ? this.check(fields[k], x, `${at}.${k}`) : x;
    return out;
  }

  private color(v: unknown, at: string): unknown {
    if (typeof v === 'string') {
      const c = cssToDtcg(v);
      this.add(
        c ? `${at} is a CSS color string (${v}); DTCG colors are objects with a color space and components.` : `${at} is not a color: ${show(v)}.`,
        !!c,
        !!c,
      );
      return c ?? v;
    }
    if (!isObj(v)) {
      this.add(`${at} must be a color object.`, false);
      return v;
    }
    const out: Record<string, unknown> = { ...v };
    let space = v.colorSpace;
    if (typeof space !== 'string' || !DTCG_SPACES[space]) {
      const lower = typeof space === 'string' ? space.toLowerCase().replace(/\s+/g, '-') : '';
      const fix = DTCG_SPACES[lower] ? lower : typeof space === 'string' ? closest(space, Object.keys(DTCG_SPACES)) : undefined;
      this.add(`${at}.colorSpace ${typeof space === 'string' ? `"${space}" is not a DTCG color space` : 'is missing'}.${fix ? ` Did you mean "${fix}"?` : ''}`, !!fix);
      if (fix) out.colorSpace = space = fix;
    }
    const comps = v.components;
    if (!Array.isArray(comps) || comps.length !== 3 || !comps.every((x) => x === 'none' || (typeof x === 'number' && Number.isFinite(x)))) {
      this.add(`${at}.components must be an array of three numbers (or "none").`, false);
      return out;
    }
    const nums = comps.filter((x): x is number => typeof x === 'number');
    if (typeof space === 'string' && UNIT_SPACES.has(space) && nums.some((x) => x < 0 || x > 1)) {
      const bytes = nums.every((x) => x >= 0 && x <= 255 && Number.isInteger(x));
      this.add(
        bytes ? `${at}.components look like 0–255 values; in ${space} they range from 0 to 1.` : `${at}.components must be between 0 and 1 in ${space}.`,
        bytes,
      );
      if (bytes) out.components = comps.map((x) => (typeof x === 'number' ? round(x / 255) : x));
    }
    if ((space === 'oklch' || space === 'oklab') && typeof comps[0] === 'number' && comps[0] > 1) {
      const pct = comps[0] <= 100;
      this.add(`${at}: lightness in ${space} ranges from 0 to 1${pct ? ', and this looks like a percentage' : ''}.`, pct);
      if (pct) out.components = [round(comps[0] / 100), comps[1], comps[2]];
    }
    if (v.alpha !== undefined && (typeof v.alpha !== 'number' || v.alpha < 0 || v.alpha > 1)) this.add(`${at}.alpha must be a number from 0 to 1.`, false);
    if (v.hex !== undefined) {
      if (typeof v.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(v.hex)) {
        this.add(`${at}.hex must be a 6-digit hex color like "#ff0000".`, false);
      } else if (space === 'srgb') {
        // In other spaces the hex is a gamut-mapped fallback, and mapping methods differ slightly.
        const expected = toHex({ ...out, hex: undefined });
        // One step per channel is rounding in the components, not a real mismatch.
        if (expected && hexDistance(expected, v.hex) > 1) {
          this.warn(`${at}.hex is ${v.hex}, but the components describe ${expected}.`, `Update hex to ${expected}`);
          out.hex = expected;
        }
      }
    }
    const extra = Object.keys(v).filter((k) => !['colorSpace', 'components', 'alpha', 'hex'].includes(k));
    if (extra.length) this.add(`${at} has properties DTCG doesn't define: ${extra.map((k) => `“${k}”`).join(', ')}.`, false);
    return out;
  }
}

/** Largest per-channel difference between two #rrggbb colors. */
function hexDistance(a: string, b: string): number {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return Math.max(...[0, 1, 2].map((i) => Math.abs(ch(a, i) - ch(b, i))));
}

/** Guess a DTCG type from a literal value, for tokens that have none. */
export function inferType(v: unknown): string | undefined {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return cssToDtcg(v) ? 'color' : parseDimension(v) && /px|rem/.test(v) ? 'dimension' : /^\s*[\d.]+\s*m?s\s*$/.test(v) ? 'duration' : undefined;
  if (Array.isArray(v)) return v.length === 4 && v.every((x) => typeof x === 'number') ? 'cubicBezier' : undefined;
  if (isObj(v)) {
    if (typeof v.colorSpace === 'string' && Array.isArray(v.components)) return 'color';
    if (typeof v.value === 'number' && typeof v.unit === 'string') return ['ms', 's'].includes(v.unit) ? 'duration' : 'dimension';
  }
  return undefined;
}

export function typeAndValueRules(model: Model): Issue[] {
  const issues: Issue[] = [];

  for (const g of model.groups) {
    if (g.type === undefined || TYPES.has(g.type)) continue;
    const suggestion = LEGACY_TO_DTCG[g.type] ?? closest(g.type, DTCG_TYPES);
    issues.push(
      makeIssue(
        'error',
        'types',
        'unknown-type',
        `“${g.type}” isn't a DTCG type.${suggestion ? ` Did you mean “${suggestion}”?` : ''}`,
        { fileId: g.fileId, target: g.id, keyPath: g.keyPath, pos: g.pos },
        suggestion ? typeFix(g.fileId, g.keyPath, g.type, suggestion) : undefined,
      ),
    );
  }

  for (const t of model.tokens.values()) {
    if (t.extendedFrom) continue;
    const at = { fileId: t.fileId, target: t.id, keyPath: t.keyPath, pos: t.pos };

    if (t.declaredType !== undefined && !TYPES.has(t.declaredType)) {
      const named = LEGACY_TO_DTCG[t.declaredType] ?? closest(t.declaredType, DTCG_TYPES);
      // The name alone isn't enough: suggest the type only if the value can be one (Open Props types linear() easings "cubic-bezier").
      const suggestion = named && fitsType(named, t.value) ? named : undefined;
      const unfit = named && !suggestion ? ` It reads like “${named}”, but the value isn't one.` : '';
      issues.push(
        makeIssue(
          'error',
          'types',
          'unknown-type',
          `“${t.declaredType}” isn't a DTCG type.${suggestion ? ` Did you mean “${suggestion}”?` : `${unfit} The value goes unchecked.`}`,
          at,
          suggestion ? typeFix(t.fileId, t.keyPath, t.declaredType, suggestion) : undefined,
        ),
      );
      continue;
    }

    if (t.type === undefined) {
      if (t.resolution === 'broken') continue;
      const inferred = parseAlias(t.rawValue) === undefined ? inferType(t.rawValue) : undefined;
      issues.push(
        makeIssue(
          'error',
          'types',
          'missing-type',
          `Set “$type” here or on a parent group.${inferred ? ` The value looks like a ${inferred}.` : ''}`,
          at,
          inferred
            ? { label: `Set “$type” to “${inferred}”`, preview: { before: '(no type)', after: `"$type": "${inferred}"` }, edits: [{ fileId: t.fileId, path: [...t.keyPath, '$type'], value: inferred }] }
            : undefined,
        ),
      );
      continue;
    }

    // Embedded references are reported by the reference rules; the value can't be judged until they're resolved.
    if (!TYPES.has(t.type) || parseAlias(t.rawValue) !== undefined || findEmbedded(t.rawValue)) continue;
    const size = referencedFontSize(model, t);
    const checker = new Checker(size === 'varies' ? undefined : size, size === 'varies');
    // Parts given by "$ref" pointers (Carbon writes a palette color at 12% opacity this way) are checked
    // as they resolve; a broken pointer is the reference rules' to report. No fix: it would overwrite the pointers.
    const pointer = hasPointer(t.rawValue);
    if (pointer && (t.resolution !== 'ok' || t.value === undefined)) continue;
    const fixed = checker.check(t.type, pointer ? t.value : t.rawValue, '$value');
    if (checker.problems.length === 0) continue;
    const problems = checker.problems;
    const hasError = problems.some((p) => p.level === 'error');
    const legacyOnly = problems.every((p) => p.level === 'legacy');
    const fixable = problems.filter((p) => p.fixable);
    const changed = JSON.stringify(fixed) !== JSON.stringify(t.rawValue);
    let fix: Fix | undefined;
    if (fixable.length && changed && !pointer) {
      const label =
        fixable.length < problems.length
          ? `Fix ${fixable.length} of ${problems.length} problems`
          : fixable.length === 1 && fixable[0]!.fixLabel
            ? fixable[0]!.fixLabel
            : fixable.every((p) => p.level === 'legacy')
              ? 'Convert to the DTCG form'
              : 'Fix the value';
      const edits: Edit[] = [{ fileId: t.fileId, path: [...t.keyPath, ...t.valuePath], value: fixed }];
      if (checker.moved) {
        const legacy = isObj(t.extensions?.[LEGACY_EXT]) ? (t.extensions[LEGACY_EXT] as Record<string, unknown>) : {};
        const kept = isObj(legacy[VALUE_EXTRAS]) ? legacy[VALUE_EXTRAS] : {};
        edits.push({ fileId: t.fileId, path: [...t.keyPath, '$extensions', LEGACY_EXT], value: { ...legacy, [VALUE_EXTRAS]: { ...kept, ...checker.moved } } });
      }
      const preview = changedParts(t.rawValue, fixed);
      if (checker.moved) preview.after = `${preview.after === '{}' ? '' : `${preview.after} and `}“$extensions” ${compact(checker.moved)}`;
      fix = { label, preview, edits };
    }
    const lines = problems.map((p) => p.message);
    issues.push(
      makeIssue(
        hasError ? 'error' : 'warning',
        'values',
        hasError ? 'invalid-value' : legacyOnly ? 'legacy-value' : 'inconsistent-value',
        lines.join(' '),
        at,
        fix,
      ),
    );
  }
  issues.push(...fontFallbackNotes(model));
  return issues;
}

/**
 * The font size a typography token references, resolved, for converting its relative
 * values. Undefined when the size changes between modes: a converted value would
 * only be right in one of them.
 */
function referencedFontSize(model: Model, t: Token): Dimension | 'varies' | undefined {
  if (t.type !== 'typography' || !isObj(t.rawValue) || !isObj(t.value)) return undefined;
  const seen = new Set<string>();
  for (let id = parseAlias(t.rawValue.fontSize); id && !seen.has(id); ) {
    seen.add(id);
    const target = model.tokens.get(id);
    if (!target) return undefined;
    if (modeValues(target.extensions)) return 'varies';
    id = target.aliasOf;
  }
  return asDimension(t.value.fontSize);
}

/**
 * A font family written without a generic family (sans-serif, serif…) at the end:
 * if the named fonts don't load, the browser falls back to its default, often a serif.
 * Reported where the family is written, not on every token that references it.
 */
function fontFallbackNotes(model: Model): Issue[] {
  const issues: Issue[] = [];
  for (const t of model.tokens.values()) {
    if (t.extendedFrom || (t.type !== 'fontFamily' && t.type !== 'typography')) continue;
    const family = t.type === 'typography' ? (isObj(t.rawValue) ? t.rawValue.fontFamily : undefined) : t.rawValue;
    const list = Array.isArray(family) ? family : typeof family === 'string' && !family.includes(',') && !isRef(family) ? [family] : undefined;
    if (!list?.length || !list.every((x) => typeof x === 'string')) continue;
    if (list.some((x) => GENERIC_FAMILIES.has((x as string).trim().toLowerCase()))) continue;
    issues.push(
      makeIssue(
        'info',
        'values',
        'font-fallback',
        `${list.map((x) => `“${x}”`).join(', ')} ${list.length > 1 ? 'end' : 'ends'} without a generic family like sans-serif, serif or monospace. If the font doesn't load, the browser picks its own default.`,
        { fileId: t.fileId, target: t.id, keyPath: t.keyPath, pos: t.pos },
      ),
    );
  }
  return issues;
}

function typeFix(fileId: string, keyPath: string[], from: string, to: string): Fix {
  return { label: `Change type to “${to}”`, preview: { before: `"$type": "${from}"`, after: `"$type": "${to}"` }, edits: [{ fileId, path: [...keyPath, '$type'], value: to }] };
}

/** Whether a value has a `{"$ref": …}` pointer anywhere in it. */
function hasPointer(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasPointer);
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (Object.keys(o).length === 1 && typeof o.$ref === 'string') || Object.values(o).some(hasPointer);
}

/** Whether a resolved value can be of `type`, possibly after a mechanical fix; an unresolved value is given the benefit of the doubt. */
function fitsType(type: string, value: unknown): boolean {
  if (value === undefined) return true;
  const checker = new Checker();
  checker.check(type, value, '$value');
  return checker.problems.every((p) => p.fixable || p.level !== 'error');
}

/** Before/after text for a fix: for an object value (typography, border…), only the properties that change. */
function changedParts(before: unknown, after: unknown): { before: string; after: string } {
  if (!isObj(before) || !isObj(after)) return { before: compact(before), after: compact(after) };
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
  return { before: compact(pick(before)), after: compact(pick(after)) };
}

const compact = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
};
