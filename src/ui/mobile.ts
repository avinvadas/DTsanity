import { VISIONS } from '../color/cvd';
import { formatContrast } from '../contrast/metrics';
import { download, FIXED_FOLDER, fixedSet, isUnchanged } from '../io/export';
import { fixPrompt } from '../io/prompt';
import type { Fix, Issue } from '../model/types';
import { glyphOf } from '../semantic/pairs';
import { applyFixes, removeFile, store, undo, type AppState } from '../state/app';
import type { PairRow, SiblingRow } from '../state/pairs';
import { displayGamut, paintAll, pairCanvas } from './canvas';
import { allClear, findingCards, findings, openLines, type Findings } from './findings';
import { issueData, issueDetail, issueHead } from './issue';
import { targetSelect } from './contrast';
import { fileStatusLine, ingest } from './loader';
import { ACCEPT, readFiles } from '../io/load';
import { h, icon, masked, plural, severityIcon, xButton } from './dom';
import { homeLink } from './logo';
import { issuesScope, pairsScope, promptButton } from './prompt-link';
import { themeToggle } from './theme';

/**
 * The phone layout (narrow screens, whatever the input): the core loop on
 * one page. Cards for the four kinds of findings on top, each a link to its
 * section, under the files' status, which opens the file list (and Add files); then every finding
 * in one flat list grouped by kind (format, tiers, contrast, color
 * blindness); a card with a fix has its button, and each group needing a
 * change has a button that copies its fix prompt. Copy fix prompt (the main
 * action) and Get fixed files stay in a fixed footer. The tools for fine
 * control (curve editor, palette grid, re-aliasing, themes matrix) stay on
 * larger screens, as the note under the list says.
 *
 * It reads the same store as the desktop views and reuses their checks,
 * fixes and exports; only the presentation differs.
 */

const NARROW = '(max-width: 640px)';

export class TTMobile extends HTMLElement {
  private toast = '';
  /** Whether the toast offers Undo (after a fix, not after a copy). */
  private undoable = false;
  private media = matchMedia(NARROW);
  // A fixed skeleton; renders update only its parts, so the loader (and a half-typed link) is never rebuilt.
  private lede = h('p', { class: 'm-lede' }, 'Check your design tokens DTCG format compliance and accessibility issues');
  private navSlot = h('div', null);
  private fileSlot = h('div', null);
  private loadSection = h('section', { class: 'm-load' }, document.createElement('tt-loader'));
  // Once files are in, adding more is a + in the top bar; the large loader is for the first files only.
  private picker = h('input', {
    type: 'file',
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
    multiple: true,
    accept: ACCEPT,
    onchange: () => {
      if (this.picker.files?.length) void ingest(readFiles(this.picker.files));
      this.picker.value = '';
    },
  });
  // Between the header and the findings: the files' count and last change, a handle that opens the file list.
  private status = fileStatusLine('span');
  private expanded = false;
  private toggle = h(
    'button',
    {
      type: 'button',
      class: 'm-files-toggle',
      'aria-expanded': 'false',
      'aria-controls': 'm-files-panel',
      onclick: () => this.setExpanded(!this.expanded),
    },
    this.status.el,
    h('span', { class: 'm-chevron' }, icon('chevron')),
  );
  private bar = h('section', { class: 'files-bar m-files' }, this.toggle, h('div', { id: 'm-files-panel', class: 'm-files-panel', hidden: true }, this.fileSlot));
  private issueSlot = h('div', { class: 'm-stack' });
  private toastSlot = h('div', null);
  private footSlot = h('div', null);
  private built = false;
  /**
   * A page shown in place of the findings: the severity policy (the cog in the
   * top bar) or how DTsanity fixes (the footer link). The arrow closes it; the cog toggles the policy.
   */
  private page: 'policy' | 'principles' | null = null;
  private scrollBefore = 0;
  private content = h('div', { class: 'm-content' });
  private policySection = h('section', { class: 'm-policy', hidden: true });
  private principlesSection = h('section', { class: 'm-policy', hidden: true });
  private back = h('button', { type: 'button', class: 'corner-btn', hidden: true, 'aria-label': 'Back', onclick: () => this.setPage(null) }, icon('arrow-left'));
  private cog = h('button', { type: 'button', class: 'corner-btn', 'aria-label': 'Severity policy', 'aria-pressed': 'false', onclick: () => this.setPage(this.page === 'policy' ? null : 'policy') }, icon('settings'));
  private onHash = () => {
    if (!this.media.matches) return;
    if (location.hash === '#principles') this.setPage('principles');
    else if (this.page === 'principles') this.setPage(null);
  };
  private unsub?: () => void;
  private onMedia = () => this.render();

  connectedCallback() {
    this.media.addEventListener('change', this.onMedia);
    window.addEventListener('hashchange', this.onHash);
    this.unsub = store.select(
      (s) => s,
      () => this.render(),
      (a, b) => a.files === b.files && a.model === b.model && a.themeModels === b.themeModels && a.settings === b.settings && a.pairEdits === b.pairEdits && a.past === b.past,
    );
  }

  disconnectedCallback() {
    this.media.removeEventListener('change', this.onMedia);
    window.removeEventListener('hashchange', this.onHash);
    this.unsub?.();
    this.status.unsub();
  }

  /** The initial state: no page open, the file list closed, at the top. */
  private home() {
    this.scrollBefore = 0;
    this.setPage(null);
    this.setExpanded(false);
    window.scrollTo(0, 0);
  }

  private setPage(page: 'policy' | 'principles' | null) {
    if (page === this.page) return;
    // Come back to the same place on the findings.
    if (!this.page) this.scrollBefore = window.scrollY;
    this.page = page;
    if (page === 'policy' && !this.policySection.firstChild) this.policySection.append(document.createElement('tt-policy'));
    if (page === 'principles' && !this.principlesSection.firstChild) this.principlesSection.append(document.createElement('tt-principles'));
    // The footer link set the hash; leaving the page clears it, so the link works again.
    if (page !== 'principles' && location.hash === '#principles') history.replaceState(null, '', location.pathname + location.search);
    this.content.hidden = !!page;
    this.policySection.hidden = page !== 'policy';
    this.principlesSection.hidden = page !== 'principles';
    this.footSlot.hidden = !!page;
    this.back.hidden = !page;
    this.cog.setAttribute('aria-pressed', String(page === 'policy'));
    window.scrollTo(0, page ? 0 : this.scrollBefore);
  }

  private say(text: string, undoable = false) {
    this.toast = text;
    this.undoable = undoable;
    this.render();
    setTimeout(() => {
      if (this.toast !== text) return;
      this.toast = '';
      this.render();
    }, 4000);
  }

  private render() {
    // Rendered only on narrow screens; the desktop layout is used otherwise.
    if (!this.media.matches) return;
    if (!this.built) {
      this.built = true;
      this.replaceChildren(
        h('header', { class: 'm-head' }, homeLink(() => this.home()), this.picker, h('div', { class: 'm-corner' }, this.back, this.cog, themeToggle())),
        h(
          'main',
          { class: 'm-body' },
          this.content,
          this.policySection,
          this.principlesSection,
          (document.querySelector('.workspace > .page-foot')?.cloneNode(true) as HTMLElement | undefined) ?? '',
        ),
        this.toastSlot,
        this.footSlot,
      );
      this.content.append(this.lede, this.bar, this.navSlot, this.loadSection, this.issueSlot);
      // Opened straight from a link to the page.
      queueMicrotask(this.onHash);
    }
    const s = store.get();
    const has = s.files.length > 0;
    this.lede.hidden = has;
    this.loadSection.hidden = has;
    this.bar.hidden = !has;
    const found = has ? findings(s) : undefined;
    const cards = found ? findingCards(found, (k) => document.getElementById(`m-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), (k) => `#m-${k}`) : null;
    // The target every contrast finding is measured against, on the line that counts them.
    const title = cards?.querySelector('.findings-title');
    if (title) {
      const head = h('div', { class: 'm-findings-head' });
      title.before(head);
      head.append(title, h('div', { class: 'contrast-pick' }, h('label', { class: 'pick-label', for: 'm-contrast-pick' }, 'Contrast'), targetSelect(s.settings, 'm-contrast-pick')));
    }
    this.navSlot.replaceChildren(cards ?? '');
    this.fileSlot.replaceChildren(has ? this.files(s) : '');
    this.issueSlot.replaceChildren(...(found ? this.issues(s, found).filter((x): x is HTMLElement => !!x) : []));
    this.toastSlot.replaceChildren(
      this.toast
        ? h('div', { class: 'm-toast', role: 'status' }, this.toast, this.undoable ? h('button', { type: 'button', class: 'link', onclick: () => (undo(), this.say('Undone')) }, 'Undo') : null)
        : '',
    );
    this.footSlot.replaceChildren(has ? this.footer(s) : '');
    paintAll(this);
  }

  private setExpanded(open: boolean) {
    this.expanded = open;
    this.toggle.setAttribute('aria-expanded', String(open));
    (this.toggle.nextElementSibling as HTMLElement).hidden = !open;
  }

  /** The loaded files, each removable, then a row that adds more. */
  private files(s: AppState) {
    return h(
      'ul',
      { class: 'm-filelist' },
      s.files.map((f) => masked(h('li', null, h('span', null, f.name), isUnchanged(f) ? null : h('span', { class: 'badge changed' }, 'Edited'), xButton('Remove file', () => removeFile(f.id))))),
      h('li', { class: 'm-add-row' }, h('button', { type: 'button', class: 'm-add-file', onclick: () => this.picker.click() }, icon('plus'), 'Add files')),
    );
  }

  private fixAll(fixes: Fix[]) {
    const applied = applyFixes(fixes);
    this.say(`${plural(applied, 'fix', 'fixes')} applied`, true);
  }

  /** Every finding in one list, grouped by kind; a kind with nothing to fix says so in one line. */
  private issues(s: AppState, f: Findings) {
    const gamut = displayGamut(s.settings.gamut);
    const themes = s.themeModels.map((m) => m.theme.name);
    // Format and tier issues in two clusters: what is fixed here in one tap, then what needs a change from you.
    const canFix = (i: Issue) => !!i.fix && 'edits' in i.fix;
    const clustered = (issues: Issue[]) => {
      const fixable = issues.filter(canFix);
      const manual = issues.filter((i) => !canFix(i));
      // As on desktop: the count first, by token; the fix prompt for the group that needs a change.
      const counted = (items: Issue[], one: string, many: string) => {
        const tokens = items.every((i) => i.target);
        const n = tokens ? new Set(items.map((i) => i.target)).size : items.length;
        return `${plural(n, tokens ? 'token' : 'issue')} ${n === 1 ? one : many}`;
      };
      const head = (title: string, action?: Node) => h('h3', { class: 'm-cluster' }, h('span', { class: 'cluster-title' }, title), action ?? null);
      return [
        ...(fixable.length ? [head(counted(fixable, 'can be fixed here', 'can be fixed here')), ...fixable.map((i) => this.issueCard(i, s))] : []),
        ...(manual.length ? [head(counted(manual, 'needs your change', 'need your change'), promptButton(issuesScope(manual))), ...manual.map((i) => this.issueCard(i, s))] : []),
      ];
    };
    const section = (id: string, title: string, cards: HTMLElement[], clear: string, n = cards.length, action?: Node) =>
      h(
        'section',
        { class: 'm-section', id },
        h(
          'h2',
          { class: 'm-section-head' },
          h('span', null, title),
          n ? h('span', { class: 'm-n' }, String(n)) : h('span', { class: 'm-ok', 'aria-label': 'passes' }, icon('check')),
          n && action ? action : null,
        ),
        cards.length ? masked(h('div', { class: 'm-list' }, cards)) : h('p', { class: 'm-clear' }, clear),
      );
    return [
      f.fixable.length ? h('button', { type: 'button', class: 'm-fixall', onclick: () => this.fixAll(f.fixable) }, icon('tool'), `Fix ${plural(f.fixable.length, 'safe issue')}`) : null,
      section('m-format', 'Format', clustered(f.format), 'Follows the DTCG format.', f.format.length),
      section('m-tiers', 'Tiers', clustered(f.tiers), 'Each tier points the right way.', f.tiers.length),
      section('m-contrast', 'Contrast', f.contrast.map((r) => this.pairCard(r, themes, gamut)), 'Every pair passes.', f.contrast.length, promptButton(pairsScope(f.contrast))),
      section(
        'm-vision',
        'Color blindness',
        [...f.vision.map((r) => this.visionCard(r, themes)), ...f.groups.map((g) => this.groupCard(g, themes, s.settings.cvdDistance))],
        'Pairs and status colors stay apart.',
        f.vision.length + f.groups.length,
        promptButton(pairsScope(f.vision, f.groups)),
      ),
      h('p', { class: 'm-note' }, 'Palette curves, re-aliasing and themes are available on a larger screen.'),
    ];
  }

  private issueCard(i: Issue, s: AppState) {
    const file = s.files.find((f) => f.id === i.fileId)?.name;
    const action =
      i.fix && 'edits' in i.fix
        ? h('button', { type: 'button', class: 'm-fix', onclick: () => (applyFixes([i.fix!]), this.say('Fixed', true)) }, icon('tool'), i.fix.label)
        : null;
    const where = file && i.pos ? `${file}:${i.pos.line}` : (file ?? '');
    return h(
      'article',
      { class: `m-item ${i.severity}`, ...issueData(i, where) },
      h('div', { class: 'm-item-head' }, severityIcon(i.severity), issueHead(i)),
      issueDetail(i),
      where ? h('small', { class: 'm-where' }, where) : null,
      action,
    );
  }

  /** A failing pair: the swatch, and per theme the value against the level it misses. */
  private pairCard(r: PairRow, themes: string[], gamut: ReturnType<typeof displayGamut>) {
    const fails = r.seen.normal.map((c, i) => ({ c, theme: themes[i] })).filter((x) => x.c && !x.c.pass);
    const first = fails[0]!.c!;
    return h(
      'article',
      { class: `m-item ${r.tone}` },
      h(
        'div',
        { class: 'm-pair' },
        pairCanvas(first.shown, first.bg, glyphOf(r.pair), gamut),
        h('div', null, h('code', null, r.pair.fg), h('small', null, `on ${r.pair.bg}`)),
      ),
      h(
        'ul',
        { class: 'm-results' },
        fails.map(({ c, theme }) => {
          const miss = c!.results.find((x) => !x.pass)!;
          return h('li', null, theme ? h('b', null, `${theme}: `) : null, `${formatContrast(miss.value, miss.level.metric)} of ${miss.level.threshold} `, h('small', null, `(${miss.level.short})`));
        }),
      ),
    );
  }

  private visionCard(r: PairRow, themes: string[]) {
    const names = r.cvdFails.map((v) => VISIONS.find((x) => x.id === v)!.label);
    const where = themes.length ? ` in ${r.cvdFails.flatMap((v) => r.seen[v].map((c, i) => (c && !c.pass ? themes[i] : null))).filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}` : '';
    return h(
      'article',
      { class: `m-item ${r.cvdTone}` },
      h('div', { class: 'm-item-head' }, severityIcon(r.cvdTone), h('code', null, r.pair.fg)),
      h('p', null, `On ${r.pair.bg}, drops below its level with ${names.join(', ')}${where}.`),
    );
  }

  private groupCard(g: SiblingRow, themes: string[], min: number) {
    const lines = g.checks.flatMap((c, i) => {
      const fails = (c?.results ?? []).filter((x) => !x.pass && x.vision !== 'achroma');
      return fails.length ? [`${themes[i] ? `${themes[i]}: ` : ''}${fails.map((x) => VISIONS.find((v) => v.id === x.vision)!.short).join(', ')}`] : [];
    });
    return h(
      'article',
      { class: `m-item ${g.tone ?? 'warning'}` },
      h('div', { class: 'm-item-head' }, severityIcon(g.tone ?? 'warning'), h('code', null, g.group.id)),
      h('p', null, `Status colors ${g.group.members.join(', ')} look too alike (need a difference of ${min}).`),
      h('ul', { class: 'm-results' }, lines.map((l) => h('li', null, l))),
    );
  }

  /** The two ways out, always in reach: the prompt for what's left, and the fixed set once something changed. */
  private footer(s: AppState) {
    const changed = s.files.some((f) => !isUnchanged(f));
    const copy = async () => {
      const { text } = fixPrompt(store.get());
      try {
        await navigator.clipboard.writeText(text || 'No corrections needed: every check passes.');
        this.say('Fix prompt copied');
      } catch {
        this.say('Copy failed');
      }
    };
    const save = h(
      'button',
      { type: 'button', class: 'm-secondary', disabled: !changed, onclick: () => download(`${FIXED_FOLDER}.zip`, fixedSet(store.get(), undefined, openLines(findings(store.get()))), 'application/zip') },
      icon('download'),
      s.files.length === 1 ? 'Get fixed file' : 'Get fixed files',
    );
    // Nothing left to fix: no prompt; what was fixed here is the one way out, filling the footer.
    if (allClear(s)) return changed ? h('footer', { class: 'm-foot clear' }, (save.classList.replace('m-secondary', 'm-primary'), save)) : '';
    return h(
      'footer',
      { class: 'm-foot' },
      h('button', { type: 'button', class: 'm-primary', onclick: copy }, icon('copy'), 'Copy fix prompt'),
      save,
    );
  }
}
