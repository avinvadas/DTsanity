import { ALL_THEMES, setActiveTheme, store, type AppState } from '../state/app';
import { pairsOf, siblingFails } from '../state/pairs';
import { palettesOf } from '../state/palettes';
import { targetToggles } from './contrast';
import { download, exportAs, isUnchanged } from '../io/export';
import { fixPrompt } from '../io/prompt';
import { tierNames } from '../model/tiers';
import { h, icon, masked, plural, severityIcon } from './dom';
import { TIP } from './tips';

/**
 * Sidebar navigation and view switching. One view is shown at a time; the
 * current one is kept in the URL hash (view names only, never token data) so
 * the back button and reloads work.
 */

export type ViewId = 'files' | 'themes' | 'issues' | 'colors' | 'semantic' | 'components' | 'tokens' | 'privacy';

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

const isView = (v: string): v is ViewId => VIEWS.some((d) => d.id === v) || v === 'privacy';

function requested(): ViewId {
  const id = location.hash.slice(1);
  return isView(id) ? id : 'files';
}

/** With nothing to show, the Issues view is disabled: results open on the base tier instead. */
const noIssues = () => store.get().model.issues.length === 0;

/** The view that can actually be shown for a request, given what is loaded. */
function resolve(id: ViewId, hasFiles: boolean): ViewId {
  const def = VIEWS.find((d) => d.id === id);
  if (def?.soon) return hasFiles ? resolve('issues', hasFiles) : 'files';
  if (def?.needsFiles && !hasFiles) return 'files';
  if (id === 'issues' && noIssues()) return 'colors';
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

function show(id: ViewId) {
  for (const el of document.querySelectorAll<HTMLElement>('.view')) el.hidden = el.dataset.view !== id;
  for (const a of document.querySelectorAll<HTMLElement>('[data-nav]')) {
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
    const errors = v.model.issues.filter((i) => i.severity === 'error').length;
    const warnings = v.model.issues.filter((i) => i.severity === 'warning').length;
    const included = has ? palettesOf(store.get()).palettes.filter((p) => p.included) : [];
    const pairs = has ? pairsOf(store.get()) : undefined;
    /** The count and tone for one tier's pairs view: red for failing text, amber for UI or CVD failures. */
    const tierCount = (tier: 'semantic' | 'component') => {
      const rows = pairs?.rows.filter((r) => r.tier === tier) ?? [];
      if (!rows.length) return undefined;
      const failing = rows.filter((r) => !r.pass);
      const cvd = rows.some((r) => r.cvdFails.length) || (pairs?.siblings.some((g) => g.tier === tier && siblingFails(g)) ?? false);
      const tone: Tone | undefined = failing.some((r) => r.pair.kind === 'text') ? 'error' : failing.length || cvd ? 'warning' : undefined;
      return { n: rows.length, tone };
    };
    // Each count is led by the severest indication active in that view.
    const counts: Partial<Record<ViewId, { n: number; tone?: Tone }>> = has
      ? {
          files: { n: v.files.length, tone: v.loadErrors.length ? 'error' : undefined },
          themes: v.themes.length ? { n: v.themes.length, tone: severest(v.themeModels.flatMap((m) => m.model.issues.map((i) => i.severity))) } : undefined,
          issues: { n: errors + warnings, tone: severest(v.model.issues.map((i) => i.severity)) },
          colors: { n: included.length, tone: severest(included.flatMap((p) => p.flags.map((f) => f.severity))) },
          semantic: tierCount('semantic'),
          components: tierCount('component'),
          tokens: { n: v.model.tokens.size },
        }
      : {};

    // Tier views take the names the files use for their layers (`Primitives tier`).
    const tiers = has ? tierNames(v.model) : undefined;
    const issueCount = v.model.issues.length;
    const label = (d: ViewDef): HTMLElement => {
      if (d.id === 'issues' && has) return h('span', null, issueCount ? `${plural(issueCount, 'issue')} found` : 'No issues found');
      const tier = { colors: 'base', semantic: 'semantic', components: 'component' } as const;
      const t = tiers && tier[d.id as keyof typeof tier];
      return t ? masked(h('span', null, `${tiers[t]} tier`)) : h('span', null, d.label);
    };

    const items = VIEWS.map((d) => {
      const clean = d.id === 'issues' && has && issueCount === 0;
      const disabled = d.soon || (d.needsFiles && !has) || clean;
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
      h('div', { class: 'nav-checks' }, this.themePicker(v), this.contrastPicker(v)),
      has ? this.loopActions(v) : '',
    );
  }

  /**
   * Closing the loop: the edited files to take back, and a prompt listing
   * what is still to fix, for an AI assistant or a ticket.
   */
  private loopActions(v: View) {
    const edited = v.files.filter((f) => !isUnchanged(f));
    const save = h(
      'button',
      {
        type: 'button',
        class: 'primary-neutral',
        disabled: !edited.length,
        'data-tip': edited.length ? TIP.downloadUpdated : TIP.downloadUpdatedNone,
        onclick: () => edited.forEach((f) => download(f.name, exportAs(f).text)),
      },
      icon('download'),
      h('span', null, edited.length === 1 ? 'Download updated file' : edited.length ? `Download ${edited.length} updated files` : 'Download updated files'),
    );
    const copy = h(
      'button',
      {
        type: 'button',
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
    return h('div', { class: 'nav-actions' }, save, copy);
  }

  /** Contrast targets: a global setting, so it sits in the sidebar rather than moving from view to view. */
  private contrastPicker(v: View) {
    return h('div', { class: 'contrast-pick', role: 'group', 'aria-labelledby': 'tt-contrast-label' }, h('span', { class: 'pick-label', id: 'tt-contrast-label' }, 'Contrast'), targetToggles(v.settings));
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
