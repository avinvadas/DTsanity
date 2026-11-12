import { detectPalettes, type PaletteSet } from '../palette/detect';
import { withPolicy } from '../policy/rules';
import type { AppState } from './app';

let cache: { model: AppState['model']; overrides: AppState['paletteOverrides']; gamut: AppState['settings']['gamut']; policy: AppState['settings']['policy']; result: PaletteSet } | undefined;

/** Palettes for the current state, recomputed only when the model, overrides, gamut or policy change. Scale flags take the policy's levels. */
export function palettesOf(s: AppState): PaletteSet {
  const { gamut, policy } = s.settings;
  if (cache && cache.model === s.model && cache.overrides === s.paletteOverrides && cache.gamut === gamut && cache.policy === policy) return cache.result;
  const found = detectPalettes(s.model, s.paletteOverrides, gamut);
  const result = { ...found, palettes: found.palettes.map((p) => ({ ...p, flags: withPolicy(p.flags, policy, (f) => `scale-${f.kind}`) })) };
  cache = { model: s.model, overrides: s.paletteOverrides, gamut, policy, result };
  return result;
}
