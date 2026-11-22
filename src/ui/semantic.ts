import { formatContrast } from '../contrast/metrics';
import { simulate, VISIONS } from '../color/cvd';
import { distance, type ColorInfo } from '../color/format';
import { TIER_LABEL, tierNames, tierReadings, type Tier } from '../model/tiers';
import type { Model, Severity } from '../model/types';
import { aliasCandidates, checkColors, colorRef, colorSlot, glyphOf, parse, pointColor, tokenColor, hasRole, words, type AliasCandidate, type ContrastLevel, type PairCheck, type PairKind } from '../semantic/pairs';
import { addPair, allModels, applyEdits, removePair, resetPairs, setPairKind, store, updateSettings, type AppState } from '../state/app';
import { pairsOf, siblingFails, type PairRow, type SiblingRow } from '../state/pairs';
import { caseCanvas, displayGamut, paintAll, pairCanvas, swatchCanvas } from './canvas';
import { collapsible, disclosure, expand, isOpen, setAll } from './collapsible';
import { viewControls } from './loader';
import { h, icon, masked, plural, severityIcon, viewHead, xButton, type Child } from './dom';
import { TIP } from './tips';
import { tokenField, type FieldStatus, type TokenOption } from './token-field';
import { typographySection } from './typography';
import { diagnosisFor } from './blocked';

const KINDS: { id: PairKind; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'ui', label: 'UI part' },
];

type View = Pick<AppState, 'model' | 'themeModels' | 'themes' | 'pairEdits' | 'settings'>;

/** How a failing pair is marked: text that can't be read is an error, a faint UI part a warning. */
/** The severity a group of failures shows at: the policy's, the same for every row of a kind. */
const toneOf = (tones: readonly Severity[]): Severity => tones[0] ?? 'warning';
/** A count of failures in the view's summary, marked with their severity. */
const chip = (tone: Severity, tip: string | undefined, text: string) => h('span', { class: `chip ${tone}`, 'data-tip': tip }, severityIcon(tone), text);

/**
 * The mode a theme's pick should be written to so it changes that theme
 * alone: the theme's mode, when the token's value there is the plain
 * `$value` that another theme reads too. Undefined when the theme's value is
 * already its own (its own mode entry, or a file only it reads).
 */
function ownMode(i: number, id: string): string | undefined {
  const s = store.get();
  const mode = s.themeModels[i]?.theme.scope.mode;
  const t = s.themeModels[i]?.model.tokens.get(id);
  if (mode === undefined || !t || t.valuePath.join('.') !== '$value') return undefined;
  const shared = s.themeModels.some((tm, j) => {
    const o = tm.model.tokens.get(id);
    return j !== i && o?.fileId === t.fileId && o.valuePath.join('.') === '$value';
  });
  return shared ? mode : undefined;
}

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
  private reload = viewControls();
  /** Failing pairs only. Undefined until the user picks: then failing ones first, when there are any. */
  private onlyFailingChoice: boolean | undefined;
  private onlyFailing = true;
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
    this.onlyFailing = this.onlyFailingChoice ?? anyFail.length > 0;
    const shown = this.onlyFailing ? anyFail : rows;
    const targets = v.settings.contrast;
    const themeNames = v.themeModels.length ? v.themeModels.map((m) => m.theme.name) : [null];

    // Why there are no pairs, or fewer than the files hold, and where that is handled.
    const diag = diagnosisFor(this.tier, rows.length, component ? 'No component pairs to show' : 'No pairs to show');
    this.replaceChildren(
      viewHead(masked(h('span', null, `${tierNames(v.model)[component ? 'component' : 'semantic']} tier`)), {
        summary: [
          h('span', { class: 'n' }, plural(rows.length, 'pair')),
          failText ? chip(toneOf(failing.filter((r) => r.pair.kind === 'text').map((r) => r.tone)), TIP.pairFailText, `${failText} text failing`) : null,
          failUi ? chip(toneOf(failing.filter((r) => r.pair.kind === 'ui').map((r) => r.tone)), TIP.pairFailUi, `${failUi} UI failing`) : null,
          failCvd ? chip(toneOf(rows.map((r) => r.cvdTone)), TIP.pairFailCvd, `${failCvd} failing with CVD`) : null,
          failSiblings ? chip(toneOf(siblings.flatMap((g) => g.tone ?? [])), TIP.siblingsFail, `${plural(failSiblings, 'status group')} too close`) : null,
          rows.length && !anyFail.length && !failSiblings && targets.length ? h('span', { class: 'badge ok' }, icon('check'), ' All pass') : null,
        ],
        actions: this.reload.el,
      }),
      diag.line ?? '',
      // The short version; the full one, with what is and isn't a pair, is on How DTsanity works.
      h(
        'p',
        { class: 'meta tier-intro' },
        component ? 'Component tokens are one component’s limited scope use. ' : 'Pairs are found from token names. ',
        'Each pair is checked in every theme and fails if it fails in any.',
        h('span', { class: 'foot-sep', 'aria-hidden': 'true' }, ' · '),
        h('a', { href: component ? '#principles/component-pairs' : '#principles/pairs' }, 'How DTsanity works'),
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
                [true, `Failing (${anyFail.length})`],
                [false, `All (${rows.length})`],
              ].map(([value, label]) =>
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'radio',
                    class: this.onlyFailing === value ? 'on' : '',
                    'aria-checked': String(this.onlyFailing === value),
                    onclick: () => {
                      this.onlyFailingChoice = value as boolean;
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
        : diag.empty
          ? diag.empty
          : component
          ? h('p', { class: 'empty' }, 'No component pairs found. Component tokens are read from a components group or file, or from names that start with a component, such as button.primary.bg or card.content.')
          : this.noPairs(colorIds),
      ...(component && rows.length
        ? [this.componentSections(rows, siblings, themeNames, v)]
        : [
            shown.length ? this.table(rows, themeNames, v) : rows.length ? h('p', { class: 'empty' }, 'Every pair passes.') : '',
            rows.length ? this.visionTable(rows, themeNames, v) : '',
            siblings.length ? this.siblingsPanel(siblings, themeNames, v) : '',
          ]),
      typographySection(this.tier, this.onlyFailing, v.model.issues) ?? '',
      colorIds.length ? this.addForm(colorIds) : '',
    );
    requestAnimationFrame(() => paintAll(this));
    if (this.keepOpen) {
      const reopen = this.reopeners.get(this.keepOpen);
      this.keepOpen = undefined;
      reopen?.();
    }
  }

  /**
   * The pairs as cases, flat: one row per case (the tokens named alike, as `bg.neutral`,
   * `text.neutral`, `icon.neutral`, `border.neutral`), its background, content, icon and border side
   * by side, then one sample per theme with all of them together and each one's result. Each token
   * keeps its own check: content at the text level, icon and border at the UI level, each against
   * the background it is paired with (a border against what surrounds the shape). A case shows when
   * any of its parts fails, with failing only.
   */
  private table(rows: PairRow[], themeNames: (string | null)[], v: View) {
    type Col = 'text' | 'icon' | 'border';
    const COLS: { id: Col; label: string; tip: string }[] = [
      { id: 'text', label: 'Content', tip: TIP.pairColText },
      { id: 'icon', label: 'Icon', tip: TIP.pairColIcon },
      { id: 'border', label: 'Border', tip: TIP.pairColBorder },
    ];
    const colOf = (r: PairRow): Col => ({ text: 'text', border: 'border', ui: 'icon' } as const)[glyphOf(r.pair)];
    const fails = (r: PairRow) => !r.pass || r.cvdFails.length > 0;
    interface Case {
      key: string;
      bg: string;
      parts: Partial<Record<Col, PairRow>>;
    }
    // Content and icons by their case and the background they sit on; a border joins its case's row,
    // as it is checked against what surrounds a shape rather than on a fill of its own.
    const cases: Case[] = [];
    const place = (r: PairRow, col: Col, find: (c: Case) => boolean) => {
      const at = cases.find((c) => find(c) && !c.parts[col]);
      if (at) at.parts[col] = r;
      else cases.push({ key: parse(r.pair.fg).key, bg: r.pair.bg, parts: { [col]: r } });
    };
    const borders: PairRow[] = [];
    for (const r of rows) {
      const col = colOf(r);
      if (col === 'border') borders.push(r);
      else place(r, col, (c) => c.key === parse(r.pair.fg).key && c.bg === r.pair.bg);
    }
    for (const r of borders) {
      const key = parse(r.pair.fg).key;
      // The case's own background first, then any row of the case, then the background it is checked on.
      place(r, 'border', (c) => c.key === key && (parse(c.bg).key === key || !cases.some((x) => x.key === key && parse(x.bg).key === key && !x.parts.border)));
    }
    // The order cases first appear in, with a case's rows together.
    const firstAt = new Map<string, number>();
    cases.forEach((c, i) => firstAt.has(c.key) || firstAt.set(c.key, i));
    const ordered = cases.map((c, i) => ({ c, i })).sort((a, b) => firstAt.get(a.c.key)! - firstAt.get(b.c.key)! || a.i - b.i).map((x) => x.c);
    const shown = this.onlyFailing ? ordered.filter((c) => Object.values(c.parts).some((r) => r && fails(r))) : ordered;
    // A column no case has a token in is left out.
    const cols = COLS.filter((col) => shown.some((c) => c.parts[col.id]));

    const gamut = displayGamut(v.settings.gamut);
    const token = (r: PairRow | undefined, col: Col) => {
      if (!r) return h('td', { class: 'role-cell empty pin', 'data-col': cols.findIndex((c) => c.id === col) + 1 });
      const other: PairKind = r.pair.kind === 'text' ? 'ui' : 'text';
      const td = h(
        'td',
        { class: `role-cell pin${fails(r) ? ` fail ${r.pass ? r.cvdTone : r.tone}` : ''}`, 'data-col': cols.findIndex((c) => c.id === col) + 1 },
        h('span', { class: 'token-id token-cell' }, breakable(r.pair.fg, this.realiasButton(r, 'fg', v))),
        this.tierTag(r.tiers.fg, r.pair.fg),
        h(
          'span',
          { class: 'role-actions' },
          col === 'border' ? null : h('button', { type: 'button', class: 'ghost small', 'data-tip': TIP.pairKind, onclick: () => setPairKind(r.pair.id, other) }, other === 'text' ? 'Check as text' : 'Check as UI'),
          xButton('Remove pair', () => removePair(r.pair.id), TIP.pairRemove),
        ),
      );
      this.rowEls.set(r.pair.id, td);
      return td;
    };
    const LABEL: Record<Col, string> = { text: 'Content', icon: 'Icon', border: 'Border' };
    const sample = (c: Case, i: number) => {
      const checks = cols.map((col) => ({ col: col.id, r: c.parts[col.id], check: c.parts[col.id]?.seen.normal[i] }));
      const present = checks.filter((x) => x.check);
      if (!present.length) return h('td', { class: 'case-sample' }, h('span', { class: 'muted', 'data-tip': TIP.pairMissing }, '—'));
      // The case's background as its content or icon sees it; a border alone shows on the one it is checked against.
      const bg = (present.find((x) => x.col !== 'border') ?? present[0]!).check!.bg;
      const part = (col: Col) => checks.find((x) => x.col === col)?.check?.shown;
      return h(
        'td',
        { class: 'case-sample' },
        caseCanvas(bg, { text: part('text'), icon: part('icon'), border: part('border') }, gamut),
        h(
          'div',
          { class: 'case-results' },
          present.map(({ col, r, check }) => {
            const first = check!.results[0];
            const cvd = check!.pass ? VISIONS.filter(({ id }) => id !== 'normal' && r!.seen[id][i] && !r!.seen[id][i]!.pass) : [];
            return h(
              'span',
              { class: check!.pass ? (cvd.length ? 'miss warning' : 'pass') : `miss ${r!.tone}`, 'data-tip': first ? `${LABEL[col]}: ${first.level.label}, ${check!.pass ? 'passes' : 'fails'}` : undefined },
              check!.pass ? (cvd.length ? severityIcon('warning') : icon('check')) : severityIcon(r!.tone),
              h('small', null, LABEL[col]),
              first ? ` ${formatContrast(first.value, first.level.metric)}` : '',
              cvd.length ? h('small', { class: 'cvd-miss', 'data-tip': TIP.pairCvdMiss }, ` ${cvd.map((x) => x.short).join(', ')}`) : null,
            );
          }),
        ),
      );
    };
    const wrap = h(
      'div',
      { class: 'table-wrap roles-wrap', 'data-last-col': cols.length },
      h(
        'table',
        { class: 'pairs roles' },
          h('thead', null, h('tr', null, h('th', { class: 'pin', 'data-col': 0 }, 'Background'), cols.map((c, i) => h('th', { class: 'pin', 'data-col': i + 1, 'data-tip': c.tip }, c.label)), themeNames.map((n) => h('th', { class: 'case-theme' }, n ?? 'Sample')))),
          h(
            'tbody',
            null,
            shown.map((c) => {
              const any = Object.values(c.parts).find(Boolean)!;
              const own = Object.values(c.parts).find((r) => r && r.pair.bg === c.bg) ?? any;
              return h(
                'tr',
                null,
                h(
                  'td',
                  { class: 'token-id role-bg pin', 'data-col': 0 },
                  h('span', { class: 'token-cell' }, breakable(c.bg, own.pair.source === 'user' ? h('small', { class: 'added', 'data-tip': TIP.pairAdded }, ' added') : null, this.realiasButton(own, 'bg', v))),
                  this.tierTag(own.tiers.bg, c.bg),
                ),
                cols.map((col) => token(c.parts[col.id], col.id)),
                themeNames.map((_, i) => sample(c, i)),
              );
            }),
          ),
      ),
    );
    // The token columns stay put; the theme samples scroll sideways under them, one theme at a time.
    // Laid out when the box gets its size or changes it, again a frame later and once the fonts are in, as names measure differently before.
    const layout = () => {
      pinColumns(wrap);
      requestAnimationFrame(() => pinColumns(wrap));
    };
    new ResizeObserver(layout).observe(wrap);
    void document.fonts?.ready.then(layout);
    return masked(wrap);
  }

  /**
   * A picker that points an alias token at another existing token, in the
   * file and mode `model` reads it from. `meta` describes what each option
   * would give. Tokens with their own value, or missing here, say so instead.
   */
  private aliasField(model: Model, id: string, label: string, theme: string | null, fallback: ColorInfo, meta: (cand: AliasCandidate) => string | undefined, v: View, before?: () => void, status?: FieldStatus, mode?: string) {
    const t = model.tokens.get(id);
    if (!t) return h('div', { class: 'alias-side' }, h('span', { class: 'label' }, label), h('span', { class: 'muted' }, 'Not in this theme'));
    const slot = colorSlot(t);
    if (!slot) {
      // A border that aliases a whole other border takes its color from there.
      const why = t.aliasOf ? `Takes its color from ${t.aliasOf}` : 'Copied in by $extends';
      return h('div', { class: 'alias-side' }, h('span', { class: 'label' }, label), h('span', { class: 'muted', 'data-tip': t.aliasOf ? TIP.pairBorderAlias : TIP.pairOwnValue }, why));
    }
    const own = slot.target === undefined;
    // The worst of: the pair failing here, an issue on the token, a value of its own.
    const issues = v.model.issues.filter((i) => i.target === id && i.severity !== 'info');
    const worst: FieldStatus | undefined =
      status === 'error' || issues.some((i) => i.severity === 'error') ? 'error' : status || issues.length || own ? 'warning' : undefined;
    const file = store.get().files.find((f) => f.id === t.fileId)?.name;
    const field = tokenField({
      label: `${theme ?? ''} reference of ${id}`.trim(),
      groups: aliasCandidates(model, id).map((g) => ({
        label: g.label,
        options: g.tokens.map((cand) => ({ value: cand.id, label: cand.id, meta: meta(cand), info: cand.info })),
      })),
      ...(own ? {} : { value: slot.target }),
      shown: { label: slot.target ?? 'Raw value', info: fallback },
      ...(worst ? { status: worst } : {}),
      gamut: displayGamut(v.settings.gamut),
      ...(own ? { tip: TIP.pairOwnValue } : {}),
      onPick: (target) => {
        const edit = pointColor(model, id, target, mode);
        if (!edit) return;
        before?.();
        applyEdits(`Point ${id} at ${target}${theme ? ` in ${theme}` : ''}`, [edit]);
      },
    });
    return h('div', { class: 'alias-side' }, h('span', { class: 'label' }, label), field, h('small', { class: 'muted', 'data-tip': TIP.pairRealiasFile }, `in ${file ?? 'its file'}`));
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
    // At the level of the theme the option is for: enhanced in a high-contrast theme.
    const meta = (fg: ColorInfo, bg: ColorInfo, level?: ContrastLevel) => {
      const check = checkColors(fg, bg, r.pair.kind, targets, level);
      const first = check.results[0];
      if (!first) return undefined;
      const cvd = VISIONS.filter((x) => x.id !== 'normal' && !checkColors(simulate(fg, x.id), simulate(bg, x.id), r.pair.kind, targets, level).pass);
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
            return this.aliasField(model, id, names[i] ?? label, names[i] ?? null, role === 'fg' ? c.fg : c.bg, (cand) => {
              const level = store.get().themeModels[i]?.theme.contrast;
              return role === 'fg' ? meta(cand.info, c.bg, level) : meta(c.fg, cand.info, level);
            }, v, () => (this.keepOpen = key), c.pass || r.tone === 'info' ? undefined : r.tone, ownMode(i, id));
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
        c.colors.map((m) => this.aliasField(model, m.id, statusOf(m.id, row.group.id), themeNames[i] ?? null, m.info, meta(m.id), v, undefined, row.tone && row.tone !== 'info' && c.results.some((x) => !x.pass && x.vision !== 'achroma' && x.closest.includes(m.id)) ? row.tone : undefined, ownMode(i, m.id))),
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
          class: `vision-tile${c.pass ? '' : ` miss ${r.tone}`}`,
          title: `${r.pair.fg} on ${r.pair.bg}${value}`,
          'aria-label': `Change aliases of ${r.pair.fg} on ${r.pair.bg}`,
          onclick: () => this.openPair(r),
        },
        pairCanvas(c.shown, c.bg, glyphOf(r.pair), gamut),
        c.pass ? null : severityIcon(r.tone),
      );
    };
    return h(
      'section',
      { class: 'vision' },
      h(compact ? 'h4' : 'h3', { 'data-tip': TIP.vision }, 'Seen with each vision type'),
      compact
        ? null
        : h('p', { class: 'meta' }, 'Every pair above, as seen with each vision type. A mark shows a pair below its level; hover a tile for its tokens, click to go to it.'),
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
            const tone = x.vision === 'achroma' || !row.tone ? 'info' : row.tone;
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
              'Tokens that differ only by a status word (danger, warning, success…) must look different; the two closest in each group are compared per vision type. ',
              'Achromatopsia is only marked as information: pair status colors with an icon or label.',
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
                  { class: [siblingFails(g) ? `fail ${g.tone}` : '', open ? 'open' : ''].join(' ').trim() },
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
          failText ? chip(toneOf(own.filter((r) => !r.pass && r.pair.kind === 'text').map((r) => r.tone)), undefined, `${failText} text`) : null,
          failUi ? chip(toneOf(own.filter((r) => !r.pass && r.pair.kind === 'ui').map((r) => r.tone)), undefined, `${failUi} UI`) : null,
          failCvd ? chip(toneOf(own.map((r) => r.cvdTone)), undefined, `${failCvd} CVD`) : null,
          groupFails ? h('span', { class: 'chip warning' }, severityIcon('warning'), `${plural(groupFails, 'status group')} too close`) : null,
          !failing.length && !groupFails ? h('span', { class: 'badge ok' }, icon('check'), ' Pass') : null,
        ],
        // Built when first opened, so large libraries stay quick.
        content: () => [
          shown.length ? this.table(own, themeNames, v) : h('p', { class: 'empty' }, 'Every pair passes.'),
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
  private tierTag(tier: Tier, id: string) {
    const own = this.tier === 'component' ? 'component' : 'semantic';
    if (tier === own) return null;
    // Why DTsanity read it so: a tier name in the files, or what the token does. The tooltip bubble is masked.
    const reading = allModels(store.get())
      .map((m) => tierReadings(m).get(id))
      .find(Boolean);
    const tip = reading ? `${TIP.tierOther} Read as ${TIER_LABEL[tier].toLowerCase()}: ${reading.why}.` : TIP.tierOther;
    return h('span', { class: `tier-tag ${tier}`, 'data-tip': tip }, TIER_LABEL[tier].toLowerCase());
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
        ? h('p', null, 'All of them have raw values: these are base colors, with no semantic layer of references to pair. Load your semantic files as well (such as semantic.light.json), then press Reload files if you changed them on disk.')
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
      this.onlyFailingChoice = false;
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

  /** Add a pair by hand: two color tokens picked from every theme's color tokens, and a kind. */
  private addForm(colorIds: string[]) {
    const models = allModels(store.get());
    const infoOf = (id: string) => models.map((m) => tokenColor(m.tokens.get(id), m.settings.acceptLegacy)).find(Boolean);
    const gamut = displayGamut(store.get().settings.gamut);
    const groups = (() => {
      const byGroup = new Map<string, TokenOption[]>();
      for (const id of colorIds) {
        const info = infoOf(id);
        if (!info) continue;
        const label = id.split('.').slice(0, -1).join('.') || 'top level';
        byGroup.set(label, [...(byGroup.get(label) ?? []), { value: id, label: id, info }]);
      }
      return [...byGroup].map(([label, options]) => ({ label, options }));
    })();
    const picked: { fg?: string; bg?: string } = {};
    const slot = (role: 'fg' | 'bg', label: string) => {
      const holder = h('span', { class: 'add-pair-field' });
      const draw = () =>
        holder.replaceChildren(
          tokenField({
            // Unique on the page: the semantic and component views each have this form.
            label: `${label} of a new ${this.tier} pair`,
            groups,
            ...(picked[role] ? { value: picked[role] } : {}),
            placeholder: 'Pick a color token',
            gamut,
            onPick: (id) => {
              picked[role] = id;
              message.textContent = '';
              draw();
            },
          }),
        );
      draw();
      return h('div', { class: 'field' }, h('span', null, label), holder);
    };
    const message = h('small', { class: 'hint', role: 'status' });
    const fg = slot('fg', 'Foreground');
    const bg = slot('bg', 'Background');
    const kind = h('select', { 'aria-label': 'Kind' }, KINDS.map((k) => h('option', { value: k.id }, k.label)));
    return h(
      'form',
      {
        class: 'add-pair',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (!picked.fg || !picked.bg) {
            message.textContent = 'Pick both tokens.';
            return;
          }
          if (picked.fg === picked.bg) {
            message.textContent = 'Pick two different tokens.';
            return;
          }
          addPair(picked.fg, picked.bg, kind.value as PairKind);
        },
      },
      h('strong', null, 'Add a pair'),
      h('div', { class: 'row' }, fg, bg, kind, h('button', { type: 'submit' }, 'Add')),
      message,
    );
  }
}

/**
 * Lay out a cases table: the theme columns at one compact width (a sample and its results), the
 * token columns pinned at the left and sized to the room the themes leave. The tokens take their
 * names' natural width when that leaves room for a theme; more room shows more themes, whole ones;
 * with less, the names break onto a second line and one theme shows. The themes scroll, the tokens stay.
 */
function pinColumns(wrap: HTMLElement) {
  const head = [...wrap.querySelectorAll<HTMLElement>('thead th.pin')];
  const themes = wrap.querySelectorAll('thead th.case-theme').length;
  const room = wrap.clientWidth;
  if (!head.length || !room) return;
  // A theme column's width as laid out (set in rem in the styles).
  const theme = wrap.querySelector('thead th.case-theme')?.getBoundingClientRect().width || 128;
  // The names' natural widths, measured on one line and unsized.
  wrap.classList.add('measuring');
  head.forEach((th) => (th.style.width = ''));
  wrap.querySelector<HTMLElement>('table')?.style.removeProperty('width');
  const natural = head.map((th) => th.getBoundingClientRect().width);
  wrap.classList.remove('measuring');
  const sum = natural.reduce((a, b) => a + b, 0);
  const fit = Math.max(1, Math.min(themes, Math.floor((room - sum) / theme)));
  const tokens = Math.max(room - fit * theme, head.length * 96);
  // Each token column first gets about half its natural width (its names on two lines), then a share of
  // the rest by how much more it would take; the table is laid out at exactly these widths.
  // The cell's padding and the name's picker don't shrink with the name: about 48px of each width.
  const need = natural.map((n) => Math.ceil(Math.max(0, n - 48) * 0.55 + 48));
  const needSum = need.reduce((a, b) => a + b, 0);
  const widths =
    tokens >= needSum
      ? natural.map((n, i) => Math.floor(need[i]! + ((tokens - needSum) * (n - need[i]!)) / Math.max(1, sum - needSum)))
      : natural.map((n) => Math.floor((tokens * n) / sum));
  head.forEach((th, i) => (th.style.width = `${widths[i]}px`));
  const table = wrap.querySelector<HTMLElement>('table');
  if (table) table.style.width = `${widths.reduce((a, b) => a + b, 0) + themes * theme}px`;
  const lefts: number[] = [];
  let x = 0;
  head.forEach((th) => {
    lefts.push(x);
    x += th.getBoundingClientRect().width;
  });
  wrap.querySelectorAll<HTMLElement>('.pin[data-col]').forEach((el) => (el.style.left = `${lefts[Number(el.dataset.col)] ?? 0}px`));
  wrap.style.scrollPaddingLeft = `${x}px`;
}

/**
 * A token name that may break after its dots and dashes, so a long one takes two lines rather than
 * the row's width. What follows it (its picker) stays on the line of its last part.
 */
function breakable(name: string, ...after: Child[]): Node[] {
  const parts = name.split(/(?<=[.\-_])/);
  const last = parts.pop() ?? '';
  return [...parts.flatMap((p) => [document.createTextNode(p), document.createElement('wbr')]), h('span', { class: 'name-end' }, last, ...after)];
}
