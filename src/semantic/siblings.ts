import { simulate, VISIONS, type Vision } from '../color/cvd';
import { distance, type ColorInfo } from '../color/format';
import type { Model } from '../model/types';
import { hasRole, tokenColor, words } from './pairs';

/**
 * Sibling groups: semantic colors that must be told apart, such as the
 * danger, warning and success variants of the same role. They are found by
 * name: tokens whose names differ only in a status word. Each group is
 * checked under every vision type: its two closest members must differ by
 * at least the chosen OKLab distance.
 */

const STATUS = new Set([
  'danger', 'error', 'critical', 'negative', 'destructive',
  'warning', 'caution', 'attention',
  'success', 'positive', 'valid',
  'info', 'informative', 'notice', 'discovery',
]);

export interface SiblingGroup {
  /** The shared name with the status word left out, e.g. "color.text.*". */
  id: string;
  /** Member token ids, in source order. */
  members: string[];
}

/** Groups of two or more color tokens that differ only in a status word. Palette steps are left out. */
export function detectSiblings(ids: readonly string[]): SiblingGroup[] {
  const groups = new Map<string, { members: string[]; statuses: Set<string> }>();
  for (const id of ids) {
    const ws = words(id);
    const at = ws.findIndex((w) => STATUS.has(w));
    if (at < 0 || !hasRole(ws)) continue;
    const frame = ws.map((w, i) => (i === at ? '*' : w)).join('.');
    const g = groups.get(frame) ?? { members: [], statuses: new Set() };
    g.members.push(id);
    g.statuses.add(ws[at]!);
    groups.set(frame, g);
  }
  return [...groups].filter(([, g]) => g.statuses.size >= 2).map(([id, g]) => ({ id, members: g.members }));
}

export interface SiblingResult {
  vision: Vision;
  /** The two closest members and their distance as seen with this vision. */
  closest: [string, string];
  distance: number;
  pass: boolean;
}

export interface SiblingCheck {
  /** Members present in this theme, with their colors. */
  colors: { id: string; info: ColorInfo }[];
  results: SiblingResult[];
}

/** Check a group in one model (theme). Undefined when fewer than two members are colors there. */
export function checkSiblings(group: SiblingGroup, model: Model, minDistance: number): SiblingCheck | undefined {
  const colors = group.members.flatMap((id) => {
    const info = tokenColor(model.tokens.get(id));
    return info ? [{ id, info }] : [];
  });
  if (colors.length < 2) return undefined;
  const results = VISIONS.map(({ id: vision }) => {
    let best: SiblingResult | undefined;
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const d = distance(simulate(colors[i]!.info, vision), simulate(colors[j]!.info, vision));
        if (!best || d < best.distance) best = { vision, closest: [colors[i]!.id, colors[j]!.id], distance: d, pass: d >= minDistance };
      }
    }
    return best!;
  });
  return { colors, results };
}
