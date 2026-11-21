import { DEFAULT_SETTINGS } from '../model/defaults';
import type { Settings } from '../model/types';
import { acceptsLegacy, cleanPolicy, withLegacy } from '../policy/rules';

export { DEFAULT_SETTINGS };

/**
 * Preferences persist in localStorage so they survive reloads. They hold
 * only preferences, never token data. Storage can be unavailable (private
 * windows, file://, blocked site data), so every access is guarded.
 */

const KEY = 'dtsanity:settings:v1';
/** Settings saved before the rename to DTsanity, read when there are none under the new key. */
const OLD_KEY = 'tokens-tester:settings:v1';

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return settingsFrom(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Settings from plain data, as saved in this browser or written in a
 * configuration file (dtsanity.config.json): what it gives, checked;
 * the defaults for the rest. `contrast` may be one target or a list.
 */
export function settingsFrom(raw: unknown): Settings {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Partial<Omit<Settings, 'contrast'>> & { contrast?: unknown };
  if (typeof parsed.contrast === 'string') parsed.contrast = [parsed.contrast];
  // Legacy formats are accepted when the setting says so (as saved before it moved into What to check) or their check is off.
  const policy = cleanPolicy(parsed.policy);
  const acceptLegacy = (typeof parsed.acceptLegacy === 'boolean' ? parsed.acceptLegacy : DEFAULT_SETTINGS.acceptLegacy) || acceptsLegacy(policy);
  return {
    acceptLegacy,
    colorFormat: oneOf(parsed.colorFormat, ['oklch', 'hex', 'rgb'] as const, DEFAULT_SETTINGS.colorFormat),
    gamut: oneOf(parsed.gamut, ['srgb', 'p3'] as const, DEFAULT_SETTINGS.gamut),
    // One target at a time; preferences saved when several could be on keep the first of them.
    // WCAG AA and AAA were separate targets once; both are now the one WCAG 2.2 target.
    contrast: [oneOf(Array.isArray(parsed.contrast) ? String(parsed.contrast[0]).replace(/^wcag-aa?a$/, 'wcag') : undefined, ['wcag', 'apca'] as const, DEFAULT_SETTINGS.contrast[0]!)],
    cvdDistance:
      typeof parsed.cvdDistance === 'number' && parsed.cvdDistance > 0 && parsed.cvdDistance <= 1 ? parsed.cvdDistance : DEFAULT_SETTINGS.cvdDistance,
    policy: withLegacy(policy, acceptLegacy),
  };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
