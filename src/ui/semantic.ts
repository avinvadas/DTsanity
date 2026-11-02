import { formatContrast } from '../contrast/metrics';
import { simulate, VISIONS } from '../color/cvd';
import { distance, type ColorInfo } from '../color/format';
import { TIER_LABEL, tierNames, type Tier } from '../model/tiers';
import type { Model } from '../model/types';
import { aliasCandidates, checkColors, colorRef, glyphOf, hasRole, realias, words, type AliasCandidate, type PairCheck, type PairKind } from '../semantic/pairs';
import { addPair, allModels, applyEdits, removePair, resetPairs, setPairKind, store, updateSettings, type AppState } from '../state/app';
import { pairsOf, siblingFails, type PairRow, type SiblingRow } from '../state/pairs';
import { displayGamut, paintAll, pairCanvas, swatchCanvas } from './canvas';
import { collapsible, disclosure, expand, isOpen, setAll } from './collapsible';
import { reloadControl } from './loader';
import { swatchSelect } from './swatch-select';
import { h, icon, masked, plural, severityIcon, viewHead } from './dom';
import { TIP } from './tips';

const KINDS: { id: PairKind; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'ui', label: 'UI part' },
];

type View = Pick<AppState, 'model' | 'themeModels' | 'themes' | 'pairEdits' | 'settings'>;

/** How a failing pair is marked: text that can't be read is an error, a faint UI part a warning. */
const failTone = (kind: PairKind) => (kind === 'text' ? 'error' : 'warning');

/** A group member's own part of the name, e.g. "danger" for `color.text.danger` in `color.text.*`. */
const statusOf = (id: string, group: string) => {
  const g = group.split('.');
  return id.split('.').filter((w, i) => g[i] !== w).join('.') || id;
};

/**
 * Foreground/background pairs found by name, each checked for contrast and
 * color-vision deficiencies in every theme. One element per tier: the
 * `tier` attribute picks semantic pairs (the default) or component pairs.
 * Pairs can be removed, re-kinded or added by hand.
 */
export class TTSemantic extends HTMLElement {
  private get tier(): PairRow['tier'] {
    return this.getAttribute('tier') === 'component' ? 'component' : 'semantic';
  }

  private unsub?: () => void;
  private reload = reloadControl(TIP.reload);
  private onlyFailing = false;
  /** The component filter text. */
  private query = '';
  /** A re-alias popover to open again after the pick that re-rendered the view. */
  private keepOpen?: string;
  /** How to open each re-alias popover of the current render, by pair id and side. */
  private reopeners = new Map<string, () => void>();
  /** Pair rows by pair id, for jumping from a vision tile to its pair. */
  private rowEls = new Map<string, HTMLElement>();
  // Canvases painted while the view is hidden have no size: paint again once it shows.
  // When the view is shown it also checks it shows the current files, in case an update was missed.
  private resize = new ResizeObserver(() => (this.rendered === this.inputs() ? paintAll(this) : this.render(store.get())));
  /** The pair inputs the view last rendered, to tell whether it is current. */
  private rendered?: unknown;
  private inputs = () => pairsOf(store.get());

  connectedCallback() {
    this.resize.observe(this);
    this.unsub = store.select(
      (s): View => s,
      () => this.render(store.get()),
      (a, b) => a.model === b.model && a.themeModels === b.themeModels && a.pairEdits === b.pairEdits && a.settings === b.settings,
    );
  }

  disconnectedCallback() {
    this.unsub?.();
    this.reload.unsub();
    this.resize.disconnect();
  }

  private render(v: View) {
    this.reopeners.clear();
    this.rowEls.clear();
    const result = pairsOf(store.get());
    this.rendered = result;
    const { colorIds, edited } = result;
    const rows = result.rows.filter((r) => r.tier === this.tier);
    const siblings = result.siblings.filter((g) => g.tier === this.tier);
    const component = this.tier === 'component';
    const failing = rows.filter((r) => !r.pass);
    const failText = failing.filter((r) => r.pair.kind === 'text').length;
    const failUi = failing.length - failText;
    const failCvd = rows.filter((r) => r.cvdFails.length).length;
    const failSiblings = siblings.filter((g) => siblingFails(g)).length;
    // Failing: with typical vision, or only with a deficiency.
    const anyFail = rows.filter((r) => !r.pass || r.cvdFails.length);
    const shown = this.onlyFailing ? anyFail : rows;
    const targets = v.settings.contrast;
    const themeNames = v.themeModels.length ? v.themeModels.map((m) => m.theme.name) : [null];

    this.replaceChildren(
      viewHead(masked(h('span', null, `${tierNames(v.model)[component ? 'component' : 'semantic']} tier`)), {
        summary: [
          h('span', { class: 'n' }, plural(rows.length, 'pair')),
          failText ? h('span', { class: 'chip error', 'data-tip': TIP.pairFailText }, severityIcon('error'), `${failText} text failing`) : null,
          failUi ? h('span', { class: 'chip warning', 'data-tip': TIP.pairFailUi }, severityIcon('warning'), `${failUi} UI failing`) : null,
          failCvd ? h('span', { class: 'chip warning', 'data-tip': TIP.pairFailCvd }, severityIcon('warning'), `${failCvd} failing with CVD`) : null,
          failSiblings ? h('span', { class: 'chip warning', 'data-tip': TIP.siblingsFail }, severityIcon('warning'), `${plural(failSiblings, 'status group')} too close`) : null,
          rows.length && !anyFail.length && !failSiblings && targets.length ? h('span', { class: 'badge ok' }, icon('check'), ' All pass') : null,
        ],
        actions: this.reload.el,
      }),
      h(
        'p',
        { class: 'meta' },
        component
          ? 'Component tokens are one component’s use of a color, such as button.primary.bg. They are found from layer groups or files (components) or component names (button, input, card…), and each foreground (content, text, fg, border…) is checked on the background of the same component and variant. '
          : 'Pairs are found from token names: a foreground (text, fg, icon, border, on-…) is checked on the background (bg, surface, container…) that shares its other words, such as “danger” or “subtle hover”, or else on the default background. ',
        'Text must reach the text level; icons and borders the level for UI parts. The token icon beside a name points it at another token, theme by theme; only the reference changes, and ⌘Z undoes it.',
        themeNames.length > 1 ? ' Each pair is checked in every theme and fails if it fails in any.' : '',
      ),
      targets.length === 0 ? h('p', { class: 'note' }, 'Pick a contrast target in the sidebar to check the pairs.') : '',
      rows.length
        ? h(
            'div',
            { class: 'toolbar' },
            h(
              'div',
              { class: 'segmented', role: 'radiogroup', 'aria-label': 'Pairs shown' },
              [
                [false, 'All'],
                [true, `Failing (${anyFail.length})`],
              ].map(([value, label]) =>
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'radio',
                    class: this.onlyFailing === value ? 'on' : '',
                    'aria-checked': String(this.onlyFailing === value),
                    onclick: () => {
                      this.onlyFailing = value as boolean;
                      this.render(store.get());
                    },
                  },
                  label as string,
                ),
              ),
            ),
            component ? this.componentTools(v) : null,
            h('span', { class: 'spacer' }),
            edited ? h('button', { type: 'button', class: 'link', 'data-tip': TIP.pairsReset, onclick: resetPairs }, 'Reset to the pairs found by name') : null,
          )
        : component
          ? h('p', { class: 'empty' }, 'No component pairs found. Component tokens are read from a components group or file, or from names that start with a component, such as button.primary.bg or card.content.')
          : this.noPairs(colorIds),
      ...(component && rows.length
        ? [this.componentSections(rows, siblings, themeNames, v)]
        : [
            shown.length ? this.table(shown, themeNames, v) : rows.length ? h('p', { class: 'empty' }, 'Every pair passes.') : '',
            rows.length ? this.visionTable(rows, themeNames, v) : '',
            siblings.length ? this.siblingsPanel(siblings, themeNames, v) : '',
          ]),
      colorIds.length ? this.addForm(colorIds) : '',
    );
    requestAnimationFrame(() => paintAll(this));
    if (this.keepOpen) {
      const reopen = this.reopeners.get(this.keepOpen);
      this.keepOpen = undefined;
      reopen?.();
    }
  }

  private table(rows: PairRow[], themeNames: (string | null)[], v: View) {
    return masked(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'pairs' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, 'Foreground'),
              h('th', null, 'Background'),
              h('th', { 'data-tip': TIP.pairKind }, 'Kind'),
              themeNames.map((n) => h('th', null, n ?? 'Contrast')),
              h('th', null, h('span', { class: 'visually-hidden' }, 'Actions')),
            ),
          ),
          h(
            'tbody',
            null,
            rows.map((r) => {
              const row = h(
                'tr',
                { class: r.pass ? '' : `fail ${failTone(r.pair.kind)}` },
                h(
                  'td',
                  { class: 'token-id' },
                  h('span', { class: 'token-cell' }, r.pair.fg, this.realiasButton(r, 'fg', v)),
                  this.tierTag(r.tiers.fg),
                ),
                h(
                  'td',
                  { class: 'token-id' },
                  h('span', { class: 'token-cell' }, r.pair.bg, r.pair.source === 'user' ? h('small', { class: 'added', 'data-tip': TIP.pairAdded }, ' added') : null, this.realiasButton(r, 'bg', v)),
                  this.tierTag(r.tiers.bg),
                ),
                h('td', null, this.kindSelect(r)),
                r.seen.normal.map((c, i) => h('td', null, this.result(c, r, i, v))),
                h(
                  'td',
                  { class: 'pair-actions' },
                  h('button', { type: 'button', class: 'ghost small danger', 'aria-label': 'Remove pair', 'data-tip': TIP.pairRemove, onclick: () => removePair(r.pair.id) }, '×'),
                ),
              );
              this.rowEls.set(r.pair.id, row);
              return row;
            }),
          ),
        ),
      ),
    );
  }

  /**
   * A picker that points an alias token at another existing token, in the
   * file and mode `model` reads it from. `meta` describes what each option
   * would give. Tokens with their own value, or missing here, say so instead.
   */
  private aliasField(model: Model, id: string, label: string, theme: string | null, fallback: ColorInfo, meta: (cand: AliasCandidate) => string | undefined, v: View, before?: () => void) {
    const t = model.tokens.get(id);
    if (!t) return h('div', { class: 'alias-side' }, h('span', { class: 'label' }, label), h('span', { class: 'muted' }, 'Not in this theme'));
    const ref = colorRef(t);
    if (!ref) {
      // A border that aliases a whole other border takes its color from there.
      const why = t.aliasOf ? `Takes its color from ${t.aliasOf}` : 'Has its own value, not a reference';
      return h('div', { class: 'alias-side' }, h('span', { class: 'label' }, label), h('span', { class: 'muted', 'data-tip': t.aliasOf ? TIP.pairBorderAlias : TIP.pairOwnValue }, why));
    }
    const file = store.get().files.find((f) => f.id === t.fileId)?.name;
    const select = swatchSelect({
      label: `${theme ?? ''} reference of ${id}`.trim(),
      groups: aliasCandidates(model, id).map((g) => ({
        label: g.label,
        options: g.tokens.map((cand) => ({ value: cand.id, label: cand.id, meta: meta(cand), info: cand.info })),
      })),
      value: ref.target,
      gamut: displayGamut(v.settings.gamut),
      fallback: { label: ref.target, info: fallback },
      onPick: (target) => {
        const edit = realias(model, id, target);
        if (!edit) return;
        before?.();
        applyEdits(`Point ${id} at ${target}${theme ? ` in ${theme}` : ''}`, [edit]);
      },
    });
    return h('div', { class: 'alias-side' }, h('span', { class: 'label' }, label), select, h('small', { class: 'muted', 'data-tip': TIP.pairRealiasFile }, `in ${file ?? 'its file'}`));
  }

  /**
   * The re-alias button beside a pair's foreground or background name. It
   * opens a popover with the token's reference in each theme; each option
   * shows the contrast it would give this pair, and whether that holds with
   * every color-vision deficiency. The popover stays open across picks.
   */
  private realiasButton(r: PairRow, role: 'fg' | 'bg', v: View) {
    const key = `${r.pair.id}|${role}`;
    const id = r.pair[role];
    const label = role === 'fg' ? 'Foreground' : 'Background';
    const button = h('button', { type: 'button', class: 'ghost small realias-btn', 'aria-haspopup': 'dialog', 'aria-label': `Re-alias ${id}`, 'data-tip': TIP.realias }, icon('token'));
    const pop = h('div', { class: 'realias-pop', popover: 'auto', role: 'dialog', 'aria-label': `Re-alias ${id}` });
    const targets = v.settings.contrast;
    const meta = (fg: ColorInfo, bg: ColorInfo) => {
      const check = checkColors(fg, bg, r.pair.kind, targets);
      const first = check.results[0];
      if (!first) return undefined;
      const cvd = VISIONS.filter((x) => x.id !== 'normal' && !checkColors(simulate(fg, x.id), simulate(bg, x.id), r.pair.kind, targets).pass);
      return `${formatContrast(first.value, first.level.metric)} ${check.pass ? '✓' : '✗'} · CVD ${cvd.length ? '✗' : '✓'}`;
    };
    const fill = () => {
      const names = v.themeModels.length ? v.themeModels.map((m) => m.theme.name) : [null];
      pop.replaceChildren(
        h('div', { class: 'realias-head' }, h('strong', null, id), h('span', { class: 'muted' }, ` ${label.toLowerCase()} of `, role === 'fg' ? r.pair.bg : r.pair.fg)),
        h(
          'div',
          { class: 'realias-themes' },
          allModels(store.get()).map((model, i) => {
            const c = r.seen.normal[i];
            if (!c) return h('div', { class: 'alias-side' }, h('span', { class: 'label' }, names[i] ?? label), h('span', { class: 'muted' }, 'This pair is not in this theme'));
            return this.aliasField(model, id, names[i] ?? label, names[i] ?? null, role === 'fg' ? c.fg : c.bg, (cand) => (role === 'fg' ? meta(cand.info, c.bg) : meta(c.fg, cand.info)), v, () => (this.keepOpen = key));
          }),
        ),
        h('p', { class: 'hint' }, `Each option shows its contrast against the ${role === 'fg' ? 'background' : 'foreground'} and whether it still passes with every color-vision deficiency (CVD). Only the reference changes; ⌘Z undoes it.`),
      );
    };
    const place = () => {
      const b = button.getBoundingClientRect();
      const below = window.innerHeight - b.bottom;
      const top = below >= pop.offsetHeight + 8 || below >= b.top ? b.bottom + 4 : b.top - 4 - pop.offsetHeight;
      pop.style.top = `${Math.max(8, top)}px`;
      pop.style.left = `${Math.max(8, Math.min(b.left, window.innerWidth - pop.offsetWidth - 8))}px`;
    };
    pop.addEventListener('toggle', (e) => {
      if ((e as ToggleEvent).newState !== 'open') return;
      place();
      paintAll(pop);
    });
    button.addEventListener('click', () => {
      fill();
      pop.togglePopover();
    });
    this.reopeners.set(key, () => {
      fill();
      pop.showPopover();
      pop.querySelector<HTMLElement>('.ss-button')?.focus();
    });
    return [button, masked(pop)];
  }

  /**
   * Point a status group's members at other existing tokens, theme by theme.
   * Each option shows the smallest difference it would leave to the other
   * members, with the worst deficiency (achromatopsia aside).
   */
  private siblingRealiasRow(row: SiblingRow, themeNames: (string | null)[], v: View) {
    const min = v.settings.cvdDistance;
    const theme = (model: Model, i: number) => {
      const c = row.checks[i];
      if (!c) return h('div', { class: 'alias-theme' }, themeNames[i] ? h('strong', null, themeNames[i]) : null, h('span', { class: 'muted' }, 'Fewer than two of these tokens are in this theme.'));
      const meta = (id: string) => (cand: AliasCandidate) => {
        const others = c.colors.filter((m) => m.id !== id);
        const worst = Math.min(
          ...VISIONS.filter((x) => x.id !== 'achroma').flatMap((x) => others.map((o) => distance(simulate(cand.info, x.id), simulate(o.info, x.id)))),
        );
        return `ΔE ${worst.toFixed(3)} ${worst >= min ? '✓' : '✗'}`;
      };
      return h(
        'div',
        { class: 'alias-theme' },
        themeNames[i] ? h('strong', null, themeNames[i]) : null,
        c.colors.map((m) => this.aliasField(model, m.id, statusOf(m.id, row.group.id), themeNames[i] ?? null, m.info, meta(m.id), v)),
      );
    };
    return h(
      'tr',
      { class: 'pair-detail' },
      h(
        'td',
        { colspan: 2 + themeNames.length },
        h('div', { class: 'alias-themes' }, allModels(store.get()).map(theme)),
        h('p', { class: 'hint' }, `Each option shows the smallest difference it would leave to the other members, with the worst color-vision deficiency; ✓ means at least ${min}. Only the reference changes. Undo with ⌘Z.`),
      ),
    );
  }

  private kindSelect(r: PairRow) {
    const select = h(
      'select',
      { 'aria-label': 'Kind', 'data-tip': TIP.pairKind },
      KINDS.map((k) => h('option', { value: k.id, selected: k.id === r.pair.kind }, k.label)),
    );
    select.addEventListener('change', () => setPairKind(r.pair.id, select.value as PairKind));
    return select;
  }

  private result(c: PairCheck | undefined, r: PairRow, theme: number, v: View) {
    if (!c) return h('span', { class: 'muted', 'data-tip': TIP.pairMissing }, '—');
    // With typical vision shown, say which deficiencies this theme's pair fails under.
    const cvd = c.pass ? VISIONS.filter(({ id }) => id !== 'normal' && r.seen[id][theme] && !r.seen[id][theme]!.pass) : [];
    return h(
      'div',
      { class: `pair-result${c.pass ? '' : ' fail'}` },
      pairCanvas(c.shown, c.bg, glyphOf(r.pair), displayGamut(v.settings.gamut)),
      h(
        'div',
        { class: 'pair-values' },
        c.results.map((x) =>
          h(
            'span',
            { class: x.pass ? 'pass' : `miss ${failTone(r.pair.kind)}`, 'data-tip': `${x.level.label}: ${x.pass ? 'passes' : 'fails'}` },
            x.pass ? icon('check') : severityIcon(failTone(r.pair.kind)),
            ` ${formatContrast(x.value, x.level.metric)} `,
            h('small', null, x.level.short),
          ),
        ),
        cvd.length
          ? h('span', { class: 'miss warning cvd-miss', 'data-tip': TIP.pairCvdMiss }, severityIcon('warning'), ` ${cvd.map((x) => x.short).join(', ')}`)
          : null,
      ),
    );
  }

  /**
   * Every pair as seen with each vision type: one row per type, one column per
   * theme, so the effect of each deficiency reads straight down a column.
   */
  private visionTable(rows: PairRow[], themeNames: (string | null)[], v: View, compact = false) {
    const gamut = displayGamut(v.settings.gamut);
    const tile = (r: PairRow, c: PairCheck | undefined) => {
      if (!c) return h('span', { class: 'vision-tile empty', 'data-tip': TIP.pairMissing });
      const first = c.results[0];
      const value = first ? ` · ${formatContrast(first.value, first.level.metric)}` : '';
      return h(
        'button',
        {
          type: 'button',
          class: `vision-tile${c.pass ? '' : ` miss ${failTone(r.pair.kind)}`}`,
          title: `${r.pair.fg} on ${r.pair.bg}${value}`,
          'aria-label': `Change aliases of ${r.pair.fg} on ${r.pair.bg}`,
          onclick: () => this.openPair(r),
        },
        pairCanvas(c.shown, c.bg, glyphOf(r.pair), gamut),
        c.pass ? null : severityIcon(failTone(r.pair.kind)),
      );
    };
    return h(
      'section',
      { class: 'vision' },
      h(compact ? 'h4' : 'h3', { 'data-tip': TIP.vision }, 'Seen with each vision type'),
      compact
        ? null
        : h('p', { class: 'meta' }, 'Every pair above, in the same order, as seen with typical vision and with each color-vision deficiency. A mark shows a pair that falls below its level as seen that way. Hover a tile for its tokens; click it to go to the pair.'),
      masked(
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'pairs vision-table' },
            h('thead', null, h('tr', null, h('th', null, 'Vision'), themeNames.map((n) => h('th', null, n ?? 'Pairs')))),
            h(
              'tbody',
              null,
              VISIONS.map((x) =>
                h(
                  'tr',
                  null,
                  h('th', { scope: 'row' }, h('span', null, x.short), h('small', null, x.label)),
                  themeNames.map((_, i) => h('td', null, h('div', { class: 'vision-strip' }, rows.map((r) => tile(r, r.seen[x.id][i]))))),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /** Status colors (danger, warning, success…) that must stay apart, checked under every vision type. */
  private siblingsPanel(groups: SiblingRow[], themeNames: (string | null)[], v: View, compact = false) {
    const gamut = displayGamut(v.settings.gamut);
    const min = h('input', { type: 'number', min: '0.02', max: '0.5', step: '0.01', value: String(v.settings.cvdDistance), 'aria-label': 'Minimum difference' });
    min.addEventListener('change', () => {
      const n = Number(min.value);
      if (n > 0 && n <= 1) updateSettings({ cvdDistance: n });
    });
    const cell = (row: SiblingRow, i: number) => {
      const c = row.checks[i];
      if (!c) return h('td', null, h('span', { class: 'muted', 'data-tip': TIP.pairMissing }, '—'));
      return h(
        'td',
        null,
        h(
          'div',
          { class: 'sibling-rows' },
          c.results.map((x) => {
            const tone = x.vision === 'achroma' ? 'info' : 'warning';
            const name = VISIONS.find((d) => d.id === x.vision)!;
            return h(
              'div',
              { class: `sibling-row ${x.pass ? 'pass' : `miss ${tone}`}`, title: `${name.label}: closest are ${x.closest[0]} and ${x.closest[1]}` },
              h('span', { class: 'vision-name' }, name.short),
              h(
                'span',
                { class: 'sibling-swatches' },
                c.colors.map((m) => h('span', { class: 'sibling-swatch', title: m.id }, swatchCanvas(simulate(m.info, x.vision), gamut, false))),
              ),
              h('span', { class: 'sibling-diff' }, x.pass ? icon('check') : severityIcon(tone), ` ${x.distance.toFixed(3)}`),
            );
          }),
        ),
      );
    };
    return h(
      'section',
      { class: 'siblings' },
      h(compact ? 'h4' : 'h3', null, 'Status colors told apart'),
      compact
        ? null
        : [
            h(
              'p',
              { class: 'meta' },
              'Tokens whose names differ only in a status word (danger, warning, success, info…) must look different. The two closest in each group are compared under each vision type, as an OKLab difference. ',
              'Achromatopsia is rare and only marked as information: where status relies on color alone, pair it with an icon or a label.',
            ),
            h('label', { class: 'field inline', 'data-tip': TIP.cvdDistance }, 'Minimum difference ', min),
          ],
      masked(
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'pairs siblings-table' },
            h('thead', null, h('tr', null, h('th', null, 'Group'), themeNames.map((n) => h('th', null, n ?? 'Difference')), h('th', null, h('span', { class: 'visually-hidden' }, 'Actions')))),
            h(
              'tbody',
              null,
              groups.flatMap((g) => {
                const key = `group:${g.group.id}`;
                const open = isOpen(key, false);
                const row = h(
                  'tr',
                  { class: [siblingFails(g) ? 'fail warning' : '', open ? 'open' : ''].join(' ').trim() },
                  h('td', { class: 'token-id' }, g.group.id.replace(/\.\*$/, ''), h('small', { class: 'added' }, ` ${g.group.members.length} statuses`)),
                  themeNames.map((_, i) => cell(g, i)),
                  h(
                    'td',
                    { class: 'pair-actions' },
                    disclosure({ key, open: false, label: `re-alias panel of ${g.group.id}`, text: 'Re-alias', tip: TIP.siblingRealias, onToggle: () => this.render(store.get()) }),
                  ),
                );
                return open ? [row, this.siblingRealiasRow(g, themeNames, v)] : [row];
              }),
            ),
          ),
        ),
      ),
    );
  }

  /** Components view: find a component, expand or collapse all sections, and the status difference threshold. */
  private componentTools(v: View) {
    const find = h('input', { type: 'search', class: 'component-find', placeholder: 'Find a component or token', 'aria-label': 'Find a component or token', value: this.query });
    find.addEventListener('input', () => {
      this.query = find.value;
      this.applyQuery();
    });
    const all = (open: boolean) => () => setAll(this, open);
    const min = h('input', { type: 'number', min: '0.02', max: '0.5', step: '0.01', value: String(v.settings.cvdDistance), 'aria-label': 'Minimum status difference' });
    min.addEventListener('change', () => {
      const n = Number(min.value);
      if (n > 0 && n <= 1) updateSettings({ cvdDistance: n });
    });
    return [
      masked(find),
      h('button', { type: 'button', class: 'ghost small', onclick: all(true) }, 'Expand all'),
      h('button', { type: 'button', class: 'ghost small', onclick: all(false) }, 'Collapse all'),
      h('label', { class: 'field inline', 'data-tip': TIP.cvdDistance }, 'Status difference ', min),
    ];
  }

  /** Show only the component sections whose component or token names contain the filter text. */
  private applyQuery() {
    const q = this.query.trim().toLowerCase();
    let visible = 0;
    for (const d of this.querySelectorAll<HTMLElement>('.component-section')) {
      const match = !q || d.dataset.search!.includes(q);
      d.hidden = !match;
      if (match) visible++;
    }
    const none = this.querySelector<HTMLElement>('.no-component-match');
    if (none) none.hidden = visible > 0;
  }

  /**
   * One collapsible section per component, each with its pairs, its vision
   * rows and its status groups. Sections with failures start open; with more
   * than five components the others start closed.
   */
  private componentSections(rows: PairRow[], siblings: SiblingRow[], themeNames: (string | null)[], v: View) {
    const names = [...new Set([...rows.map((r) => r.component!), ...siblings.map((g) => g.component!)])].sort((a, b) => a.localeCompare(b));
    const many = names.length > 5;
    const fails = (r: PairRow) => !r.pass || r.cvdFails.length > 0;
    const sections = names.flatMap((name) => {
      const own = rows.filter((r) => r.component === name);
      const groups = siblings.filter((g) => g.component === name);
      const failing = own.filter(fails);
      const groupFails = groups.filter((g) => siblingFails(g)).length;
      if (this.onlyFailing && !failing.length && !groupFails) return [];
      const shown = this.onlyFailing ? failing : own;
      const failText = own.filter((r) => !r.pass && r.pair.kind === 'text').length;
      const failUi = own.filter((r) => !r.pass && r.pair.kind === 'ui').length;
      const failCvd = own.filter((r) => r.pass && r.cvdFails.length).length;
      const search = [name, ...own.flatMap((r) => [r.pair.fg, r.pair.bg]), ...groups.flatMap((g) => g.group.members)].join(' ').toLowerCase();
      const section = collapsible({
        key: `component:${name}`,
        open: !many || failing.length + groupFails > 0,
        variant: 'row',
        class: 'component-section',
        attrs: { 'data-component': name, 'data-search': search },
        summary: [
          h('h3', { class: 'component-name' }, name),
          h('span', { class: 'meta' }, plural(own.length, 'pair')),
          failText ? h('span', { class: 'chip error' }, severityIcon('error'), `${failText} text`) : null,
          failUi ? h('span', { class: 'chip warning' }, severityIcon('warning'), `${failUi} UI`) : null,
          failCvd ? h('span', { class: 'chip warning' }, severityIcon('warning'), `${failCvd} CVD`) : null,
          groupFails ? h('span', { class: 'chip warning' }, severityIcon('warning'), `${plural(groupFails, 'status group')} too close`) : null,
          !failing.length && !groupFails ? h('span', { class: 'badge ok' }, icon('check'), ' Pass') : null,
        ],
        // Built when first opened, so large libraries stay quick.
        content: () => [
          shown.length ? this.table(shown, themeNames, v) : h('p', { class: 'empty' }, 'Every pair passes.'),
          own.length ? this.visionTable(own, themeNames, v, true) : '',
          groups.length ? this.siblingsPanel(groups, themeNames, v, true) : '',
        ],
        onToggle: (open) => open && requestAnimationFrame(() => paintAll(section)),
      });
      return [section];
    });
    const wrap = masked(h('div', { class: 'component-sections' }, sections, h('p', { class: 'empty no-component-match', hidden: true }, 'No component or token matches.')));
    requestAnimationFrame(() => this.applyQuery());
    return wrap;
  }

  /**
   * Marks a token from another tier than the view's: in Components, a
   * semantic or base token paired with a component one; in Semantic, a base
   * token used as a background.
   */
  private tierTag(tier: Tier) {
    const own = this.tier === 'component' ? 'component' : 'semantic';
    return tier === own ? null : h('span', { class: `tier-tag ${tier}`, 'data-tip': TIP.tierOther }, TIER_LABEL[tier].toLowerCase());
  }

  /** Why no pairs were found: what is loaded, and which semantic tokens lack a foreground or background word. */
  private noPairs(colorIds: string[]) {
    const s = store.get();
    const tokens = allModels(s).flatMap((m) => [...m.tokens.values()]);
    const refs = [...new Set(tokens.filter((t) => colorIds.includes(t.id) && colorRef(t)).map((t) => t.id))];
    const unnamed = refs.filter((id) => !hasRole(words(id)));
    const files = s.files.length;
    return h(
      'div',
      { class: 'empty no-pairs' },
      h(
        'p',
        null,
        h('strong', null, 'No pairs found. '),
        `${plural(files, 'file')} loaded (`,
        masked(h('span', { class: 'token-id' }, s.files.map((f) => f.name).join(', '))),
        `), with ${plural(colorIds.length, 'color token')}.`,
      ),
      refs.length === 0
        ? h('p', null, 'All of them have their own values: these are base colors, with no semantic layer of references to pair. Load your semantic files as well (such as semantic.light.json), then press Reload files if you changed them on disk.')
        : h(
            'p',
            null,
            `${plural(refs.length, 'token')} ${refs.length === 1 ? 'is a reference' : 'are references'}, but none is named with a foreground or background word (text, fg, icon, border, on-… / bg, surface, container…)`,
            unnamed.length ? [': ', masked(h('span', { class: 'token-id' }, unnamed.slice(0, 6).join(', '), unnamed.length > 6 ? ` and ${unnamed.length - 6} more` : ''))] : null,
            '. Add pairs below to check them anyway.',
          ),
    );
  }

  /** Bring a pair's row into view and highlight it, with focus on its first picker. */
  private openPair(r: PairRow) {
    if (this.onlyFailing && r.pass && !r.cvdFails.length) {
      this.onlyFailing = false;
      this.render(store.get());
    }
    let row = this.rowEls.get(r.pair.id);
    if (!row && r.component) {
      // Its section hasn't been opened yet, so its rows aren't built: open it.
      const section = this.querySelector<HTMLDetailsElement>(`.component-section[data-component="${CSS.escape(r.component)}"]`);
      if (section) expand(section);
      row = this.rowEls.get(r.pair.id);
    }
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    row.querySelector<HTMLElement>('.realias-btn')?.focus({ preventScroll: true });
  }

  private addForm(colorIds: string[]) {
    const listId = `tt-color-ids-${this.tier}`;
    const list = masked(h('datalist', { id: listId }, colorIds.map((id) => h('option', { value: id }))));
    const field = (label: string, id: string) =>
      h('label', { class: 'field' }, h('span', null, label), masked(h('input', { type: 'text', id, list: listId, autocomplete: 'off', spellcheck: 'false', placeholder: 'color token' })));
    const fg = field('Foreground', `tt-pair-fg-${this.tier}`);
    const bg = field('Background', `tt-pair-bg-${this.tier}`);
    const kind = h('select', { 'aria-label': 'Kind' }, KINDS.map((k) => h('option', { value: k.id }, k.label)));
    const message = h('small', { class: 'hint', role: 'status' });
    const known = new Set(colorIds);
    return h(
      'form',
      {
        class: 'add-pair',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const f = fg.querySelector('input')!.value.trim();
          const b = bg.querySelector('input')!.value.trim();
          const unknown = [f, b].find((id) => !known.has(id));
          if (unknown !== undefined) {
            message.textContent = unknown ? 'Pick color tokens from the list.' : 'Enter both tokens.';
            return;
          }
          if (f === b) {
            message.textContent = 'Pick two different tokens.';
            return;
          }
          addPair(f, b, kind.value as PairKind);
        },
      },
      h('strong', null, 'Add a pair'),
      h('div', { class: 'row' }, fg, bg, kind, h('button', { type: 'submit' }, 'Add')),
      message,
      list,
    );
  }
}
