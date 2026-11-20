import { basisLabel } from '../policy/basis';
import type { Severity } from '../model/types';
import { levelOf, REMEDY, RULES, type Level, type RuleDef, type RuleGroup } from '../policy/rules';
import { resetPolicy, setRuleLevel, setRuleLevels, store } from '../state/app';
import { collapsible } from './collapsible';
import { h, plural, severityIcon, viewHead } from './dom';
import { swatchSelect } from './swatch-select';
import { TIP } from './tips';

const LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };

interface Row {
  rule: RuleDef;
  el: HTMLElement;
  on: HTMLInputElement;
  /** Holds the level picker, rebuilt when the rule's level changes. */
  level: HTMLElement;
  /** The level the picker was last built for. */
  shown?: Level;
  changed: HTMLElement;
}

/**
 * The page's sections, in the order and by the names the findings use: the
 * Issues page's Format, Tiers, Contrast and Color blindness, then the checks
 * shown with the base tier (color scales) and the type styles. Each can be
 * turned off as a whole, to work on one kind of finding at a time.
 */
const SECTIONS: { id: string; title: string; about: string; groups: RuleGroup[] }[] = [
  { id: 'format', title: 'Format', about: 'The files against the DTCG format: file formats, structure, references, types and values, metadata.', groups: ['Format', 'Structure', 'References', 'Types and values', 'Metadata'] },
  { id: 'tiers', title: 'Tiers', about: 'Base, semantic and component tokens, and what each may point at.', groups: ['Tiers'] },
  { id: 'contrast', title: 'Contrast', about: 'Text, UI parts and borders against their background, in every theme.', groups: ['Contrast'] },
  { id: 'vision', title: 'Color blindness', about: 'Pairs and status colors as people with color-vision deficiencies see them.', groups: ['Color blindness'] },
  { id: 'scales', title: 'Base color scales', about: 'The order, spacing, hue and gamut of each color scale.', groups: ['Base color scales'] },
  { id: 'typography', title: 'Typography', about: 'Type styles that look the same, sizes too close or too small, fallback fonts.', groups: ['Typography'] },
];
/** A group's name inside its section, where it differs ("Format" is the section). */
const GROUP_TITLE: Partial<Record<RuleGroup, string>> = { Format: 'File format' };

interface Section {
  rows: Row[];
  on: HTMLInputElement;
  state: HTMLElement;
}

/** A level in the picker: its severity icon, in its color, then its name. */
const levelOption = (l: Severity) => ({ value: l, label: LABEL[l], lead: () => h('span', { class: `policy-sev ${l}` }, severityIcon(l)) });

/**
 * The severity policy: every check, one per line, with a switch to turn it
 * off and the level it reports at. Changes apply at once to every file and
 * view, and are kept in this browser with the other preferences.
 */
export class TTPolicy extends HTMLElement {
  private unsub?: () => void;
  private rows: Row[] = [];
  private sections: Section[] = [];
  private summary = h('span');
  private reset = h('button', { type: 'button', 'data-tip': TIP.policyReset, onclick: resetPolicy }, 'Reset to defaults');

  connectedCallback() {
    this.rows = RULES.map((r) => this.row(r));
    this.sections = [];
    this.replaceChildren(
      viewHead('What to check', { summary: this.summary }),
      h('p', { class: 'meta policy-intro' }, 'Turn a whole section off to work on one kind of finding at a time. Changes apply right away to every file and are kept in this browser.'),
      h('div', { class: 'policy' }, SECTIONS.map((s) => this.section(s))),
      h('div', { class: 'policy-foot' }, this.reset),
    );
    this.unsub = store.select((s) => s.settings.policy, () => this.refresh());
  }

  disconnectedCallback() {
    this.unsub?.();
  }

  /**
   * A section: its name, how many of its checks are on, and a switch that
   * turns all of them on (each at its own level) or off. Closed until opened,
   * where each check can be set on its own.
   */
  private section(def: (typeof SECTIONS)[number]) {
    const rows = this.rows.filter((x) => def.groups.includes(x.rule.group));
    const id = `policy-section-${def.id}`;
    const on = h('input', { type: 'checkbox', role: 'switch', id, class: 'policy-section-switch', 'aria-label': `${def.title} checks` });
    // Turning a section on puts back each check that was off at its default level, and keeps the levels set for the rest.
    on.addEventListener('change', () =>
      setRuleLevels(Object.fromEntries(rows.map((x) => [x.rule.id, on.checked ? (levelOf(store.get().settings.policy, x.rule.id) === 'off' ? x.rule.level : levelOf(store.get().settings.policy, x.rule.id)) : 'off']))),
    );
    // The switch sits in the section's heading line: using it doesn't open or close the section.
    on.addEventListener('click', (e) => e.stopPropagation());
    const state = h('span', { class: 'policy-section-state' });
    this.sections.push({ rows, on, state });
    const lists = def.groups.map((g) => {
      const own = rows.filter((x) => x.rule.group === g);
      const list = h('ul', { class: 'policy-list' }, own.map((x) => x.el));
      return def.groups.length > 1 ? h('section', { class: 'policy-group' }, h('h3', null, GROUP_TITLE[g] ?? g), list) : list;
    });
    return collapsible({
      key: `policy:${def.id}`,
      open: false,
      variant: 'row',
      class: 'policy-section',
      summary: [
        h('span', { class: 'policy-section-head' }, h('h2', null, def.title), h('span', { class: 'policy-section-about' }, def.about)),
        h('span', { class: 'policy-section-toggle', onclick: (e: Event) => e.stopPropagation() }, state, on),
      ],
      content: h('div', { class: 'policy-section-body' }, lists),
    });
  }

  private row(rule: RuleDef): Row {
    const id = `policy-${rule.id}`;
    const on = h('input', { type: 'checkbox', role: 'switch', id, 'aria-label': `Check ${rule.title}` });
    const level = h('div', { class: 'policy-level' });
    on.addEventListener('change', () => setRuleLevel(rule.id, on.checked ? rule.level : 'off'));
    const changed = h('small', { class: 'policy-changed' });
    const el = h(
      'li',
      { class: 'policy-row' },
      on,
      h(
        'label',
        { for: id, class: 'policy-text' },
        h('strong', null, rule.title, ' ', h('code', null, rule.id)),
        h('span', null, rule.about),
        basisLine(rule.id),
        h('span', { class: `remedy ${rule.remedy}`, 'data-tip': REMEDY[rule.remedy].about }, REMEDY[rule.remedy].label),
        changed,
      ),
      level,
    );
    return { rule, el, on, level, changed };
  }

  private refresh() {
    const policy = store.get().settings.policy;
    let edited = 0;
    for (const x of this.rows) {
      const l = levelOf(policy, x.rule.id);
      const off = l === 'off';
      x.on.checked = !off;
      if (x.shown !== l) {
        x.shown = l;
        // Off: the picker shows the rule's default level, unavailable until the check is on again.
        x.level.replaceChildren(
          swatchSelect({
            label: `Severity of ${x.rule.title}`,
            groups: [{ label: '', options: (['error', 'warning', 'info'] as const).map(levelOption) }],
            value: off ? x.rule.level : l,
            gamut: 'srgb',
            disabled: off,
            mask: false,
            class: 'level-select',
            onPick: (v) => setRuleLevel(x.rule.id, v as Level),
          }),
        );
      }
      x.el.classList.toggle('off', off);
      const isChanged = l !== x.rule.level;
      if (isChanged) edited++;
      x.el.classList.toggle('changed', isChanged);
      x.changed.textContent = isChanged ? `Changed · default: ${LABEL[x.rule.level]}` : '';
    }
    for (const s of this.sections) {
      const n = s.rows.filter((x) => levelOf(policy, x.rule.id) !== 'off').length;
      // Some on, some off: shown as mixed, and switching it turns the rest on.
      s.on.checked = n === s.rows.length;
      s.on.indeterminate = n > 0 && n < s.rows.length;
      s.state.textContent = n === s.rows.length ? `${plural(n, 'check')} on` : n ? `${n} of ${s.rows.length} on` : 'Off';
      s.on.closest('.policy-section')?.classList.toggle('off', n === 0);
    }
    this.summary.textContent = `${plural(RULES.length, 'rule')}${edited ? ` · ${edited} changed` : ' · built-in defaults'}`;
    this.reset.disabled = edited === 0;
  }
}

/** What a rule stands on: a standard's section, or a DTsanity convention, and whether its findings are required or advice. */
function basisLine(id: string) {
  const label = basisLabel(id);
  if (!label) return null;
  // Contrast checks follow the contrast target: with APCA selected they are APCA guidance, not a WCAG requirement.
  const apca = APCA_RULES.has(id) ? ' · With APCA selected: Advice · APCA, proposed for WCAG 3, not yet a standard' : '';
  return h('small', { class: 'policy-basis' }, label + apca);
}

const APCA_RULES = new Set(['contrast-text', 'contrast-ui', 'contrast-border']);
