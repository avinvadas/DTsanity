import { VISIONS } from '../color/cvd';
import { formatContrast } from '../contrast/metrics';
import { RULE_TITLE } from '../model/rules';
import type { Category, Fix, Issue, Severity } from '../model/types';
import { noFixNote, remedyOf } from '../policy/rules';
import { store, type AppState } from '../state/app';
import { applyWithToast } from './toasts';
import type { PairRow, SiblingRow } from '../state/pairs';
import { collapsible, expand, setAll } from './collapsible';
import { h, icon, masked, plural, severityIcon, viewHead, type Child } from './dom';
import { issuesScope, pairsScope, promptButton } from './prompt-link';
import { findingCards, findings, findingTotal, fixableText, issuesOf, type FindingKind, type Findings } from './findings';
import { issueData, issueDetail, issueHead } from './issue';
import { viewControls } from './loader';
import { CATEGORY_LABEL } from './blocked';
import { goTo } from './nav';
import { CATEGORY_TIP, SEVERITY_TIP, TIP } from './tips';

const isTier = (i: Issue) => i.code.startsWith('tier-');
/** Where each pair tier's findings are worked on. */
const TIER_VIEW = { semantic: { view: 'semantic', label: 'Semantic tier' }, component: { view: 'components', label: 'Component tier' } } as const;

const SEVERITIES: Severity[] = ['error', 'warning', 'info'];
const SEVERITY_LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };
/** The most severe of some tones; undefined for none. */
const worstOf = (tones: readonly (Severity | undefined)[]): Severity | undefined => SEVERITIES.find((s) => tones.includes(s));
/** A section's worst severity, shown while it is closed (the list says it once open). */
const sevMark = (sev: Severity) => h('span', { class: `sev group-sev ${sev}`, role: 'img', 'aria-label': `Worst: ${SEVERITY_LABEL[sev]}`, 'data-tip': SEVERITY_TIP[sev] }, severityIcon(sev));
/** The most severe of some issues. */
const worst = (issues: readonly Issue[]): Severity => SEVERITIES.find((s) => issues.some((i) => i.severity === s)) ?? 'info';
const CATEGORIES: Category[] = ['format', 'structure', 'references', 'types', 'values', 'metadata'];


export class TTIssues extends HTMLElement {
  private unsubs: (() => void)[] = [];
  private reload = viewControls();

  connectedCallback() {
    this.unsubs.push(
      store.select(
        (s) => s,
        (v) => this.render(v),
        // The finding cards also count contrast and color blindness, which follow the settings and re-aliased pairs.
        (a, b) => a.model === b.model && a.themeModels === b.themeModels && a.activeTheme === b.activeTheme && a.settings === b.settings && a.pairEdits === b.pairEdits,
      ),
      this.reload.unsub,
    );
  }

  disconnectedCallback() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  private apply(fixes: Fix[], label?: string) {
    applyWithToast(fixes, label);
  }

  /** The page has one section per card, in the cards' order, named and counted as they are; each card opens its own and scrolls to it. Info notes follow, uncounted. */
  private go(kind: FindingKind) {
    const target = this.querySelector<HTMLDetailsElement>(`#issues-${kind}`);
    if (!target) return;
    expand(target);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (target.querySelector('h3') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /**
   * A section of this page, collapsible like the tier views' sections: its
   * heading (with a count, its worst severity while closed, and any
   * actions), then its list, or a line saying it passes. Closed until
   * opened (by its heading or its card), except Format, which starts open.
   */
  private group(id: string, title: string, tip: string | undefined, n: number, actions: (Node | null)[], list: HTMLElement | null, clear: string, sev?: Severity, open = false) {
    return collapsible({
      key: `issues:${id}`,
      open,
      variant: 'row',
      class: 'issue-group',
      attrs: { id },
      summary: [
        h('h3', { tabindex: '-1', 'data-tip': tip }, title, n ? h('span', { class: 'n', 'data-tip': TIP.groupCount }, String(n)) : null, sev && n ? sevMark(sev) : null),
        h('span', { class: 'group-actions' }, actions),
      ],
      content: list ?? h('p', { class: 'empty' }, clear),
    });
  }

  /** A category inside Format, collapsed until opened: its summary carries the worst severity, the count and any fixes. */
  private subgroup(id: string, title: Child, actions: Node | null, list: Child | (() => Child)) {
    return collapsible({ key: `issues:${id}`, open: false, class: 'issue-subgroup', attrs: { id }, summary: [title, h('span', { class: 'group-actions' }, actions)], content: list });
  }

  /**
   * A category's issues, one collapsed line per check: its worst severity, its
   * name, how many, and its fixes when it has any. Opening a line shows its list.
   */
  private byRule(category: string, issues: Issue[], where: (i: Issue) => string, fixAll: (fixes: Fix[], what: string) => Node | null) {
    const rules = new Map<string, Issue[]>();
    for (const i of issues) rules.set(i.code, [...(rules.get(i.code) ?? []), i]);
    return h(
      'div',
      { class: 'issue-rules' },
      [...rules].map(([code, list]) => {
        const sev = worst(list);
        const fixes = list.map((i) => i.fix).filter((x): x is Fix => !!x);
        return collapsible({
          key: `issues:${category}:${code}`,
          open: false,
          class: 'issue-rule',
          summary: [
            h('span', { class: `sev ${sev}`, role: 'img', 'aria-label': SEVERITY_LABEL[sev], 'data-tip': SEVERITY_TIP[sev] }, severityIcon(sev)),
            h('span', { class: 'rule-title' }, RULE_TITLE[code] ?? code),
            h('span', { class: 'n', 'data-tip': TIP.groupCount }, String(list.length)),
            h('span', { class: 'group-actions' }, fixes.length === 1 ? this.fixOne(fixes[0]!) : fixAll(fixes, (RULE_TITLE[code] ?? code).toLowerCase())),
          ],
          // Format problems that repeat are said once with every place; a reference problem stays one per token, as each needs its own fix.
          content: () => this.clusters(list, where, false, category !== 'references'),
        });
      }),
    );
  }

  /** One fix, as a button on a check's line. */
  private fixOne(fix: Fix) {
    return h('button', { type: 'button', class: 'small fix-all', 'data-tip': TIP.fix, onclick: () => this.apply([fix]) }, 'Apply fix', icon('tool'));
  }

  /** Links to the tier views where these pairs are worked on, one per tier they're in. */
  private tierLinks(tiers: ('semantic' | 'component')[], vision = false) {
    return [...new Set(tiers)].map((t) =>
      h(
        'a',
        {
          class: 'group-link',
          href: `#${TIER_VIEW[t].view}`,
          onclick: (e: Event) => {
            e.preventDefault();
            goTo(TIER_VIEW[t].view);
            if (vision) requestAnimationFrame(() => document.querySelector(`.view[data-view="${TIER_VIEW[t].view}"] .vision`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          },
        },
        `Open in ${TIER_VIEW[t].label} →`,
      ),
    );
  }

  /** Contrast and color blindness: the failing pairs, each in one row, with links to the tier views that edit them. */
  private pairGroups(f: Findings, themes: string[], min: number) {
    const pairWhere = (r: PairRow) => (r.component ? `${TIER_VIEW[r.tier].label} · ${r.component}` : TIER_VIEW[r.tier].label);
    const contrastRow = (r: PairRow) => {
      const misses = r.seen.normal.flatMap((c, i) => (c && !c.pass ? [{ theme: themes[i], miss: c.results.find((x) => !x.pass)! }] : []));
      const sev: Severity = r.tone;
      const detail = misses
        .map(({ theme, miss }) => `${theme ? `${theme}: ` : ''}${formatContrast(miss.value, miss.level.metric)} of ${miss.level.threshold} (${miss.level.short})`)
        .join(' · ');
      return this.pairRow(sev, r.pair.kind === 'text' ? 'Low text contrast' : 'Low UI contrast', r.pair.fg, `On ${r.pair.bg}. ${detail}`, pairWhere(r));
    };
    const visionRow = (r: PairRow) => {
      const names = r.cvdFails.map((v) => VISIONS.find((x) => x.id === v)!.label);
      const where = themes.length ? ` in ${r.cvdFails.flatMap((v) => r.seen[v].map((c, i) => (c && !c.pass ? themes[i] : null))).filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}` : '';
      return this.pairRow(r.cvdTone, 'Fails with color blindness', r.pair.fg, `On ${r.pair.bg}, drops below its level with ${names.join(', ')}${where}.`, pairWhere(r));
    };
    const groupRow = (g: SiblingRow) => {
      const lines = g.checks.flatMap((c, i) => {
        const fails = (c?.results ?? []).filter((x) => !x.pass && x.vision !== 'achroma');
        return fails.length ? [`${themes[i] ? `${themes[i]}: ` : ''}${fails.map((x) => VISIONS.find((v) => v.id === x.vision)!.short).join(', ')}`] : [];
      });
      return this.pairRow(g.tone ?? 'warning', 'Status colors too alike', g.group.id, `${g.group.members.join(', ')} need a difference of ${min}. ${lines.join(' · ')}`, g.component ? `${TIER_VIEW[g.tier].label} · ${g.component}` : TIER_VIEW[g.tier].label);
    };
    const vision = [...f.vision.map(visionRow), ...f.groups.map(groupRow)];
    return [
      this.group(
        'issues-contrast',
        'Contrast',
        undefined,
        f.contrast.length,
        [...this.tierLinks(f.contrast.map((r) => r.tier)), f.contrast.length ? promptButton(pairsScope(f.contrast)) : null],
        f.contrast.length ? h('div', null, h('p', { class: 'group-note' }, noFixNote('contrast-text')), masked(h('ul', { class: 'issue-list' }, f.contrast.map(contrastRow)))) : null,
        'Every pair passes.',
        worstOf(f.contrast.map((r) => r.tone)),
      ),
      this.group(
        'issues-vision',
        'Color blindness',
        undefined,
        vision.length,
        [...this.tierLinks([...f.vision.map((r) => r.tier), ...f.groups.map((g) => g.tier)], true), f.vision.length + f.groups.length ? promptButton(pairsScope(f.vision, f.groups)) : null],
        vision.length ? h('div', null, h('p', { class: 'group-note' }, noFixNote(f.vision.length ? 'cvd-pair' : 'cvd-siblings')), masked(h('ul', { class: 'issue-list' }, vision))) : null,
        'Pairs and status colors stay apart.',
        worstOf([...f.vision.map((r) => r.cvdTone), ...f.groups.map((g) => g.tone ?? 'warning')]),
      ),
    ];
  }

  private pairRow(sev: Severity, title: string, target: string, detail: string, where: string) {
    return h(
      'li',
      { class: `issue ${sev}`, 'data-severity': sev, 'data-target': target },
      h('span', { class: `sev ${sev}`, role: 'img', 'aria-label': SEVERITY_LABEL[sev], 'data-tip': SEVERITY_TIP[sev] }, severityIcon(sev)),
      h('div', { class: 'body' }, h('span', { class: 'issue-head' }, h('strong', { class: 'issue-title' }, title), h('code', { class: 'issue-target' }, target)), h('p', { class: 'issue-detail' }, detail)),
      h('span', { class: 'where' }, where),
    );
  }

  private render(v: AppState) {
    // Every theme's issues, as the cards, the sidebar and the findings report count them; an issue in only some themes is tagged with them.
    const all = issuesOf(v);
    // All loaded files: a theme's model only knows its own, and the all-themes view merges several.
    const names = new Map(store.get().files.map((f) => [f.id, f.name]));
    const count = (s: Severity) => all.filter((i) => i.severity === s).length;
    const where = (i: Issue) => {
      const name = i.fileId ? names.get(i.fileId) : undefined;
      if (!name) return '';
      return i.pos ? `${name}:${i.pos.line}:${i.pos.col}` : name;
    };

    // Format issues by category, as subsections of Format; tier issues get their own section, like the Tiers card.
    const groups = CATEGORIES.map((c) => ({
      category: c,
      issues: all
        .filter((i) => i.category === c && !isTier(i) && i.severity !== 'info')
        .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (a.pos?.offset ?? 0) - (b.pos?.offset ?? 0)),
    })).filter((g) => g.issues.length > 0);
    const formatCount = groups.reduce((n, g) => n + g.issues.length, 0);
    const tierIssues = all.filter((i) => isTier(i) && i.severity !== 'info').sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
    // Notes, not problems: kept apart at the end, so each section above counts what its card counts.
    const infoIssues = all.filter((i) => i.severity === 'info').sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || (a.pos?.offset ?? 0) - (b.pos?.offset ?? 0));
    const f = findings(v);
    const themes = v.themeModels.map((m) => m.theme.name);
    const fixAll = (fixes: Fix[], what: string) =>
      fixes.length > 1
        ? h('button', { type: 'button', class: 'small fix-all', 'data-tip': TIP.fixAll, onclick: () => this.apply(fixes, `Fix ${fixes.length} ${what} issues`) }, `Apply ${fixes.length} fixes`, icon('tool'))
        : null;
    const fixesOf = (issues: Issue[]) => issues.map((i) => i.fix).filter((x): x is Fix => !!x);

    this.replaceChildren(
      // The count is the page's title: “Issues” over “N issues found” said it twice.
      viewHead(findingTotal(f) ? `${plural(findingTotal(f), 'issue')} found` : 'No issues found', {
        // As the tier views lead with their count: what can be fixed here, then the severities, then the report for the rest.
        summary: [
          findingTotal(f) ? h('span', null, fixableText(f.withFix, findingTotal(f)).text) : null,
          ...SEVERITIES.filter(count).map((s) => h('span', { class: `chip ${s}`, 'data-tip': SEVERITY_TIP[s] }, severityIcon(s), plural(count(s), SEVERITY_LABEL[s].toLowerCase()))),
          findingTotal(f) && fixableText(f.withFix, findingTotal(f)).scope ? h('span', { class: 'vh-summary-end' }, promptButton(fixableText(f.withFix, findingTotal(f)).scope)) : null,
        ],
        actions: this.reload.el,
      }),
      findingCards(f, (k) => this.go(k), () => '#issues', true, false, false),
      h(
        'div',
        { class: 'toolbar issue-tools' },
        h('button', { type: 'button', class: 'ghost small', onclick: () => setAll(this, true) }, 'Expand all'),
        h('button', { type: 'button', class: 'ghost small', onclick: () => setAll(this, false) }, 'Collapse all'),
      ),
      h(
        'div',
        { class: 'issue-groups' },
        this.group(
          'issues-format',
          'Format',
          undefined,
          formatCount,
          // Each category applies its own fixes; one button up here would repeat them.
          [],
          groups.length
            ? h(
                'div',
                { class: 'issue-subgroups' },
                groups.map(({ category, issues }) => {
                  const sev = worst(issues);
                  return this.subgroup(
                    // Its own id: the “format” category would otherwise share the Format section's.
                    `issues-cat-${category}`,
                    h(
                      'h5',
                      { 'data-tip': CATEGORY_TIP[category] },
                      CATEGORY_LABEL[category],
                      h('span', { class: 'n', 'data-tip': TIP.groupCount }, String(issues.length)),
                      sevMark(sev),
                    ),
                    fixAll(fixesOf(issues), CATEGORY_LABEL[category].toLowerCase()),
                    () => this.byRule(category, issues, where, fixAll),
                  );
                }),
              )
            : null,
          v.model.files.length ? 'The code follows the DTCG format.' : '',
          formatCount ? worst(groups.flatMap((g) => g.issues)) : undefined,
          // Format starts open, showing its sections, each closed until clicked.
          true,
        ),
        this.group(
          'issues-tiers',
          'Tiers',
          undefined,
          tierIssues.length,
          [fixAll(fixesOf(tierIssues), 'tier')],
          tierIssues.length ? this.clusters(tierIssues, where) : null,
          'Each tier points the right way.',
          tierIssues.length ? worst(tierIssues) : undefined,
        ),
        ...this.pairGroups(f, themes, v.settings.cvdDistance),
        infoIssues.length
          ? this.group(
              'issues-info',
              'Info',
              SEVERITY_TIP.info,
              infoIssues.length,
              [fixAll(fixesOf(infoIssues), 'info')],
              h(
                'div',
                null,
                h('p', { class: 'group-note' }, 'Notes, not issues: they are not counted above, and nothing needs to change.'),
                this.clusters(infoIssues, where, true),
              ),
              '',
              'info',
            )
          : null,
      ),
    );
  }

  /**
   * A list of issues in two clusters: the ones DTsanity fixes in one click,
   * then the ones that need a change from the user (in the file, with a tool
   * here, or through the findings report). A cluster with nothing in it is left out.
   */
  private clusters(issues: Issue[], where: (i: Issue) => string, notes = false, merge = false) {
    const fixable = issues.filter((i) => i.fix);
    const manual = issues.filter((i) => !i.fix);
    // Counted by what they are about: tokens, or issues when some are about a whole file.
    const counted = (items: Issue[], one: string, many: string) => {
      const tokens = items.every((i) => i.target);
      const n = tokens ? new Set(items.map((i) => i.target)).size : items.length;
      return `${plural(n, tokens ? 'token' : 'issue')} ${n === 1 ? one : many}`;
    };
    const cluster = (kind: 'fixable' | 'manual', title: string, tip: string, items: Issue[], action?: Node) =>
      items.length
        ? h(
            'div',
            { class: `fix-cluster ${kind}` },
            h('h6', { class: 'cluster-head', 'data-tip': tip }, kind === 'fixable' ? icon('check') : null, h('span', { class: 'cluster-title' }, title), action ?? null),
            masked(h('ul', { class: 'issue-list' }, merge ? this.merged(items, where) : items.map((i) => this.row(i, where(i))))),
          )
        : null;
    return h(
      'div',
      { class: 'fix-clusters' },
      cluster('fixable', counted(fixable, 'can be fixed here', 'can be fixed here'), TIP.clusterFixable, fixable),
      // Info notes ask for no change, so their second cluster only says DTsanity won't make one.
      notes
        ? cluster('manual', counted(manual, 'has no fix here', 'have no fix here'), TIP.clusterManual, manual, promptButton(issuesScope(manual)))
        : cluster('manual', counted(manual, 'needs your change', 'need your change'), TIP.clusterManual, manual, promptButton(issuesScope(manual))),
    );
  }


  /**
   * Issues with the same message, one entry each set: the message once, then
   * every token and place it applies to, and one button for all their fixes.
   */
  private merged(items: Issue[], where: (i: Issue) => string) {
    const sets = new Map<string, Issue[]>();
    for (const i of items) sets.set(`${i.severity}|${i.message}`, [...(sets.get(`${i.severity}|${i.message}`) ?? []), i]);
    return [...sets.values()].map((set) => {
      if (set.length === 1) return this.row(set[0]!, where(set[0]!));
      const first = set[0]!;
      const fixes = set.map((i) => i.fix).filter((x): x is Fix => !!x);
      return h(
        'li',
        { class: `issue merged ${first.severity}`, 'data-rule': first.code, 'data-severity': first.severity },
        h('span', { class: `sev ${first.severity}`, role: 'img', 'aria-label': SEVERITY_LABEL[first.severity], 'data-tip': SEVERITY_TIP[first.severity] }, severityIcon(first.severity)),
        h(
          'div',
          { class: 'body' },
          h('span', { class: 'issue-head' }, h('strong', { class: 'issue-title', title: first.code }, RULE_TITLE[first.code] ?? first.code), h('span', { class: 'n' }, `${set.length} places`)),
          issueDetail(first),
          h('ul', { class: 'issue-places' }, set.map((i) => h('li', { 'data-target': i.target, 'data-where': where(i) || undefined }, i.target ? h('code', null, i.target) : null, h('code', { class: 'where' }, where(i))))),
          fixes.length ? h('div', { class: 'fix' }, h('button', { type: 'button', class: 'fix-btn', 'data-tip': TIP.fixAll, onclick: () => this.apply(fixes, `Fix ${fixes.length} issues`) }, icon('tool'), fixes.length === set.length ? `Apply ${fixes.length} fixes` : `Apply ${fixes.length} of ${set.length} fixes`)) : null,
        ),
      );
    });
  }

  private row(i: Issue, where: string) {
    const fix = i.fix;
    return h(
      'li',
      { class: `issue ${i.severity}`, ...issueData(i, where) },
      h('span', { class: `sev ${i.severity}`, role: 'img', 'aria-label': SEVERITY_LABEL[i.severity], 'data-tip': SEVERITY_TIP[i.severity] }, severityIcon(i.severity)),
      h(
        'div',
        { class: 'body' },
        issueHead(i, i.themes ? h('span', { class: 'theme-tag', 'data-tip': TIP.themeTag }, `${i.themes.join(', ')} only`) : null),
        // A finding about a whole file names the file above its message.
        !i.target && where ? h('p', { class: 'issue-file' }, where) : null,
        issueDetail(i),
        fix
          ? h(
              'div',
              { class: 'fix' },
              h('button', { type: 'button', class: 'fix-btn', 'data-tip': TIP.fix, onclick: () => this.apply([fix]) }, icon('tool'), fix.label),
              fix.preview
                ? h('span', { class: 'preview' }, h('code', { class: 'before', 'data-tip': TIP.fixBefore }, fix.preview.before), h('span', { 'aria-label': 'becomes' }, ' → '), h('code', { class: 'after', 'data-tip': TIP.fixAfter }, fix.preview.after))
                : null,
            )
          : remedyOf(i.code) === 'guided'
            ? h('p', { class: 'no-fix' }, noFixNote(i.code))
            : null,
      ),
      // A whole-file finding already names its file above its message.
      i.target || !where ? h('code', { class: 'where', 'data-tip': where ? TIP.where : undefined }, where) : null,
    );
  }
}
