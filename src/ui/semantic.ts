import { formatContrast } from '../contrast/metrics';
import { simulate, VISIONS, type Vision } from '../color/cvd';
import { distance, type ColorInfo } from '../color/format';
import { TIER_LABEL, tierNames, tierReadings, type Tier } from '../model/tiers';
import type { Model, Severity } from '../model/types';
import { aliasCandidates, checkColors, colorRef, colorSlot, glyphOf, parse, pointColor, tokenColor, hasRole, words, type AliasCandidate, type ContrastLevel, type PairKind } from '../semantic/pairs';
import { addPair, allModels, applyEdits, removePair, resetPairs, setPairKind, store, updateSettings, type AppState } from '../state/app';
import { pairsOf, siblingFails, type PairRow, type SiblingRow } from '../state/pairs';
import { caseCanvas, displayGamut, paintAll } from './canvas';
import { collapsible, setAll } from './collapsible';
import { viewControls } from './loader';
import { h, icon, masked, plural, severityIcon, viewHead, type Child } from './dom';
import { TIP } from './tips';
import { swatchSelect } from './swatch-select';
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
  /** The vision type the samples are drawn and measured with. Typical until picked. */
  private vision: Vision = 'normal';
  /** The component filter text. */
  private query = '';
  /** A re-alias popover to open again after the pick that re-rendered the view. */
  private keepOpen?: string;
  /** How to open each re-alias popover of the current render, by pair id and side. */
  private reopeners = new Map<string, () => void>();
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
            this.visionSelect(),
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

  /** The vision type the samples show: a dropdown led by an eye, at the toolbar's end. */
  private visionSelect() {
    return h(
      'span',
      { class: 'vision-pick', 'data-tip': TIP.visionPick },
      swatchSelect({
        label: 'Vision type',
        groups: [{ label: '', options: VISIONS.map((x) => ({ value: x.id, label: x.short, title: x.label, lead: () => icon('eye') })) }],
        value: this.vision,
        gamut: 'srgb',
        mask: false,
        class: 'vision-select',
        onPick: (value) => {
          this.vision = value as Vision;
          this.render(store.get());
        },
      }),
    );
  }

  /**
   * The pairs as combinations: one row per case (the tokens named alike, as `bg.neutral`,
   * `text.neutral`, `icon.neutral`, `border.neutral`). The Roles column stacks its tokens from the
   * bottom up, as they layer: background, border, foreground (icons), content (text); a role the
   * case has no token for is left out. Beside it, one sample per theme draws what is tokenized,
   * with each part's result. Each token keeps its own check: content at the text level, foreground
   * and border at the UI level. The Roles column stays put; the themes scroll beside it.
   */
  private table(rows: PairRow[], themeNames: (string | null)[], v: View) {
    type Part = 'text' | 'icon' | 'border';
    const partOf = (r: PairRow): Part => ({ text: 'text', border: 'border', ui: 'icon' } as const)[glyphOf(r.pair)];
    const fails = (r: PairRow) => !r.pass || r.cvdFails.length > 0;
    interface Case {
      key: string;
      bg: string;
      parts: Partial<Record<Part, PairRow>>;
    }
    // Content and foreground by their case and the background they sit on; a border joins its case's row,
    // as it is checked against what surrounds a shape rather than on a fill of its own.
    const cases: Case[] = [];
    const place = (r: PairRow, part: Part, find: (c: Case) => boolean) => {
      const at = cases.find((c) => find(c) && !c.parts[part]);
      if (at) at.parts[part] = r;
      else cases.push({ key: parse(r.pair.fg).key, bg: r.pair.bg, parts: { [part]: r } });
    };
    const borders: PairRow[] = [];
    for (const r of rows) {
      const part = partOf(r);
      if (part === 'border') borders.push(r);
      else place(r, part, (c) => c.key === parse(r.pair.fg).key && c.bg === r.pair.bg);
    }
    for (const r of borders) {
      const key = parse(r.pair.fg).key;
      place(r, 'border', (c) => c.key === key && (parse(c.bg).key === key || !cases.some((x) => x.key === key && parse(x.bg).key === key && !x.parts.border)));
    }
    const firstAt = new Map<string, number>();
    cases.forEach((c, i) => firstAt.has(c.key) || firstAt.set(c.key, i));
    const ordered = cases.map((c, i) => ({ c, i })).sort((a, b) => firstAt.get(a.c.key)! - firstAt.get(b.c.key)! || a.i - b.i).map((x) => x.c);
    const shown = this.onlyFailing ? ordered.filter((c) => Object.values(c.parts).some((r) => r && fails(r))) : ordered;

    const gamut = displayGamut(v.settings.gamut);
    const LABEL: Record<Part, string> = { text: 'Content', icon: 'Foreground', border: 'Border' };
    // The roles from the top down: content, foreground, border, then the background they all sit on.
    const ORDER: Part[] = ['text', 'icon', 'border'];
    const item = (role: Part | 'bg', name: Child[]) => h('div', { class: 'role-line' }, h('span', { class: `role-glyph ${role}`, 'aria-hidden': 'true' }, roleGlyph(role)), name);
    const roles = (c: Case) => {
      const own = Object.values(c.parts).find((r) => r && r.pair.bg === c.bg) ?? Object.values(c.parts).find(Boolean)!;
      return h(
        'td',
        { class: 'roles-cell' },
        ORDER.flatMap((part) => {
          const r = c.parts[part];
          if (!r) return [];
          const [button, pop] = this.realiasButton(r, 'fg', v, { tone: fails(r) ? (r.pass ? r.cvdTone : r.tone) : undefined });
          return [item(part, [button as HTMLElement, pop as HTMLElement, this.tierTag(r.tiers.fg, r.pair.fg)])];
        }),
        item('bg', [...(this.realiasButton(own, 'bg', v, {}) as HTMLElement[]), own.pair.source === 'user' ? h('small', { class: 'added', 'data-tip': TIP.pairAdded }, 'added') : null, this.tierTag(own.tiers.bg, c.bg)]),
      );
    };
    const sample = (c: Case, i: number) => {
      // As seen with the vision type picked: the colors simulated, and each part measured as seen.
      const seenAs = this.vision;
      const present = ORDER.flatMap((part) => (c.parts[part]?.seen[seenAs][i] ? [{ part, r: c.parts[part]!, check: c.parts[part]!.seen[seenAs][i]! }] : []));
      if (!present.length) return h('td', { class: 'case-sample' }, h('span', { class: 'muted', 'data-tip': TIP.pairMissing }, '—'));
      // The case's background as its content or foreground sees it; a border alone shows on the one it is checked against.
      const bg = (present.find((x) => x.part !== 'border') ?? present[0]!).check.bg;
      const shownPart = (part: Part) => present.find((x) => x.part === part)?.check.shown;
      return h(
        'td',
        { class: 'case-sample' },
        caseCanvas(bg, { text: shownPart('text'), icon: shownPart('icon'), border: shownPart('border') }, gamut),
        h(
          'div',
          { class: 'case-results' },
          present.map(({ part, r, check }) => {
            const first = check.results[0];
            // With typical vision, a pass that fails with a deficiency says which; with a deficiency picked, the result is that one's.
            const cvd = seenAs === 'normal' && check.pass ? VISIONS.filter(({ id }) => id !== 'normal' && r.seen[id][i] && !r.seen[id][i]!.pass) : [];
            const tone = seenAs === 'normal' ? r.tone : r.cvdTone;
            const cls = check.pass ? (cvd.length ? 'miss warning' : 'pass') : `miss ${tone}`;
            const face = [
              check.pass ? (cvd.length ? severityIcon('warning') : icon('check')) : severityIcon(tone),
              h('span', { class: 'case-part' }, LABEL[part]),
              first ? h('span', { class: 'case-value' }, formatContrast(first.value, first.level.metric)) : null,
              cvd.length ? h('small', { class: 'cvd-miss', 'data-tip': TIP.pairCvdMiss }, cvd.map((x) => x.short).join(', ')) : null,
            ];
            // A line with a problem opens its token's fix, for this theme.
            if (!check.pass || cvd.length) return this.realiasButton(r, 'fg', v, { face, cls: `case-result ${cls}`, theme: i });
            return h('span', { class: `case-result ${cls}`, 'data-tip': first ? `${LABEL[part]}: ${first.level.label}, passes` : undefined }, face);
          }),
        ),
      );
    };
    return masked(
      h(
        'div',
        { class: 'table-wrap roles-wrap' },
        h(
          'table',
          { class: 'pairs roles' },
          h('thead', null, h('tr', null, h('th', { class: 'roles-head' }, 'Roles'), themeNames.map((n) => h('th', { class: 'case-theme' }, n ?? 'Sample')))),
          h('tbody', null, shown.map((c) => h('tr', null, roles(c), themeNames.map((_, i) => sample(c, i))))),
        ),
      ),
    );
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
    const candidates = aliasCandidates(model, id);
    const pick = (target: string) => {
      const edit = pointColor(model, id, target, mode);
      if (!edit) return;
      before?.();
      applyEdits(`Point ${id} at ${target}${theme ? ` in ${theme}` : ''}`, [edit]);
    };
    // A raw value's first fix: the base color nearest to it, one click away.
    const nearest = own
      ? candidates
          .flatMap((g) => g.tokens)
          .map((cand) => ({ cand, d: distance(cand.info, fallback) }))
          .sort((a, b) => a.d - b.d)[0]
      : undefined;
    const field = tokenField({
      label: `${theme ?? ''} reference of ${id}`.trim(),
      groups: candidates.map((g) => ({
        label: g.label,
        options: g.tokens.map((cand) => ({ value: cand.id, label: cand.id, meta: meta(cand), info: cand.info })),
      })),
      ...(own ? {} : { value: slot.target }),
      shown: { label: slot.target ?? 'Raw value', info: fallback },
      ...(worst ? { status: worst } : {}),
      gamut: displayGamut(v.settings.gamut),
      ...(own ? { tip: TIP.pairOwnValue } : {}),
      onPick: pick,
    });
    const suggest = nearest
      ? h(
          'button',
          { type: 'button', class: 'small nearest-btn', 'data-tip': TIP.pairNearest, onclick: () => pick(nearest.cand.id) },
          'Point at ',
          masked(h('span', { class: 'token-id' }, nearest.cand.id)),
          nearest.d < 0.002 ? ' (the same color)' : ` (ΔE ${nearest.d.toFixed(3)})`,
          meta(nearest.cand) ? h('small', { class: 'muted' }, ` · ${meta(nearest.cand)}`) : null,
        )
      : null;
    return h('div', { class: 'alias-side' }, h('span', { class: 'label' }, label), field, suggest, h('small', { class: 'muted', 'data-tip': TIP.pairRealiasFile }, `in ${file ?? 'its file'}`));
  }

  /**
   * The re-alias button beside a pair's foreground or background name. It
   * opens a popover with the token's reference in each theme; each option
   * shows the contrast it would give this pair, and whether that holds with
   * every color-vision deficiency. The popover stays open across picks.
   */
  private realiasButton(r: PairRow, role: 'fg' | 'bg', v: View, item?: { tone?: string; face?: Child[]; cls?: string; theme?: number }) {
    const key = `${r.pair.id}|${role}${item?.theme !== undefined ? `|${item.theme}` : ''}`;
    const id = r.pair[role];
    const label = role === 'fg' ? 'Foreground' : 'Background';
    // As a token item (the cases table): the token's name on a small button, in its alert's color; else the bare token icon.
    const button = item?.face
      ? h('button', { type: 'button', class: `${item.cls ?? ''} realias-btn`, 'aria-haspopup': 'dialog', 'aria-label': `Fix ${id}`, 'data-tip': TIP.pairFixHere }, item.face)
      : item
      ? h('button', { type: 'button', class: `role-item realias-btn${item.tone ? ` ${item.tone}` : ''}`, 'aria-haspopup': 'dialog', 'aria-label': `Re-alias ${id}`, 'data-tip': TIP.realias }, masked(h('span', { class: 'role-name' }, id)), icon('token'))
      : h('button', { type: 'button', class: 'ghost small realias-btn', 'aria-haspopup': 'dialog', 'aria-label': `Re-alias ${id}`, 'data-tip': TIP.realias }, icon('token'));
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
        h('div', { class: 'realias-head' }, h('strong', null, id), h('span', { class: 'muted' }, ` ${label.toLowerCase()} of `, role === 'fg' ? r.pair.bg : r.pair.fg, item?.theme !== undefined && names[item.theme] ? ` · in ${names[item.theme]}` : '')),
        h(
          'div',
          { class: 'realias-themes' },
          allModels(store.get()).map((model, i) => {
            // Opened from one theme's result: that theme only.
            if (item?.theme !== undefined && i !== item.theme) return '';
            const c = r.seen.normal[i];
            if (!c) return h('div', { class: 'alias-side' }, h('span', { class: 'label' }, names[i] ?? label), h('span', { class: 'muted' }, 'This pair is not in this theme'));
            return this.aliasField(model, id, names[i] ?? label, names[i] ?? null, role === 'fg' ? c.fg : c.bg, (cand) => {
              const level = store.get().themeModels[i]?.theme.contrast;
              return role === 'fg' ? meta(cand.info, c.bg, level) : meta(c.fg, cand.info, level);
            }, v, () => (this.keepOpen = key), c.pass || r.tone === 'info' ? undefined : r.tone, ownMode(i, id));
          }),
        ),
        h('p', { class: 'hint' }, `Each option shows its contrast against the ${role === 'fg' ? 'background' : 'foreground'} and whether it still passes with every color-vision deficiency (CVD). Only the reference changes; ⌘Z undoes it.`),
        // The pair's own actions, from its token: the level it is checked at, and removing it.
        item && role === 'fg'
          ? h(
              'div',
              { class: 'realias-actions' },
              glyphOf(r.pair) === 'border'
                ? null
                : h('button', { type: 'button', class: 'ghost small', 'data-tip': TIP.pairKind, onclick: () => (pop.hidePopover(), setPairKind(r.pair.id, r.pair.kind === 'text' ? 'ui' : 'text')) }, r.pair.kind === 'text' ? 'Check as UI' : 'Check as text'),
              h('button', { type: 'button', class: 'ghost small danger', 'data-tip': TIP.pairRemove, onclick: () => (pop.hidePopover(), removePair(r.pair.id)) }, 'Remove pair'),
            )
          : '',
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

/** The small mark before each role in a combination: a diamond for the background (filled) and the border (outline), an almond for content and foreground. */
function roleGlyph(role: 'text' | 'icon' | 'border' | 'bg'): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 10');
  svg.setAttribute('class', 'role-svg');
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  const diamond = 'M8 1 L15 5 L8 9 L1 5 Z';
  const almond = 'M1 5 Q8 -1 15 5 Q8 11 1 5 Z';
  if (role === 'bg') add('path', { d: diamond, fill: 'currentColor' });
  else if (role === 'border') add('path', { d: diamond, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3' });
  else {
    add('path', { d: almond, fill: 'none', stroke: 'currentColor', 'stroke-width': '1', opacity: '0.55' });
    if (role === 'icon') add('circle', { cx: '8', cy: '5', r: '1.8', fill: 'currentColor' });
    else add('path', { d: 'M6 3.2 L10.5 5 L6 6.8 Z', fill: 'currentColor' });
  }
  return svg;
}
