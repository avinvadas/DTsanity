import { VISIONS } from '../color/cvd';
import { formatContrast } from '../contrast/metrics';
import { download, FIXED_FOLDER, fixedSet, isUnchanged } from '../io/export';
import { fixPrompt } from '../io/prompt';
import type { Fix, Issue } from '../model/types';
import { glyphOf } from '../semantic/pairs';
import { applyFixes, removeFile, store, undo, type AppState } from '../state/app';
import type { PairRow, SiblingRow } from '../state/pairs';
import { displayGamut, paintAll, pairCanvas } from './canvas';
import { allClear, findingCards, findings, type Findings } from './findings';
import { issueData, issueDetail, issueHead } from './issue';
import { targetSelect } from './contrast';
import { fileStatusLine, ingest } from './loader';
import { ACCEPT, readFiles } from '../io/load';
import { h, icon, masked, plural, severityIcon, xButton } from './dom';
import { logo } from './logo';
import { themeToggle } from './theme';

/**
 * The phone layout (narrow screens, whatever the input): the core loop on
 * one page. Cards for the four kinds of findings on top, each a link to its
 * section, under the files' status, which opens the file list (and Add files); then every finding
 * in one flat list grouped by kind (format, tiers, contrast, color
 * blindness), each card with a single action. Copy fix prompt (the main action)
 * and Get fixed files stay in a fixed footer. The tools for fine control (curve editor,
 * palette grid, re-aliasing, themes matrix) stay on larger screens; where one
 * would be expected, the card says so and the item goes into the fix prompt.
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
  private lede = h('p', { class: 'm-lede' }, 'Check your design tokens for DTCG format, contrast and color blindness, and fix what you can on the go.');
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
  private unsub?: () => void;
  private onMedia = () => this.render();

  connectedCallback() {
    this.media.addEventListener('change', this.onMedia);
    this.unsub = store.select(
      (s) => s,
      () => this.render(),
      (a, b) => a.files === b.files && a.model === b.model && a.themeModels === b.themeModels && a.settings === b.settings && a.pairEdits === b.pairEdits && a.past === b.past,
    );
  }

  disconnectedCallback() {
    this.media.removeEventListener('change', this.onMedia);
    this.unsub?.();
    this.status.unsub();
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
        h('header', { class: 'm-head' }, logo(), this.picker, themeToggle()),
        h('main', { class: 'm-body' }, this.lede, this.bar, this.navSlot, this.loadSection, this.issueSlot, (document.querySelector('.workspace > .page-foot')?.cloneNode(true) as HTMLElement | undefined) ?? ''),
        this.toastSlot,
        this.footSlot,
      );
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
    applyFixes(fixes);
    this.say(`${plural(fixes.length, 'fix', 'fixes')} applied`, true);
  }

  /** Every finding in one list, grouped by kind; a kind with nothing to fix says so in one line. */
  private issues(s: AppState, f: Findings) {
    const gamut = displayGamut(s.settings.gamut);
    const themes = s.themeModels.map((m) => m.theme.name);
    const section = (id: string, title: string, cards: HTMLElement[], clear: string) =>
      h(
        'section',
        { class: 'm-section', id },
        h(
          'h2',
          { class: 'm-section-head' },
          h('span', null, title),
          cards.length ? h('span', { class: 'm-n' }, String(cards.length)) : h('span', { class: 'm-ok', 'aria-label': 'passes' }, icon('check')),
        ),
        cards.length ? masked(h('div', { class: 'm-list' }, cards)) : h('p', { class: 'm-clear' }, clear),
      );
    return [
      f.fixable.length ? h('button', { type: 'button', class: 'm-fixall', onclick: () => this.fixAll(f.fixable) }, `Fix ${plural(f.fixable.length, 'safe issue')}`) : null,
      section('m-format', 'Format', f.format.map((i) => this.issueCard(i, s)), 'Follows the DTCG format.'),
      section('m-tiers', 'Tiers', f.tiers.map((i) => this.issueCard(i, s)), 'Each tier points the right way.'),
      section('m-contrast', 'Contrast', f.contrast.map((r) => this.pairCard(r, themes, gamut)), 'Every pair passes.'),
      section(
        'm-vision',
        'Color blindness',
        [...f.vision.map((r) => this.visionCard(r, themes)), ...f.groups.map((g) => this.groupCard(g, themes, s.settings.cvdDistance))],
        'Pairs and status colors stay apart.',
      ),
      h('p', { class: 'm-note' }, 'Palette curves, re-aliasing and themes are available on a larger screen.'),
    ];
  }

  private issueCard(i: Issue, s: AppState) {
    const file = s.files.find((f) => f.id === i.fileId)?.name;
    const action =
      i.fix && 'edits' in i.fix
        ? h('button', { type: 'button', class: 'm-fix', onclick: () => (applyFixes([i.fix!]), this.say('Fixed', true)) }, i.fix.label)
        : h('span', { class: 'm-later' }, 'In the fix prompt');
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
      { class: `m-item ${r.pair.kind === 'text' ? 'error' : 'warning'}` },
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
      h('span', { class: 'm-later' }, 'Re-alias on a larger screen · in the fix prompt'),
    );
  }

  private visionCard(r: PairRow, themes: string[]) {
    const names = r.cvdFails.map((v) => VISIONS.find((x) => x.id === v)!.label);
    const where = themes.length ? ` in ${r.cvdFails.flatMap((v) => r.seen[v].map((c, i) => (c && !c.pass ? themes[i] : null))).filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}` : '';
    return h(
      'article',
      { class: 'm-item warning' },
      h('div', { class: 'm-item-head' }, severityIcon('warning'), h('code', null, r.pair.fg)),
      h('p', null, `On ${r.pair.bg}, drops below its level with ${names.join(', ')}${where}.`),
      h('span', { class: 'm-later' }, 'In the fix prompt'),
    );
  }

  private groupCard(g: SiblingRow, themes: string[], min: number) {
    const lines = g.checks.flatMap((c, i) => {
      const fails = (c?.results ?? []).filter((x) => !x.pass && x.vision !== 'achroma');
      return fails.length ? [`${themes[i] ? `${themes[i]}: ` : ''}${fails.map((x) => VISIONS.find((v) => v.id === x.vision)!.short).join(', ')}`] : [];
    });
    return h(
      'article',
      { class: 'm-item warning' },
      h('div', { class: 'm-item-head' }, severityIcon('warning'), h('code', null, g.group.id)),
      h('p', null, `Status colors ${g.group.members.join(', ')} look too alike (need a difference of ${min}).`),
      h('ul', { class: 'm-results' }, lines.map((l) => h('li', null, l))),
      h('span', { class: 'm-later' }, 'In the fix prompt'),
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
      { type: 'button', class: 'm-secondary', disabled: !changed, onclick: () => download(`${FIXED_FOLDER}.zip`, fixedSet(store.get()), 'application/zip') },
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
