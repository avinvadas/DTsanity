import Color from 'colorjs.io';

/**
 * What a token value means, independently of how it is written: the oracle
 * for "fixes change the format, never the design". Written apart from the
 * app's own conversions (only Color.js is shared), so a conversion bug in
 * the app shows up as a difference here instead of agreeing with itself.
 *
 * A legacy "#ff0000", the DTCG color object for it and its 0–255 variant
 * mean the same; so do "16px", 1rem and {"value": 16, "unit": "px"}; a
 * line height of 24px on a 16px font and the multiplier 1.5.
 */

export type Meaning = { kind: 'color'; oklab: [number, number, number]; alpha: number } | { kind: 'num'; n: number; unit: string } | { kind: 'list'; items: Meaning[] } | { kind: 'map'; entries: Record<string, Meaning> } | { kind: 'raw'; json: string };

const REM = 16;

const DTCG_TO_COLORJS: Record<string, string> = {
  srgb: 'srgb',
  'srgb-linear': 'srgb-linear',
  hsl: 'hsl',
  hwb: 'hwb',
  lab: 'lab',
  lch: 'lch',
  oklab: 'oklab',
  oklch: 'oklch',
  'display-p3': 'p3',
  'a98-rgb': 'a98rgb',
  'prophoto-rgb': 'prophoto',
  rec2020: 'rec2020',
  'xyz-d65': 'xyz-d65',
  'xyz-d50': 'xyz-d50',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function color(v: unknown): Meaning | undefined {
  try {
    let c: Color | undefined;
    if (typeof v === 'string') c = new Color(v.trim());
    else if (isObj(v) && typeof v.colorSpace === 'string' && Array.isArray(v.components)) {
      const space = DTCG_TO_COLORJS[v.colorSpace.toLowerCase()];
      if (!space) return undefined;
      let comps = v.components.map((x) => (x === 'none' ? 0 : Number(x)));
      // A 0–255 sRGB triple means what the 0–1 one does.
      if (space === 'srgb' && comps.some((x) => x > 1)) comps = comps.map((x) => x / 255);
      c = new Color(space, comps as [number, number, number], typeof v.alpha === 'number' ? v.alpha : 1);
    } else if (isObj(v) && typeof v.hex === 'string') c = new Color(v.hex);
    if (!c) return undefined;
    const lab = c.to('oklab').coords.map((x) => (Number.isFinite(x) ? x : 0)) as [number, number, number];
    const alpha = Number(c.alpha);
    return { kind: 'color', oklab: lab, alpha: Number.isFinite(alpha) ? alpha : 1 };
  } catch {
    return undefined;
  }
}

const UNITS: Record<string, [string, number]> = { px: ['px', 1], rem: ['px', REM], ms: ['ms', 1], s: ['ms', 1000] };

/** A length or a duration, in px or ms; a bare number takes `bare` as its unit (px for lengths, as tools read it). */
function measure(v: unknown, fontPx?: number, bare = ''): Meaning | undefined {
  if (typeof v === 'number') return { kind: 'num', n: v, unit: bare };
  if (isObj(v) && typeof v.value === 'number' && typeof v.unit === 'string') {
    const u = UNITS[v.unit];
    return u ? { kind: 'num', n: v.value * u[1], unit: u[0] } : undefined;
  }
  if (typeof v === 'string') {
    const m = /^\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*(px|rem|ms|s|%)?\s*$/i.exec(v);
    if (!m) return undefined;
    const n = Number(m[1]);
    if (!m[2]) return { kind: 'num', n, unit: bare };
    if (m[2] === '%') return fontPx ? { kind: 'num', n: (n / 100) * fontPx, unit: 'px' } : { kind: 'num', n: n / 100, unit: '' };
    const u = UNITS[m[2]]!;
    return { kind: 'num', n: n * u[1], unit: u[0] };
  }
  return undefined;
}

const WEIGHTS: Record<string, number> = {
  thin: 100, hairline: 100, 'extra-light': 200, 'ultra-light': 200, extralight: 200, light: 300, normal: 400, regular: 400, book: 400,
  medium: 500, 'semi-bold': 600, 'demi-bold': 600, semibold: 600, bold: 700, 'extra-bold': 800, 'ultra-bold': 800, extrabold: 800,
  black: 900, heavy: 900, 'extra-black': 950, 'ultra-black': 950,
};

function weight(v: unknown): Meaning | undefined {
  if (typeof v === 'number') return { kind: 'num', n: v, unit: '' };
  if (typeof v === 'string') {
    const k = v.trim().toLowerCase().replace(/\s+/g, '-');
    if (WEIGHTS[k] !== undefined) return { kind: 'num', n: WEIGHTS[k]!, unit: '' };
    if (/^\d+$/.test(k)) return { kind: 'num', n: Number(k), unit: '' };
  }
  return undefined;
}

function family(v: unknown): Meaning | undefined {
  const names = typeof v === 'string' ? v.split(',') : Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;
  if (!names) return undefined;
  return { kind: 'list', items: names.map((x) => ({ kind: 'raw', json: JSON.stringify(x.trim().replace(/^['"]|['"]$/g, '')) })) };
}

/** A line height as a multiplier of the font size. */
function lineHeight(v: unknown, fontPx?: number): Meaning | undefined {
  const m = measure(v, undefined);
  if (!m || m.kind !== 'num') return undefined;
  if (m.unit === 'px') return fontPx ? { kind: 'num', n: m.n / fontPx, unit: '' } : m;
  return m;
}

function shadowOne(v: unknown): Meaning | undefined {
  if (!isObj(v)) return undefined;
  const pick = (...ks: string[]) => ks.map((k) => v[k]).find((x) => x !== undefined);
  const type = typeof v.type === 'string' ? v.type : undefined;
  const entries: Record<string, Meaning | undefined> = {
    color: color(v.color) ?? { kind: 'raw', json: JSON.stringify(v.color) },
    offsetX: measure(pick('offsetX', 'x') ?? 0, undefined, 'px'),
    offsetY: measure(pick('offsetY', 'y') ?? 0, undefined, 'px'),
    blur: measure(v.blur ?? 0, undefined, 'px'),
    spread: measure(v.spread ?? 0, undefined, 'px'),
    inset: { kind: 'raw', json: String(v.inset === true || type === 'innerShadow') },
  };
  if (Object.values(entries).some((x) => !x)) return undefined;
  return { kind: 'map', entries: entries as Record<string, Meaning> };
}

/** The meaning of a resolved value of `type`; anything it doesn't understand is compared as written. */
export function meaning(type: string | undefined, v: unknown): Meaning {
  const raw: Meaning = { kind: 'raw', json: JSON.stringify(v) };
  switch (type) {
    case 'color':
      return color(v) ?? raw;
    case 'dimension':
      return measure(v, undefined, 'px') ?? raw;
    case 'duration':
      return measure(v, undefined, 'ms') ?? raw;
    case 'number':
      return measure(v) ?? raw;
    case 'cubicBezier': {
      const nums = typeof v === 'string' ? /^cubic-bezier\(([^)]*)\)$/.exec(v.trim())?.[1]?.split(',').map(Number) : Array.isArray(v) ? v.map(Number) : undefined;
      return nums && nums.length === 4 && nums.every(Number.isFinite) ? { kind: 'list', items: nums.map((n) => ({ kind: 'num', n, unit: '' })) } : raw;
    }
    case 'fontWeight':
      return weight(v) ?? raw;
    case 'fontFamily':
      return family(v) ?? raw;
    case 'shadow': {
      const list = Array.isArray(v) ? v : [v];
      const items = list.map(shadowOne);
      return items.every(Boolean) ? { kind: 'list', items: items as Meaning[] } : raw;
    }
    case 'typography': {
      if (!isObj(v)) return raw;
      const size = measure(v.fontSize, undefined, 'px');
      const px = size?.kind === 'num' && size.unit === 'px' ? size.n : undefined;
      const entries: Record<string, Meaning> = {};
      for (const [k, x] of Object.entries(v)) {
        const m =
          k === 'fontFamily' ? family(x) : k === 'fontWeight' ? weight(x) : k === 'fontSize' ? size : k === 'lineHeight' ? lineHeight(x, px) : k === 'letterSpacing' ? measure(x, px, 'px') : undefined;
        entries[k] = m ?? { kind: 'raw', json: JSON.stringify(x) };
      }
      return { kind: 'map', entries };
    }
    default:
      return raw;
  }
}

/** Whether two meanings are the same, within rounding: ΔE OK under 0.002, numbers within 0.1%. */
export function same(a: Meaning, b: Meaning): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'color': {
      const o = b as typeof a;
      const d = Math.hypot(a.oklab[0] - o.oklab[0], a.oklab[1] - o.oklab[1], a.oklab[2] - o.oklab[2]);
      return d < 0.002 && Math.abs(a.alpha - o.alpha) < 0.005;
    }
    case 'num': {
      const o = b as typeof a;
      return a.unit === o.unit && Math.abs(a.n - o.n) <= Math.max(1e-6, Math.abs(a.n) * 1e-3);
    }
    case 'list': {
      const o = b as typeof a;
      return a.items.length === o.items.length && a.items.every((x, i) => same(x, o.items[i]!));
    }
    case 'map': {
      const o = b as typeof a;
      const keys = new Set([...Object.keys(a.entries), ...Object.keys(o.entries)]);
      return [...keys].every((k) => a.entries[k] && o.entries[k] && same(a.entries[k]!, o.entries[k]!));
    }
    case 'raw':
      return a.json === (b as typeof a).json;
  }
}

/** Short text for a meaning, for failure messages. */
export function show(m: Meaning): string {
  switch (m.kind) {
    case 'color':
      return `oklab(${m.oklab.map((x) => x.toFixed(4)).join(' ')}${m.alpha < 1 ? ` / ${m.alpha}` : ''})`;
    case 'num':
      return `${m.n}${m.unit}`;
    case 'list':
      return `[${m.items.map(show).join(', ')}]`;
    case 'map':
      return `{${Object.entries(m.entries).map(([k, v]) => `${k}: ${show(v)}`).join(', ')}}`;
    case 'raw':
      return m.json.length > 80 ? `${m.json.slice(0, 77)}…` : m.json;
  }
}
