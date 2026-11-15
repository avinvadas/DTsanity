/**
 * Per-mode values stored in `$extensions`. Two shapes are recognized:
 *  - `"$extensions": { "mode": { "light": …, "dark": … } }` (Terrazzo / Cobalt UI);
 *  - `"$extensions": { "<any.vendor>": { "modes": { "light": …, "dark": … } } }`.
 * Each mode name becomes a theme; in it, the token's value is the mode's value.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface ModeValues {
  values: Record<string, unknown>;
  /** Where the mode map sits inside the token object, e.g. ["$extensions", "mode"]. */
  path: string[];
}

export function modeValues(ext: Record<string, unknown> | undefined): ModeValues | undefined {
  if (!ext) return undefined;
  if (isObj(ext.mode)) return { values: ext.mode, path: ['$extensions', 'mode'] };
  for (const [k, v] of Object.entries(ext)) if (isObj(v) && isObj(v.modes)) return { values: v.modes, path: ['$extensions', k, 'modes'] };
  // A vendor key that is itself the map: `"org.primer.overrides": { "dark": …, "dark-high-contrast": … }`.
  for (const [k, v] of Object.entries(ext)) if (/\.(modes|overrides)$/.test(k) && isObj(v)) return { values: v, path: ['$extensions', k] };
  return undefined;
}

/**
 * The value a mode gives, and where it sits under the mode's key: the entry
 * itself, or its `$value` when the entry is written as a token
 * (`{ "$value": "{base.color.blue.1}", "alpha": 0.4 }`). Undefined when an
 * entry written so has no `$value` (`{ "alpha": 0.2 }`): it changes only the
 * alpha (see `modeAlpha`), and the token keeps its value.
 */
export function modeValue(entry: unknown): { value: unknown; path: string[] } | undefined {
  if (isObj(entry) && '$value' in entry) return { value: entry.$value, path: ['$value'] };
  if (isAlphaOnly(entry)) return undefined;
  return { value: entry, path: [] };
}

const isAlphaOnly = (entry: unknown): entry is Record<string, unknown> => isObj(entry) && Object.keys(entry).every((k) => k === 'alpha' || k.startsWith('$'));

/**
 * The alpha a mode entry written as a token gives the color it resolves to
 * (Primer's `{ "$value": "{base.color.blue.1}", "alpha": 0.4 }`, or `{ "alpha": 0.2 }`
 * on the token's own value). It replaces that color's alpha, as Primer's build does;
 * `alpha: 1` leaves it, as Primer's CSS does (`overlay.borderColor` in dark is
 * `{ $value: '{borderColor.muted}', alpha: 1 }`, published as `var(--borderColor-muted)` at 0.7).
 * Undefined for an entry that is the value itself: a color's own `alpha` is part of it.
 */
export function modeAlpha(entry: unknown): number | undefined {
  if (!isObj(entry) || typeof entry.alpha !== 'number' || entry.alpha === 1) return undefined;
  return '$value' in entry || isAlphaOnly(entry) ? entry.alpha : undefined;
}

/** Words that name a mode or theme. */
export const MODE_KEY = /^(default|base|light|dark|darkest|day|night|dim|dimmed|high-?contrast|hc[bw]?|contrast|wireframe)$/i;

/**
 * Per-mode values written in the token itself, in formats of their own
 * (read only when legacy formats are accepted):
 *  - `"$value": { "light": …, "dark": … }` (Cloudscape, GitLab);
 *  - `"sets": { "light": { "$value": … }, "dark": { "$value": … } }` (Spectrum).
 * A map counts only when every key names a mode, so neither a composite
 * value (`{ "colorSpace", "components" }`) nor a map of states
 * (`{ "default", "disabled" }`) or densities is read as one.
 */
export function ownModes(token: Record<string, unknown>): ModeValues | undefined {
  const v = token.$value;
  if (isObj(v) && isModeMap(v)) return { values: v, path: ['$value'] };
  const sets = token.sets;
  if (!('$value' in token) && isObj(sets) && isModeMap(sets) && Object.values(sets).every((e) => isObj(e) && '$value' in e)) return { values: sets, path: ['sets'] };
  return undefined;
}

const isModeMap = (v: Record<string, unknown>) => {
  const keys = Object.keys(v);
  return keys.length >= 2 && keys.every((k) => MODE_KEY.test(k));
};

/** A token object that holds its values per mode in `sets`, with no `$value` of its own (Spectrum). */
export const isSetsToken = (token: Record<string, unknown>) => ownModes(token)?.path[0] === 'sets';

/**
 * A built token's per-mode values: in `$extensions`, or (legacy formats
 * accepted) written in the token itself. Outside a mode theme, such a
 * token's `rawValue` is the map itself and `valuePath` says where it sits.
 */
export function tokenModes(t: { extensions?: Record<string, unknown>; rawValue: unknown; valuePath: string[] }, legacy: boolean): ModeValues | undefined {
  const ext = modeValues(t.extensions);
  if (ext || !legacy) return ext;
  const v = t.rawValue;
  if (t.valuePath.length === 1 && isObj(v) && isModeMap(v)) return { values: v, path: t.valuePath };
  return undefined;
}
