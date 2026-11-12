import type { Tier } from '../model/tiers';
import type { Issue, Model } from '../model/types';
import { formatPart, orderStyles, partCandidates, PARTS, pointPart, rangeNotes, sizePx, styleCss, typeStyle, typographyIdsIn, type PartKey, type RangeNote, type StylePart, type TypeStyle } from '../semantic/typography';
import { allModels, applyEdits, applyFixes, store } from '../state/app';
import { withPolicy } from '../policy/rules';
import { disclosure, isOpen } from './collapsible';
import { h, masked, plural, severityIcon } from './dom';
import { TIP } from './tips';
import { tokenField, type FieldStatus } from './token-field';

const SAMPLE = 'The quick brown fox jumps over the lazy dog';

/** The control to focus again after the pick that re-rendered the view. */
let refocus: string | undefined;
/** The mode (theme name) the scale shows, by tier. */
const shownMode = new Map<Tier, string>();

const sig = (p: StylePart | undefined) => (p ? (p.ref ? `ref:${p.ref}` : p.literal !== undefined ? `lit:${JSON.stringify(p.literal)}` : 'none') : 'absent');

interface Entry {
  id: string;
  /** The style in each theme, undefined where it is missing. */
  styles: (TypeStyle | undefined)[];
  issues: Issue[];
}

/**
 * Every typography style of a tier as one scale, by hierarchy (display,
 * headings, titles, body, labels, captions; see orderStyles), each line
 * set in its own style. When the styles resolve differently between modes
 * (desktop, mobile…), a switch picks the mode the scale shows. Edit opens a
 * style's parts: the token each one references can be changed to another
 * token of its type. Alerts cover single styles (format, own values) and
 * the range (styles that look the same, sizes too close, text too small).
 */
export function typographySection(tier: Tier, onlyIssues: boolean, issues: readonly Issue[]): HTMLElement | null {
  const s = store.get();
  const models = allModels(s);
  const names = s.themeModels.length ? s.themeModels.map((m) => m.theme.name) : [null];
  const ids = typographyIdsIn(models, tier);
  if (!ids.length) return null;
  const byId = new Map<string, Issue[]>();
  for (const i of issues) {
    if (!i.target) continue;
    const list = byId.get(i.target) ?? [];
    // A style written in several files (light and dark) has the same issue in each: list it once, fixing all of them.
    const twin = list.findIndex((x) => x.code === i.code && x.message === i.message);
    if (twin < 0) byId.set(i.target, [...list, i]);
    else list[twin] = mergeFix(list[twin]!, i);
  }
  const entries: Entry[] = ids.map((id) => ({ id, styles: models.map((m) => (m.tokens.get(id) ? typeStyle(m.tokens.get(id)!, m) : undefined)), issues: byId.get(id) ?? [] }));

  // Modes worth switching between: themes in which some style resolves differently.
  const differs = models.length > 1 && entries.some((e) => new Set(e.styles.filter(Boolean).map((st) => JSON.stringify(st!.value ?? null))).size > 1);
  const modes = differs ? names.map((n, i) => ({ name: n ?? `Theme ${i + 1}`, i })) : [];
  const host = h('section', { class: 'type-styles' });

  const draw = () => {
    const pick = modes.find((m) => m.name === shownMode.get(tier)) ?? modes[0];
    const at = pick?.i ?? 0;
    const shown = entries.flatMap((e) => (e.styles[at] ? [{ e, st: e.styles[at]! }] : []));
    const notes = withPolicy(rangeNotes(shown.map(({ st }) => st)), store.get().settings.policy, (n) => `type-${n.code}`);
    const notesOf = (id: string) => notes.filter((n) => n.ids.includes(id));
    const ownValue = (e: Entry) => tier !== 'base' && e.styles.some((st) => !st?.inherited && st?.parts.some((p) => p.literal !== undefined));
    const flagged = (e: Entry) => e.issues.length > 0 || ownValue(e) || notesOf(e.id).length > 0;
    const rows = orderStyles(shown.map((x) => ({ ...x, id: x.e.id, order: x.st.token.order, px: x.st.value ? (sizePx(x.st.value.fontSize) ?? -1) : -1 }))).filter((x) => !onlyIssues || flagged(x.e));
    const counts = { styles: shown.filter(({ e }) => e.issues.length || ownValue(e)).length, range: notes.length };
    host.replaceChildren(
      h(
        'div',
        { class: 'type-head-row' },
        h('h3', null, 'Typography'),
        counts.styles ? h('span', { class: 'chip warning', 'data-tip': TIP.typeStyleAlerts }, severityIcon('warning'), `${plural(counts.styles, 'style')} to check`) : null,
        counts.range ? h('span', { class: 'chip warning', 'data-tip': TIP.typeRangeAlerts }, severityIcon('warning'), `${plural(counts.range, 'range alert')}`) : null,
        h('span', { class: 'spacer' }),
        modes.length
          ? masked(
              h(
                'div',
                { class: 'segmented', role: 'radiogroup', 'aria-label': 'Mode shown', 'data-tip': TIP.typeMode },
                modes.map((m) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'radio',
                      class: m === pick ? 'on' : '',
                      'aria-checked': String(m === pick),
                      onclick: () => {
                        shownMode.set(tier, m.name);
                        draw();
                      },
                    },
                    m.name,
                  ),
                ),
              ),
            )
          : null,
      ),
      h(
        'p',
        { class: 'meta' },
        `${plural(ids.length, 'typography style')}, by hierarchy from display down to captions, each set in its own style`,
        modes.length ? ` as resolved in ${pick!.name}` : '',
        '. Expand a style for its parts and alerts: point a part at another token; only the reference changes and ⌘Z undoes it.',
      ),
      notes.length ? masked(h('ul', { class: 'type-range' }, notes.map((n) => noteRow(n)))) : '',
      rows.length
        ? masked(h('div', { class: 'type-scale' }, rows.map(({ e, st }) => row(e, st, at, models, names, notesOf(e.id), ownValue(e), tier, draw))))
        : h('p', { class: 'empty' }, 'Every typography style is fine.'),
    );
  };
  draw();
  if (refocus) {
    const key = refocus;
    refocus = undefined;
    requestAnimationFrame(() => [...host.querySelectorAll<HTMLElement>('[data-focus]')].find((el) => el.dataset.focus === key)?.focus());
  }
  return host;
}

/** One issue standing for two identical ones, with both fixes' edits applied together. */
function mergeFix(a: Issue, b: Issue): Issue {
  if (!a.fix || !b.fix || !('edits' in a.fix) || !('edits' in b.fix)) return a;
  return { ...a, fix: { ...a.fix, edits: [...a.fix.edits, ...b.fix.edits] } };
}

/** One line of the scale: the sample in its style, a summary of its values, its alerts, and the edit panel when open. */
function row(e: Entry, st: TypeStyle, at: number, models: Model[], names: (string | null)[], notes: RangeNote[], ownValue: boolean, tier: Tier, redraw: () => void) {
  const key = `type|${tier}|${e.id}`;
  const open = isOpen(key, false);
  const v = st.value;
  const sample = v ? h('p', { class: 'type-specimen', title: SAMPLE }, SAMPLE) : h('p', { class: 'muted type-broken', 'data-tip': TIP.typeBroken }, 'A reference in this style doesn’t resolve, so it can’t be shown.');
  if (v) Object.assign(sample.style, styleCss(v));
  const worst = e.issues.some((i) => i.severity === 'error') ? 'error' : e.issues.length || notes.length || ownValue ? 'warning' : null;
  const panelId = `type-edit-${tier}-${e.id}`.replace(/[^\w-]/g, '_');
  const toggle = disclosure({ key, label: e.id, open: false, tip: TIP.typeExpand, onToggle: redraw });
  toggle.setAttribute('aria-controls', panelId);
  return h(
    'article',
    { class: `type-row${open ? ' open' : ''}` },
    h(
      'div',
      { class: 'type-row-main' },
      h('div', { class: 'type-row-text' }, sample, h('span', { class: 'token-id' }, e.id)),
      h('span', { class: 'type-row-actions' }, worst && !open ? h('span', { class: `type-flag ${worst}`, role: 'img', 'aria-label': worst === 'error' ? 'Has errors' : 'Has warnings', 'data-tip': TIP.typeRowAlerts }, severityIcon(worst)) : null, toggle),
    ),
    open
      ? h(
          'div',
          { class: 'type-edit', id: panelId },
          h('div', { class: 'type-parts' }, st.aliasOf ? partRows(e.id, undefined, present(e, models, names, at), tier, e.issues) : null, PARTS.map((p) => partRows(e.id, p.key, present(e, models, names, at), tier, e.issues))), worst ? h('ul', { class: 'type-issues' }, e.issues.filter((i) => !namesPart(i)).map((i) => issueRow(i)), notes.map((n) => noteRow(n)), ownValue ? ownRow(st) : null) : null,
        )
      : null,
  );
}

/** The style in every theme it is in, the mode shown first so pickers list values as that mode resolves them. */
function present(e: Entry, models: Model[], names: (string | null)[], at: number) {
  const all = e.styles.flatMap((s, i) => (s ? [{ st: s, model: models[i]!, name: names[i] ?? null }] : []));
  return [...all.filter((p) => p.model === models[at]), ...all.filter((p) => p.model !== models[at])];
}

/** A note on parts written as values of their own, naming them. */
function ownRow(st: TypeStyle) {
  const own = st.parts.filter((p) => p.literal !== undefined).map((p) => PARTS.find((x) => x.key === p.key)!.label.toLowerCase());
  if (!own.length) return null;
  return h('li', { class: 'type-issue warning', 'data-tip': TIP.typeOwnValue }, severityIcon('warning'), h('span', null, `Raw value for ${own.join(', ')}: point ${own.length === 1 ? 'it' : 'them'} at base tokens.`));
}

function noteRow(n: RangeNote) {
  return h('li', { class: `type-issue ${n.severity}`, 'data-tip': TIP.typeRange[n.code] }, severityIcon(n.severity), h('span', null, n.message));
}

/** A part's label, its reference picker and resolved value: one row, or one per theme when themes write it differently. */
function partRows(id: string, key: PartKey | undefined, present: { st: TypeStyle; model: Model; name: string | null }[], tier: Tier, issues: readonly Issue[]) {
  const label = key ? PARTS.find((p) => p.key === key)!.label : 'Style';
  const partOf = (st: TypeStyle): StylePart | undefined => (key ? st.parts.find((p) => p.key === key) : { key: 'fontFamily', ref: st.aliasOf, value: undefined });
  const groups = new Map<string, typeof present>();
  for (const p of present) groups.set(sig(partOf(p.st)), [...(groups.get(sig(partOf(p.st))) ?? []), p]);
  return [...groups.values()].map((group) => {
    const part = partOf(group[0]!.st)!;
    const theme = groups.size > 1 ? group.map((g) => g.name).join(', ') : null;
    return [
      h('span', { class: 'label' }, label, theme ? h('small', { class: 'type-theme' }, ` ${theme}`) : null),
      picker(id, key, part, group, label, theme, tier, issues),
    ];
  });
}

/**
 * The alert a part's field shows: the worst issue on the style that names
 * this part (`$value.lineHeight …`), or a warning for a value of its own.
 */
/** Whether an issue is about parts of the style (`$value.lineHeight …`): it is then shown under those parts' fields. */
const namesPart = (i: Issue) => i.severity !== 'info' && PARTS.some((p) => i.message.includes(`$value.${p.key}`));

/** The sentences of an issue's message about one part: one issue can cover several parts, a sentence each. */
const sentencesAbout = (i: Issue, key: PartKey) =>
  i.message
    .split(/(?<=\.)\s+(?=\$value\.)/)
    .filter((x) => x.includes(`$value.${key}`))
    .join(' ');

function partStatus(issues: readonly Issue[], key: PartKey | undefined, own: boolean): FieldStatus | undefined {
  const named = key ? issues.filter((i) => i.severity !== 'info' && i.message.includes(`$value.${key}`)) : [];
  if (named.some((i) => i.severity === 'error')) return 'error';
  return named.length || own ? 'warning' : undefined;
}

function picker(id: string, key: PartKey | undefined, part: StylePart, group: { st: TypeStyle; model: Model }[], label: string, theme: string | null, tier: Tier, issues: readonly Issue[]) {
  const model = group[0]!.model;
  const editable = group.every((g) => g.st.editable);
  const inherited = group.some((g) => g.st.inherited) && key !== undefined;
  const focusKey = `${id}|${key ?? ''}|${theme ?? ''}`;
  const cands = partCandidates(model, id, key);
  const point = (target: string) => {
    const edits = pointPart(
      group.map((g) => g.model),
      id,
      key,
      target,
    );
    if (!edits.length) return;
    refocus = focusKey;
    applyEdits(`Point ${id}${key ? ` ${key}` : ''} at ${target}${theme ? ` in ${theme}` : ''}`, edits);
  };
  const same = part.literal !== undefined ? cands.flatMap((g) => g.tokens.filter((c) => c.same)) : [];
  const own = part.literal !== undefined && tier !== 'base' && !inherited;
  const field = tokenField({
    label: `${label} of ${id}${theme ? ` in ${theme}` : ''}`,
    groups: cands.map((g) => ({ label: g.label, options: g.tokens.map((c) => ({ value: c.id, label: c.id, ...(key ? { meta: `${formatPart(c.value)}${c.same ? ' (same value)' : ''}` } : {}) })) })),
    ...(part.ref ? { value: part.ref } : {}),
    shown: part.ref
      ? { label: key ? `${part.ref} · ${formatPart(part.value)}` : part.ref, group: key && tier === 'semantic' ? 'Current · not a base token' : 'Current' }
      : { label: part.literal !== undefined ? `Raw value · ${formatPart(part.literal)}` : 'Not set' },
    status: partStatus(issues, key, own),
    tip: !editable ? TIP.typeExtended : inherited ? TIP.typeInherited : TIP.typePart,
    disabled: !editable,
    focusKey,
    onPick: point,
  });
  const uses = editable ? same.slice(0, 2).map((c) => h('button', { type: 'button', class: 'small', 'data-tip': TIP.typeUseSame, onclick: () => point(c.id) }, `Use ${c.id}`)) : [];
  // Fixes sit beside the field; messages about it sit beneath it.
  const about = key ? issues.filter((i) => namesPart(i) && i.message.includes(`$value.${key}`)) : [];
  const fixes = about.flatMap((i) => (i.fix ? [h('button', { type: 'button', class: 'small', onclick: () => applyFixes([i.fix!]) }, i.fix.label)] : []));
  return h(
    'span',
    { class: 'type-pick' },
    h('span', { class: 'field-row' }, field, fixes, uses),
    about.map((i) => h('span', { class: `field-note ${i.severity}` }, severityIcon(i.severity), h('span', { class: 'field-note-text' }, sentencesAbout(i, key!)))),
    own ? h('span', { class: 'field-note' }, h('span', { class: 'tag warn', 'data-tip': TIP.typeOwnValue }, 'raw value')) : null,
  );
}

function issueRow(i: Issue) {
  return h(
    'li',
    { class: `type-issue ${i.severity}` },
    severityIcon(i.severity),
    h('span', null, i.message),
    i.fix ? h('button', { type: 'button', class: 'small', onclick: () => applyFixes([i.fix!]) }, i.fix.label) : null,
  );
}
