import type { Fix, Issue } from '../model/types';
import type { AppState } from '../state/app';
import { pairsOf, siblingFails, type PairRow, type SiblingRow } from '../state/pairs';
import { mergeModels } from '../themes/merge';
import { severest } from '../policy/rules';
import type { Severity } from '../model/types';
import { h, icon, plural, severityIcon } from './dom';

/**
 * The four kinds of findings (format, tiers, contrast, color blindness) and
 * the cards that sum them up: on top of the phone layout and of the desktop
 * Issues view, each card a link to where its findings are listed.
 */

export type FindingKind = 'format' | 'tiers' | 'contrast' | 'vision';

const isTier = (i: Issue) => i.code.startsWith('tier-');

/** Issues across every theme, as the fix prompt sees them. */
export const issuesOf = (s: AppState): Issue[] => (s.themeModels.length ? mergeModels(s.themeModels) : s.model).issues;

export interface Findings {
  format: Issue[];
  tiers: Issue[];
  fixable: Fix[];
  contrast: PairRow[];
  vision: PairRow[];
  groups: SiblingRow[];
}

export function findings(s: AppState): Findings {
  const issues = issuesOf(s).filter((i) => i.severity !== 'info');
  const pairs = pairsOf(s);
  return {
    format: issues.filter((i) => !isTier(i)),
    tiers: issues.filter(isTier),
    fixable: issues.filter((i) => i.fix && 'edits' in i.fix).map((i) => i.fix!),
    // Info-level findings are suggestions: listed where they are, not counted here.
    contrast: pairs.rows.filter((r) => !r.pass && r.tone !== 'info'),
    vision: pairs.rows.filter((r) => r.cvdFails.length && r.cvdTone !== 'info'),
    groups: pairs.siblings.filter((g) => siblingFails(g) && g.tone !== 'info'),
  };
}

/** The severity each kind of finding shows at: the severest of its findings, by the policy. */
export function findingTones(f: Findings): Record<FindingKind, Severity | undefined> {
  return {
    format: severest(f.format.map((i) => i.severity)),
    tiers: severest(f.tiers.map((i) => i.severity)),
    contrast: severest(f.contrast.map((r) => r.tone)),
    vision: severest([...f.vision.map((r) => r.cvdTone), ...f.groups.map((g) => g.tone)]),
  };
}

/** Every finding the cards count, as the Issues label and title say it. */
export const findingTotal = (f: Findings) => f.format.length + f.tiers.length + f.contrast.length + f.vision.length + f.groups.length;

/** Every file was read and nothing is left to fix: the fix prompt has nothing to say. */
export const allClear = (s: AppState) => s.files.length > 0 && s.loadErrors.length === 0 && findingTotal(findings(s)) === 0;


/** "N issues found:" over a card per kind; `go` takes the reader to that kind's findings, `href` names it for the link. */
export function findingCards(f: Findings, go: (kind: FindingKind) => void, href: (kind: FindingKind) => string) {
  const vision = f.vision.length + f.groups.length;
  const tone = findingTones(f);
  const kinds: [FindingKind, string, number, Severity][] = [
    ['format', 'Format', f.format.length, tone.format ?? 'warning'],
    ['tiers', 'Tiers', f.tiers.length, tone.tiers ?? 'warning'],
    ['contrast', 'Contrast', f.contrast.length, tone.contrast ?? 'warning'],
    ['vision', 'Color blindness', vision, tone.vision ?? 'warning'],
  ];
  const total = findingTotal(f);
  const card = ([kind, title, n, tone]: (typeof kinds)[number]) =>
    h(
      'a',
      { class: `finding-card${n ? ` ${tone}` : ' ok'}`, href: href(kind), onclick: (e: Event) => (e.preventDefault(), go(kind)) },
      h('span', { class: 'finding-card-head' }, n ? severityIcon(tone) : h('span', { class: 'finding-ok' }, icon('check')), title),
      h('span', { class: 'finding-card-n' }, n ? String(n) : 'OK'),
    );
  return h(
    'section',
    { class: 'findings' },
    // A clean set is rewarded right here: green, led by the same check as the cards.
    total
      ? h('h2', { class: 'findings-title' }, `${plural(total, 'issue')} found:`)
      : h('h2', { class: 'findings-title all-clear' }, h('span', { class: 'finding-ok', 'aria-hidden': 'true' }, icon('check')), 'No issues found'),
    h('nav', { class: 'finding-cards', 'aria-label': 'Findings' }, kinds.map(card)),
  );
}
