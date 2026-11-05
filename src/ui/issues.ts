import { VISIONS } from '../color/cvd';
import { formatContrast } from '../contrast/metrics';
import type { Category, Fix, Issue, Model, Severity } from '../model/types';
import { ALL_THEMES, applyFixes, setActiveTheme, store, undo, type AppState } from '../state/app';
import type { PairRow, SiblingRow } from '../state/pairs';
import { mergeModels } from '../themes/merge';
import { h, masked, plural, severityIcon, viewHead } from './dom';
import { findingCards, findings, type FindingKind, type Findings } from './findings';
import { issueData, issueDetail, issueHead } from './issue';
import { viewControls } from './loader';
import { goTo } from './nav';
import { CATEGORY_TIP, SEVERITY_TIP, TIP } from './tips';

const isTier = (i: Issue) => i.code.startsWith('tier-');
/** Where each pair tier's findings are worked on. */
const TIER_VIEW = { semantic: { view: 'semantic', label: 'Sys tier' }, component: { view: 'components', label: 'Component tier' } } as const;

const SEVERITIES: Severity[] = ['error', 'warning', 'info'];
const SEVERITY_LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };
const CATEGORIES: Category[] = ['format', 'structure', 'references', 'types', 'values', 'metadata'];
const CATEGORY_LABEL: Record<Category, string> = {
  format: 'File format',
  structure: 'Structure',
  references: 'References',
  types: 'Types',
  values: 'Values',
  metadata: 'Metadata',
};


export class TTIssues extends HTMLElement {
  private unsubs: (() => void)[] = [];
  private reload = viewControls();

  connectedCallback() {
    this.unsubs.push(
      store.select(
        (s) => s,
        (v) => this.render(v.model, v),
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

  private setStatus(text: string, withUndo = false) {
    this.reload.status.replaceChildren(text);
    if (withUndo) this.reload.status.append(' · ', h('button', { type: 'button', class: 'link', onclick: () => (undo(), this.setStatus('Undone')) }, 'Undo'));
  }

  private apply(fixes: Fix[], label?: string) {
    const edits = fixes.filter((f) => 'edits' in f).length;
    applyFixes(fixes, label);
    this.setStatus(fixes.length === 1 ? `Applied: ${fixes[0]!.label}` : `Applied ${fixes.length} fixes`, edits > 0);
  }

  /** In a single-theme view, how many issues exist only in other themes. */
  private otherThemes(v: Pick<AppState, 'themeModels' | 'activeTheme' | 'themes'>) {
    if (!v.themeModels.length || v.activeTheme === ALL_THEMES) return null;
    const name = v.themes.find((t) => t.id === v.activeTheme)?.name;
    const elsewhere = mergeModels(v.themeModels).issues.filter((i) => i.themes && name && !i.themes.includes(name)).length;
    return h(
      'p',
      { class: 'note' },
      masked(h('span', null, `Showing theme “${name}”. `)),
      elsewhere ? `${elsewhere} more ${elsewhere === 1 ? 'issue occurs' : 'issues occur'} only in other themes. ` : 'Other themes have no further issues. ',
      h('button', { type: 'button', class: 'link', onclick: () => setActiveTheme(ALL_THEMES) }, 'Show all themes'),
    );
  }

  /** Every kind of finding is listed on this page: each card scrolls to its section. Info notes follow in their own. */
  private go(kind: FindingKind) {
    const target = this.querySelector(kind === 'format' ? '.issue-group, #issues-format' : `#issues-${kind}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (target?.querySelector('h3') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** A section of this page: its heading (with a count, and any actions), then its list, or a line saying it passes. */
  private group(id: string, title: string, tip: string | undefined, n: number, actions: (Node | null)[], list: HTMLElement | null, clear: string) {
    return h(
      'section',
      { class: 'issue-group', id },
      h(
        'div',
        { class: 'group-head' },
        h('h3', { tabindex: '-1', 'data-tip': tip }, title, n ? h('span', { class: 'n', 'data-tip': TIP.groupCount }, String(n)) : null),
        h('div', { class: 'group-actions' }, actions),
      ),
      list ?? h('p', { class: 'empty' }, clear),
    );
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
      const sev: Severity = r.pair.kind === 'text' ? 'error' : 'warning';
      const detail = misses
        .map(({ theme, miss }) => `${theme ? `${theme}: ` : ''}${formatContrast(miss.value, miss.level.metric)} of ${miss.level.threshold} (${miss.level.short})`)
        .join(' · ');
      return this.pairRow(sev, r.pair.kind === 'text' ? 'Low text contrast' : 'Low UI contrast', r.pair.fg, `On ${r.pair.bg}. ${detail}`, pairWhere(r));
    };
    const visionRow = (r: PairRow) => {
      const names = r.cvdFails.map((v) => VISIONS.find((x) => x.id === v)!.label);
      const where = themes.length ? ` in ${r.cvdFails.flatMap((v) => r.seen[v].map((c, i) => (c && !c.pass ? themes[i] : null))).filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}` : '';
      return this.pairRow('warning', 'Fails with color blindness', r.pair.fg, `On ${r.pair.bg}, drops below its level with ${names.join(', ')}${where}.`, pairWhere(r));
    };
    const groupRow = (g: SiblingRow) => {
      const lines = g.checks.flatMap((c, i) => {
        const fails = (c?.results ?? []).filter((x) => !x.pass && x.vision !== 'achroma');
        return fails.length ? [`${themes[i] ? `${themes[i]}: ` : ''}${fails.map((x) => VISIONS.find((v) => v.id === x.vision)!.short).join(', ')}`] : [];
      });
      return this.pairRow('warning', 'Status colors too alike', g.group.id, `${g.group.members.join(', ')} need a difference of ${min}. ${lines.join(' · ')}`, g.component ? `${TIER_VIEW[g.tier].label} · ${g.component}` : TIER_VIEW[g.tier].label);
    };
    const vision = [...f.vision.map(visionRow), ...f.groups.map(groupRow)];
    return [
      this.group(
        'issues-contrast',
        'Contrast',
        undefined,
        f.contrast.length,
        this.tierLinks(f.contrast.map((r) => r.tier)),
        f.contrast.length ? masked(h('ul', { class: 'issue-list' }, f.contrast.map(contrastRow))) : null,
        'Every pair passes.',
      ),
      this.group(
        'issues-vision',
        'Color blindness',
        undefined,
        vision.length,
        this.tierLinks([...f.vision.map((r) => r.tier), ...f.groups.map((g) => g.tier)], true),
        vision.length ? masked(h('ul', { class: 'issue-list' }, vision)) : null,
        'Pairs and status colors stay apart.',
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

  private render(model: Model, v: AppState) {
    // All loaded files: a theme's model only knows its own, and the all-themes view merges several.
    const names = new Map(store.get().files.map((f) => [f.id, f.name]));
    const count = (s: Severity) => model.issues.filter((i) => i.severity === s).length;
    const where = (i: Issue) => {
      const name = i.fileId ? names.get(i.fileId) : undefined;
      if (!name) return '';
      return i.pos ? `${name}:${i.pos.line}:${i.pos.col}` : name;
    };

    // Format issues by category; tier issues get their own section, like the Tiers card.
    const groups = CATEGORIES.map((c) => ({
      category: c,
      issues: model.issues
        .filter((i) => i.category === c && !isTier(i) && i.severity !== 'info')
        .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (a.pos?.offset ?? 0) - (b.pos?.offset ?? 0)),
    })).filter((g) => g.issues.length > 0);
    const tierIssues = model.issues.filter((i) => isTier(i) && i.severity !== 'info').sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
    // Notes, not problems: kept apart at the end, so each section above counts what its card counts.
    const infoIssues = model.issues.filter((i) => i.severity === 'info').sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || (a.pos?.offset ?? 0) - (b.pos?.offset ?? 0));
    const f = findings(v);
    const themes = v.themeModels.map((m) => m.theme.name);
    const fixAll = (fixes: Fix[], what: string) =>
      fixes.length > 1
        ? h('button', { type: 'button', class: 'fix-all', 'data-tip': TIP.fixAll, onclick: () => this.apply(fixes, `Fix ${fixes.length} ${what} issues`) }, `Apply ${fixes.length} fixes`)
        : null;
    const fixesOf = (issues: Issue[]) => issues.map((i) => i.fix).filter((x): x is Fix => !!x);

    this.replaceChildren(
      viewHead('Issues', {
        summary: SEVERITIES.filter(count).map((s) => h('span', { class: `chip ${s}`, 'data-tip': SEVERITY_TIP[s] }, severityIcon(s), plural(count(s), SEVERITY_LABEL[s].toLowerCase()))),
        actions: this.reload.el,
      }),
      findingCards(f, (k) => this.go(k), () => '#issues'),
      this.otherThemes(v) ?? '',
      h(
        'div',
        { class: 'issue-groups' },
        groups.length
          ? groups.map(({ category, issues }) =>
              this.group(
                `issues-${category}`,
                CATEGORY_LABEL[category],
                CATEGORY_TIP[category],
                issues.length,
                [fixAll(fixesOf(issues), CATEGORY_LABEL[category].toLowerCase())],
                masked(h('ul', { class: 'issue-list' }, issues.map((i) => this.row(i, where(i))))),
                '',
              ),
            )
          : this.group('issues-format', 'Format', undefined, 0, [], null, model.files.length ? 'The files follow the DTCG format.' : ''),
        this.group(
          'issues-tiers',
          'Tiers',
          undefined,
          tierIssues.length,
          [fixAll(fixesOf(tierIssues), 'tier')],
          tierIssues.length ? masked(h('ul', { class: 'issue-list' }, tierIssues.map((i) => this.row(i, where(i))))) : null,
          'Each tier points the right way.',
        ),
        ...this.pairGroups(f, themes, v.settings.cvdDistance),
        infoIssues.length
          ? this.group(
              'issues-info',
              'Info',
              SEVERITY_TIP.info,
              infoIssues.length,
              [fixAll(fixesOf(infoIssues), 'info')],
              masked(h('ul', { class: 'issue-list' }, infoIssues.map((i) => this.row(i, where(i))))),
              '',
            )
          : null,
      ),
    );
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
        issueDetail(i),
        fix
          ? h(
              'div',
              { class: 'fix' },
              h('button', { type: 'button', class: 'fix-btn', 'data-tip': TIP.fix, onclick: () => this.apply([fix]) }, fix.label),
              fix.preview
                ? h('span', { class: 'preview' }, h('code', { class: 'before', 'data-tip': TIP.fixBefore }, fix.preview.before), h('span', { 'aria-label': 'becomes' }, ' → '), h('code', { class: 'after', 'data-tip': TIP.fixAfter }, fix.preview.after))
                : null,
            )
          : null,
      ),
      h('code', { class: 'where', 'data-tip': where ? TIP.where : undefined }, where),
    );
  }
}
