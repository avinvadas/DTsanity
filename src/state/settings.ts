import { DEFAULT_SETTINGS } from '../model/defaults';
import type { Settings } from '../model/types';

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
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      acceptLegacy: typeof parsed.acceptLegacy === 'boolean' ? parsed.acceptLegacy : DEFAULT_SETTINGS.acceptLegacy,
      colorFormat: oneOf(parsed.colorFormat, ['oklch', 'hex', 'rgb'] as const, DEFAULT_SETTINGS.colorFormat),
      gamut: oneOf(parsed.gamut, ['srgb', 'p3'] as const, DEFAULT_SETTINGS.gamut),
      // One target at a time; preferences saved when several could be on keep the first of them.
      // WCAG AA and AAA were separate targets once; both are now the one WCAG 2.2 target.
      contrast: [oneOf(Array.isArray(parsed.contrast) ? String(parsed.contrast[0]).replace(/^wcag-aa?a$/, 'wcag') : undefined, ['wcag', 'apca'] as const, DEFAULT_SETTINGS.contrast[0]!)],
      cvdDistance:
        typeof parsed.cvdDistance === 'number' && parsed.cvdDistance > 0 && parsed.cvdDistance <= 1 ? parsed.cvdDistance : DEFAULT_SETTINGS.cvdDistance,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
