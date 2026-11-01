import { to } from 'colorjs.io/fn';
import { infoFrom, mapped, type ColorInfo } from './format';

/**
 * Color-vision deficiency simulation. Color.js has none, so it lives here.
 *
 * Protanopia, deuteranopia and tritanopia use the Machado, Oliveira &
 * Fernandes (2009) matrices at full severity (dichromacy): the strongest
 * form, so a pair told apart here is told apart by milder forms too.
 * Achromatopsia keeps only relative luminance. Both run in linear sRGB on
 * the colors a screen shows (gamut-mapped to sRGB first).
 */

export type Vision = 'normal' | 'protan' | 'deutan' | 'tritan' | 'achroma';

export const VISIONS: { id: Vision; label: string; short: string }[] = [
  { id: 'normal', label: 'No deficiency', short: 'Typical' },
  { id: 'protan', label: 'Protanopia (red-blind)', short: 'Protan' },
  { id: 'deutan', label: 'Deuteranopia (green-blind)', short: 'Deutan' },
  { id: 'tritan', label: 'Tritanopia (blue-blind)', short: 'Tritan' },
  { id: 'achroma', label: 'Achromatopsia (no color)', short: 'Achroma' },
];

type Matrix = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

const MACHADO: Record<'protan' | 'deutan' | 'tritan', Matrix> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const clamp = (x: number) => Math.min(1, Math.max(0, Number.isNaN(x) ? 0 : x));

/** Linear-sRGB channels of a color as a screen shows it. */
function linear(info: ColorInfo): [number, number, number] {
  return to(mapped(info, 'srgb'), 'srgb-linear').coords.map((x) => clamp(Number(x))) as [number, number, number];
}

const cache = new WeakMap<ColorInfo, Partial<Record<Vision, ColorInfo>>>();

/** `info` as seen with `vision`. Alpha is kept, so translucent colors still blend. */
export function simulate(info: ColorInfo, vision: Vision): ColorInfo {
  if (vision === 'normal') return info;
  const seen = cache.get(info) ?? {};
  if (seen[vision]) return seen[vision]!;
  const [r, g, b] = linear(info);
  let out: [number, number, number];
  if (vision === 'achroma') {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out = [y, y, y];
  } else {
    out = MACHADO[vision].map((row) => clamp(row[0] * r + row[1] * g + row[2] * b)) as [number, number, number];
  }
  const lin = to(mapped(info, 'srgb'), 'srgb-linear');
  const result = infoFrom(to({ ...lin, coords: out, alpha: info.oklch.alpha }, 'srgb'));
  seen[vision] = result;
  cache.set(info, seen);
  return result;
}
