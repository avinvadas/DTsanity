import { describe, expect, it } from 'vitest';
import { simulate } from '../src/color/cvd';
import { colorInfo, distance } from '../src/color/format';

const srgb = (r: number, g: number, b: number, alpha?: number) => colorInfo({ colorSpace: 'srgb', components: [r, g, b], ...(alpha !== undefined ? { alpha } : {}) })!;

describe('CVD simulation', () => {
  it('leaves typical vision unchanged', () => {
    const red = srgb(1, 0, 0);
    expect(simulate(red, 'normal')).toBe(red);
  });

  it('keeps white and black for every deficiency', () => {
    for (const v of ['protan', 'deutan', 'tritan', 'achroma'] as const) {
      expect(distance(simulate(srgb(1, 1, 1), v), srgb(1, 1, 1))).toBeLessThan(0.01);
      expect(distance(simulate(srgb(0, 0, 0), v), srgb(0, 0, 0))).toBeLessThan(0.01);
    }
  });

  it('makes red and green hard to tell apart for protan and deutan, not for tritan', () => {
    const red = srgb(0.86, 0.15, 0.15);
    const green = srgb(0.2, 0.6, 0.2);
    const typical = distance(red, green);
    expect(distance(simulate(red, 'deutan'), simulate(green, 'deutan'))).toBeLessThan(typical / 4);
    // Protan also darkens red, so some lightness difference remains.
    expect(distance(simulate(red, 'protan'), simulate(green, 'protan'))).toBeLessThan(typical * 0.6);
    expect(distance(simulate(red, 'tritan'), simulate(green, 'tritan'))).toBeGreaterThan(typical * 0.8);
  });

  it('reduces achromatopsia to a gray of the same luminance', () => {
    const seen = simulate(srgb(1, 0, 0), 'achroma');
    expect(seen.oklch.c).toBeLessThan(0.001);
    // Relative luminance of pure red is 0.2126; OKLab L is its cube root.
    expect(seen.oklch.l).toBeCloseTo(Math.cbrt(0.2126), 2);
  });

  it('keeps alpha', () => {
    expect(simulate(srgb(1, 0, 0, 0.5), 'deutan').oklch.alpha).toBe(0.5);
  });
});
