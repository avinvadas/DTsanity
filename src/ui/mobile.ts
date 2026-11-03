import { VISIONS } from '../color/cvd';
import { formatContrast } from '../contrast/metrics';
import { download, FIXED_FOLDER, fixedSet, isUnchanged } from '../io/export';
import { fixPrompt } from '../io/prompt';
import type { Fix, Issue } from '../model/types';
import { glyphOf } from '../semantic/pairs';
import { applyFixes, removeFile, store, undo, type AppState } from '../state/app';
import { pairsOf, siblingFails, type PairRow, type SiblingRow } from '../state/pairs';
import { mergeModels } from '../themes/merge';
import { displayGamut, paintAll, pairCanvas } from './canvas';
import { h, icon, masked, plural, severityIcon } from './dom';

/**
 * The phone layout (narrow screens, whatever the input): the core loop on
 * one page. Files on top (the list and a compact loader), then every finding
 * in one flat list grouped by kind (format, tiers, contrast, color
 * blindness), each card with a single action. Copy fix prompt and Get fixed
 * files stay in a fixed footer. The tools for fine control (curve editor,
 * palette grid, re-aliasing, themes matrix) stay on larger screens; where one
 * would be expected, the card says so and the item goes into the fix prompt.
 *
 * It reads the same store as the desktop views and reuses their checks,
 * fixes and exports; only the presentation differs.
 */

const NARROW = '(max-width: 640px)';
const isTier = (i: Issue) => i.code.startsWith('tier-');

/** Issues across every theme, as the fix prompt sees them. */
const issuesOf = (s: AppState): Issue[] => (s.themeModels.length ? mergeModels(s.themeModels) : s.model).issues;

interface Findings {
  format: Issue[];
  tiers: Issue[];
  fixable: Fix[];
  contrast: PairRow[];
  vision: PairRow[];
  groups: SiblingRow[];
}

function findings(s: AppState): Findings {
  const issues = issuesOf(s).filter((i) => i.severity !== 'info');
  const pairs = pairsOf(s);
  return {
    format: issues.filter((i) => !isTier(i)),
    tiers: issues.filter(isTier),
    fixable: issues.filter((i) => i.fix && 'edits' in i.fix).map((i) => i.fix!),
    contrast: pairs.rows.filter((r) => !r.pass),
    vision: pairs.rows.filter((r) => r.cvdFails.length),
    groups: pairs.siblings.filter(siblingFails),
  };
}

export class TTMobile extends HTMLElement {
  private toast = '';
  /** Whether the toast offers Undo (after a fix, not after a copy). */
  private undoable = false;
  private media = matchMedia(NARROW);
  // A fixed skeleton; renders update only its parts, so the loader (and a half-typed link) is never rebuilt.
  private lede = h('p', { class: 'm-lede' }, 'Check your design tokens for DTCG format, contrast and color blindness, and fix what you can on the go.');
  private fileSlot = h('div', null);
  private loadSection = h('section', { class: 'm-load' }, document.createElement('tt-loader'));
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
        h('header', { class: 'm-head' }, h('span', { class: 'brand-title' }, h('span', { class: 'logo', 'aria-hidden': 'true' }), 'DTsanity')),
        h('main', { class: 'm-body' }, this.lede, this.fileSlot, this.loadSection, this.issueSlot),
        this.toastSlot,
        this.footSlot,
      );
    }
    const s = store.get();
    const has = s.files.length > 0;
    this.lede.hidden = has;
    this.loadSection.classList.toggle('compact', has);
    this.fileSlot.replaceChildren(has ? this.files(s) : '');
    this.issueSlot.replaceChildren(...(has ? this.issues(s, findings(s)).filter((x): x is HTMLElement => !!x) : []));
    this.toastSlot.replaceChildren(
      this.toast
        ? h('div', { class: 'm-toast', role: 'status' }, this.toast, this.undoable ? h('button', { type: 'button', class: 'link', onclick: () => (undo(), this.say('Undone')) }, 'Undo') : null)
        : '',
    );
    this.footSlot.replaceChildren(has ? this.footer(s) : '');
    paintAll(this);
  }

  /** The loaded files, each removable; the loader below adds more. */
  private files(s: AppState) {
    return h(
      'section',
      { class: 'm-section' },
      h('h2', { class: 'm-section-head' }, h('span', null, 'Files'), h('span', { class: 'm-n' }, String(s.files.length))),
      masked(
        h(
          'ul',
          { class: 'm-filelist' },
          s.files.map((f) => h('li', null, h('span', null, f.name), isUnchanged(f) ? null : h('span', { class: 'badge changed' }, 'Edited'), h('button', { type: 'button', class: 'ghost icon-btn', 'aria-label': 'Remove file', onclick: () => removeFile(f.id) }, '✕'))),
        ),
      ),
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
    const section = (title: string, cards: HTMLElement[], clear: string) =>
      h(
        'section',
        { class: 'm-section' },
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
      section('Format', f.format.map((i) => this.issueCard(i, s)), 'Follows the DTCG format.'),
      section('Tiers', f.tiers.map((i) => this.issueCard(i, s)), 'Each tier points the right way.'),
      section('Contrast', f.contrast.map((r) => this.pairCard(r, themes, gamut)), 'Every pair passes.'),
      section(
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
    return h(
      'article',
      { class: `m-item ${i.severity}` },
      h('div', { class: 'm-item-head' }, severityIcon(i.severity), i.target ? h('code', null, i.target) : null),
      h('p', null, i.message),
      file ? h('small', { class: 'm-where' }, file) : null,
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
    return h(
      'footer',
      { class: 'm-foot' },
      h('button', { type: 'button', class: 'm-secondary', onclick: copy }, icon('copy'), 'Copy fix prompt'),
      h(
        'button',
        { type: 'button', class: 'm-primary', disabled: !changed, onclick: () => download(`${FIXED_FOLDER}.zip`, fixedSet(store.get()), 'application/zip') },
        icon('download'),
        s.files.length === 1 ? 'Get fixed file' : 'Get fixed files',
      ),
    );
  }
}
