import { ALL_THEMES, setActiveTheme, store, type AppState } from '../state/app';
import { pairsOf, siblingFails } from '../state/pairs';
import { palettesOf } from '../state/palettes';
import { download, FIXED_FOLDER, fixedSet, isUnchanged } from '../io/export';
import { fixPrompt } from '../io/prompt';
import { tierNames } from '../model/tiers';
import { h, icon, masked, plural, severityIcon } from './dom';
import { allClear, findings, findingTones, findingTotal, openLines } from './findings';
import { TIP } from './tips';

/**
 * Sidebar navigation and view switching. One view is shown at a time; the
 * current one is kept in the URL hash (view names only, never token data) so
 * the back button and reloads work.
 */

export type ViewId = 'files' | 'themes' | 'issues' | 'colors' | 'semantic' | 'components' | 'tokens' | 'privacy' | 'policy' | 'principles';

interface ViewDef {
  id: ViewId;
  label: string;
  needsFiles: boolean;
  /** Planned but not built yet: listed, not selectable. */
  soon?: boolean;
  tip: string;
}

// Results first; the views that manage the loaded files come last.
const VIEWS: ViewDef[] = [
  { id: 'issues', label: 'Issues', needsFiles: true, tip: TIP.navIssues },
  { id: 'colors', label: 'Base tier', needsFiles: true, tip: TIP.navColors },
  { id: 'semantic', label: 'Semantic tier', needsFiles: true, tip: TIP.navSemantic },
  { id: 'components', label: 'Component tier', needsFiles: true, tip: TIP.navComponents },
  { id: 'tokens', label: 'Tokens list', needsFiles: true, tip: TIP.navTokens },
  { id: 'themes', label: 'Themes', needsFiles: true, tip: TIP.navThemes },
  { id: 'files', label: 'Files', needsFiles: false, tip: TIP.navFiles },
];

/** How many views come before the separator: the results, then the file management views. */
const RESULT_VIEWS = 5;

/** Views outside the sidebar: privacy and how DTsanity fixes (from the footer), and the severity policy (the cog by the appearance switch). */
const isView = (v: string): v is ViewId => VIEWS.some((d) => d.id === v) || v === 'privacy' || v === 'policy' || v === 'principles';

/** Pages shown on their own: the header and footer stay, the sidebar goes. */
const PAGES: readonly ViewId[] = ['principles'];
/** Views that keep where they were opened from, for their back arrow. */
const ASIDE: readonly ViewId[] = ['policy', 'principles'];

function requested(): ViewId {
  const id = location.hash.slice(1);
  return isView(id) ? id : 'files';
}

/** The view that can actually be shown for a request, given what is loaded. */
function resolve(id: ViewId, hasFiles: boolean): ViewId {
  const def = VIEWS.find((d) => d.id === id);
  if (def?.soon) return hasFiles ? resolve('issues', hasFiles) : 'files';
  if (def?.needsFiles && !hasFiles) return 'files';
  return id;
}

export function goTo(id: ViewId) {
  // Switch now rather than on hashchange, so the old view never shows for a frame.
  show(resolve(id, store.get().files.length > 0));
  if (location.hash.slice(1) !== id) location.hash = id;
}

/** Fade a view in, as the results do after the first files load. */
function fadeIn(id: ViewId) {
  const el = document.querySelector<HTMLElement>(`.view[data-view="${id}"]`);
  if (!el) return;
  el.classList.remove('fade-in');
  void el.offsetWidth;
  el.classList.add('fade-in');
  el.addEventListener('animationend', () => el.classList.remove('fade-in'), { once: true });
}

/** Where the policy or a page was opened from: the back arrow (and the policy's cog) return there. */
let previous: ViewId | undefined;

/** The initial state: the loader, or with files loaded the view they open on (Issues), from the top. */
export function goHome() {
  previous = undefined;
  goTo(store.get().files.length ? 'issues' : 'files');
}

/** Back to the view the policy or page was opened from. */
export function goBack() {
  goTo(previous && !ASIDE.includes(previous) ? previous : store.get().files.length ? 'issues' : 'files');
}

/** Open the severity policy, or, when it is open, go back to the view it was opened from. */
export function togglePolicy() {
  if (current !== 'policy') return goTo('policy');
  goBack();
}

function show(id: ViewId) {
  if (id !== current && ASIDE.includes(id) && !ASIDE.includes(current)) previous = current;
  document.body.classList.toggle('page-only', PAGES.includes(id));
  for (const el of document.querySelectorAll<HTMLElement>('[data-only-on]')) el.hidden = !el.dataset.onlyOn!.split(' ').includes(id);
  for (const el of document.querySelectorAll<HTMLElement>('.view')) el.hidden = el.dataset.view !== id;
  for (const a of document.querySelectorAll<HTMLElement>('[data-nav], [data-nav-to]')) {
    if (a.dataset.navTo) {
      a.setAttribute('aria-pressed', String(a.dataset.navTo === id));
      continue;
    }
    if (a.dataset.nav === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.querySelector('.workspace')?.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
  current = id;
}

let current: ViewId = 'files';

type View = Pick<AppState, 'files' | 'model' | 'themes' | 'activeTheme' | 'themeModels' | 'loadErrors' | 'paletteOverrides' | 'settings' | 'pairEdits'>;
type Tone = 'error' | 'warning' | 'info';

/** The severest of `tones`, if any. */
const severest = (tones: Iterable<string>): Tone | undefined => {
  const all = new Set(tones);
  return all.has('error') ? 'error' : all.has('warning') ? 'warning' : all.has('info') ? 'info' : undefined;
};

export class TTNav extends HTMLElement {
  private unsub?: () => void;
  private onHash = () => show(resolve(requested(), store.get().files.length > 0));

  connectedCallback() {
    window.addEventListener('hashchange', this.onHash);
    let hadFiles = false;
    this.unsub = store.select(
      (s): View => s,
      (v) => {
        const has = v.files.length > 0;
        this.render(v);
        // First files loaded from the Files view: move on to the results.
        if (has && !hadFiles && current === 'files' && requested() === 'files') {
          const first = resolve('issues', true);
          goTo(first);
          fadeIn(first);
        }
        else show(resolve(requested(), has));
        hadFiles = has;
      },
      (a, b) =>
        a.files === b.files &&
        a.model === b.model &&
        a.themes === b.themes &&
        a.activeTheme === b.activeTheme &&
        a.themeModels === b.themeModels &&
        a.loadErrors === b.loadErrors &&
        a.paletteOverrides === b.paletteOverrides &&
        a.pairEdits === b.pairEdits &&
        a.settings === b.settings,
    );
  }

  disconnectedCallback() {
    this.unsub?.();
    window.removeEventListener('hashchange', this.onHash);
  }

  private render(v: View) {
    const has = v.files.length > 0;
    // The Issues label and badge sum up the same findings as the cards on top of that view.
    const found = has ? findings(store.get()) : undefined;
    const issueCount = found ? findingTotal(found) : 0;
    const issueTone: Tone | undefined = !found || !issueCount ? undefined : severest(Object.values(findingTones(found)).filter((t): t is Tone => t !== undefined));
    const included = has ? palettesOf(store.get()).palettes.filter((p) => p.included) : [];
    const pairs = has ? pairsOf(store.get()) : undefined;
    /** The count and tone for one tier's pairs view: the severest of its contrast, CVD and status-color failures, by the policy. */
    const tierCount = (tier: 'semantic' | 'component') => {
      const rows = pairs?.rows.filter((r) => r.tier === tier) ?? [];
      if (!rows.length) return undefined;
      const tone = severest([
        ...rows.filter((r) => !r.pass).map((r) => r.tone),
        ...rows.filter((r) => r.cvdFails.length).map((r) => r.cvdTone),
        ...(pairs?.siblings.filter((g) => g.tier === tier && siblingFails(g)).map((g) => g.tone!) ?? []),
      ]);
      return { n: rows.length, tone };
    };
    // Each count is led by the severest indication active in that view.
    const counts: Partial<Record<ViewId, { n: number; tone?: Tone }>> = has
      ? {
          files: { n: v.files.length, tone: v.loadErrors.length ? 'error' : undefined },
          themes: v.themes.length ? { n: v.themes.length, tone: severest(v.themeModels.flatMap((m) => m.model.issues.map((i) => i.severity))) } : undefined,
          issues: { n: issueCount, tone: issueTone },
          colors: { n: included.length, tone: severest(included.flatMap((p) => p.flags.map((f) => f.severity))) },
          semantic: tierCount('semantic'),
          components: tierCount('component'),
          tokens: { n: v.model.tokens.size },
        }
      : {};

    // Tier views take the names the files use for their layers (`Primitives tier`).
    const tiers = has ? tierNames(v.model) : undefined;
    const label = (d: ViewDef): HTMLElement => {
      if (d.id === 'issues' && has) return h('span', null, issueCount ? `${plural(issueCount, 'issue')} found` : 'No issues found');
      const tier = { colors: 'base', semantic: 'semantic', components: 'component' } as const;
      const t = tiers && tier[d.id as keyof typeof tier];
      return t ? masked(h('span', null, `${tiers[t]} tier`)) : h('span', null, d.label);
    };

    const items = VIEWS.map((d) => {
      const clean = d.id === 'issues' && has && issueCount === 0;
      const disabled = d.soon || (d.needsFiles && !has);
      const c = counts[d.id];
      // The issue count is in the label, so the badge shows only its severity, or a check when there are none.
      const badge = clean
        ? h('span', { class: 'count ok', 'aria-label': 'none' }, icon('check'))
        : d.id === 'issues' && c?.tone
          ? h('span', { class: `count ${c.tone}`, 'aria-label': c.tone }, severityIcon(c.tone))
          : c && (c.n > 0 || c.tone)
            ? h('span', { class: `count${c.tone ? ` ${c.tone}` : ''}`, 'aria-label': c.tone ? `${c.n}, ${c.tone}` : undefined }, c.tone ? severityIcon(c.tone) : null, c.n > 0 ? String(c.n) : null)
            : null;
      return h(
        'a',
        {
          class: `nav-item${d.soon ? ' soon' : ''}`,
          href: disabled ? undefined : `#${d.id}`,
          'data-nav': d.id,
          'aria-disabled': disabled ? 'true' : undefined,
          'aria-current': d.id === current ? 'page' : undefined,
          'data-tip': d.tip,
        },
        label(d),
        d.soon ? h('span', { class: 'soon-tag' }, 'Soon') : badge,
      );
    });

    this.replaceChildren(
      h('nav', { class: 'nav', 'aria-label': 'Sections' }, items.slice(0, RESULT_VIEWS), h('div', { class: 'nav-sep', role: 'separator' }), items.slice(RESULT_VIEWS)),
      h('div', { class: 'nav-checks' }, this.themePicker(v)),
      has ? this.loopActions(v) : '',
    );
  }

  /**
   * Closing the loop: the fixed file set to take back, and a prompt listing
   * what is still to fix, for an AI assistant or a ticket.
   */
  private loopActions(v: View) {
    const edited = v.files.filter((f) => !isUnchanged(f));
    const save = h(
      'button',
      {
        type: 'button',
        disabled: !edited.length,
        'data-tip': edited.length ? TIP.downloadUpdated : TIP.downloadUpdatedNone,
        // The whole set as received, edited or not, with CHANGES.md: one zip, so the browser doesn't block extra downloads.
        onclick: () => download(`${FIXED_FOLDER}.zip`, fixedSet(store.get(), undefined, openLines(findings(store.get()))), 'application/zip'),
      },
      icon('download'),
      h('span', null, v.files.length === 1 ? 'Get fixed file' : 'Get fixed files'),
    );
    const copy = h(
      'button',
      {
        type: 'button',
        class: 'primary-neutral',
        'data-tip': TIP.copyFixPrompt,
        onclick: async () => {
          const { text, count } = fixPrompt(store.get());
          const label = copy.lastElementChild!;
          try {
            await navigator.clipboard.writeText(text || 'No corrections needed: every check passes.');
            label.textContent = count ? `Copied ${plural(count, 'correction')}` : 'Nothing to fix';
          } catch {
            label.textContent = 'Copy failed';
          }
          setTimeout(() => (label.textContent = 'Copy fix prompt'), 1800);
        },
      },
      icon('copy'),
      h('span', null, 'Copy fix prompt'),
    );
    // Nothing left to fix: the reward in place of the prompt; the fixed set stays if anything was fixed here.
    // Nothing left to fix: no prompt; what was fixed here is the one way out, made prominent.
    if (allClear(store.get())) return edited.length ? (save.classList.add('primary-neutral'), h('div', { class: 'nav-actions' }, save)) : '';
    // The prompt is the main way out: it works whether or not anything was fixed here.
    return h('div', { class: 'nav-actions' }, copy, save);
  }

  /** Active theme, shown wherever results depend on it. Theme names come from the files, so the picker is masked. */
  private themePicker(v: View) {
    if (v.themes.length < 2) return '';
    const select = h(
      'select',
      { id: 'tt-theme-pick', 'data-tip': TIP.themePick },
      h('option', { value: ALL_THEMES, selected: v.activeTheme === ALL_THEMES }, 'All themes'),
      v.themes.map((t) => h('option', { value: t.id, selected: t.id === v.activeTheme }, t.name)),
    );
    select.addEventListener('change', () => setActiveTheme(select.value));
    return h('div', { class: 'theme-pick' }, h('label', { for: 'tt-theme-pick' }, 'Theme'), masked(select));
  }
}
