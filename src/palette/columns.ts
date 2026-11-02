import type { Palette } from './detect';
import { orderSteps, type OrderKind } from './order';

/**
 * Shared step columns for the palette grid. Palettes on the same step scheme
 * (e.g. 50–950) form one group whose columns are the union of their steps,
 * so every palette in the group lines up and a step it lacks shows as a gap.
 */

export interface StepGroup {
  columns: string[];
  palettes: Palette[];
  /**
   * Palettes placed here by lightness rather than by step name (`accent.light`
   * under 200): palette id → its step → the column it sits in.
   */
  placed?: Map<string, Map<string, string>>;
}

/** The column a palette's step sits in: its own name, unless it was placed by lightness. */
export const columnOf = (g: StepGroup, paletteId: string, step: string) => g.placed?.get(paletteId)?.get(step) ?? step;

export function stepGroups(palettes: readonly Palette[]): StepGroup[] {
  const groups: { kind: OrderKind; steps: string[]; palettes: Palette[] }[] = [];
  for (const p of palettes) {
    const own = p.swatches.map((s) => s.step);
    const g = groups.find((x) => x.kind === p.order && shared(own, x.steps) >= Math.ceil(Math.min(own.length, x.steps.length) / 2));
    if (g) {
      g.palettes.push(p);
      for (const s of own) if (!g.steps.includes(s)) g.steps.push(s);
    } else {
      groups.push({ kind: p.order, steps: [...own], palettes: [p] });
    }
  }
  // File-ordered steps have no scale to sort by, so they keep first-seen order.
  const out: StepGroup[] = groups.map((g) => ({ columns: g.kind === 'file' ? g.steps : orderSteps(g.steps, (s) => s).items, palettes: g.palettes }));
  return byLightness(out, groups.map((g) => g.kind));
}

/** How far (OKLCH L, 0–1) a step may sit from its column's typical lightness. */
const MAX_OFF = 0.1;

/**
 * Palettes with named steps (light, base, dark) have no column of their own in a
 * numbered grid. Each is placed in the numbered grid with the most palettes,
 * its steps in order under the columns whose typical lightness (the median
 * across that grid) is closest. One that doesn't fit within MAX_OFF keeps its own grid.
 */
function byLightness(groups: StepGroup[], kinds: OrderKind[]): StepGroup[] {
  const numeric = groups.filter((_, i) => kinds[i] === 'numeric').sort((a, b) => b.palettes.length - a.palettes.length)[0];
  if (!numeric) return groups;
  const profile = numeric.columns
    .map((c) => ({ c, l: median(numeric.palettes.flatMap((p) => p.swatches.filter((s) => s.step === c && s.info).map((s) => s.info.oklch.l))) }))
    .filter((x): x is { c: string; l: number } => x.l !== undefined);
  const placed = new Map<string, Map<string, string>>();
  const kept: StepGroup[] = [];
  groups.forEach((g, i) => {
    if (kinds[i] === 'numeric') return kept.push(g);
    const stay = g.palettes.filter((p) => {
      const at = place(p, profile);
      if (!at) return true;
      placed.set(p.id, at);
      numeric.palettes.push(p);
      return false;
    });
    if (stay.length) kept.push({ ...g, palettes: stay, columns: g.columns.filter((c) => stay.some((p) => p.swatches.some((s) => s.step === c))) });
  });
  if (placed.size) numeric.placed = placed;
  return kept;
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Steps of `p`, in their order, matched to distinct columns in order (either
 * direction) with the least total lightness difference. Undefined when any
 * step would sit more than MAX_OFF from its column.
 */
function place(p: Palette, profile: { c: string; l: number }[]): Map<string, string> | undefined {
  const ls = p.swatches.map((s) => s.info?.oklch.l);
  if (ls.some((l) => l === undefined) || ls.length > profile.length || !ls.length) return undefined;
  let best: { cost: number; cols: number[] } | undefined;
  for (const cols of [profile, [...profile].reverse()]) {
    const n = ls.length, m = cols.length;
    // cost[i][j]: the first i steps in the first j columns.
    const cost = Array.from({ length: n + 1 }, (_, i) => Array<number>(m + 1).fill(i ? Infinity : 0));
    for (let i = 1; i <= n; i++)
      for (let j = i; j <= m; j++) cost[i]![j] = Math.min(cost[i]![j - 1]!, cost[i - 1]![j - 1]! + Math.abs(ls[i - 1]! - cols[j - 1]!.l));
    if (!(cost[n]![m]! < (best?.cost ?? Infinity))) continue;
    const pick: number[] = [];
    for (let i = n, j = m; i > 0; j--) if (cost[i]![j] !== cost[i]![j - 1]) pick.unshift(j - 1), i--;
    best = { cost: cost[n]![m]!, cols: pick.map((k) => profile.indexOf(cols[k]!)) };
  }
  if (!best) return undefined;
  const at = new Map<string, string>();
  for (const [i, k] of best.cols.entries()) {
    if (Math.abs(ls[i]! - profile[k]!.l) > MAX_OFF) return undefined;
    at.set(p.swatches[i]!.step, profile[k]!.c);
  }
  return at;
}

const shared = (a: string[], b: string[]) => a.filter((s) => b.includes(s)).length;

export interface Stack extends StepGroup {
  /** Every palette shown in this grid, in file order: the group's own, plus hidden palettes that belong here. */
  members: Palette[];
}

/**
 * Grids for the whole palette list. Columns come from the shown palettes only;
 * a hidden palette keeps its place in the stack, in the grid whose steps it
 * matches, or else after the palette that precedes it in the file. `orphans`
 * are hidden palettes when no palette is shown at all.
 */
export function stacks(all: readonly Palette[]): { stacks: Stack[]; orphans: Palette[] } {
  const groups = stepGroups(all.filter((p) => p.included));
  const home = new Map<Palette, StepGroup>();
  for (const g of groups) for (const p of g.palettes) home.set(p, g);
  const members = new Map(groups.map((g) => [g, [] as Palette[]]));
  const orphans: Palette[] = [];
  let last = groups[0];
  for (const p of all) {
    const own = p.swatches.map((s) => s.step);
    const g =
      home.get(p) ??
      groups.find((x) => x.palettes[0]!.order === p.order && shared(own, x.columns) >= Math.ceil(own.length / 2)) ??
      last;
    if (!g) {
      orphans.push(p);
      continue;
    }
    members.get(g)!.push(p);
    if (home.has(p)) last = g;
  }
  return { stacks: groups.map((g) => ({ ...g, members: members.get(g)! })), orphans };
}
