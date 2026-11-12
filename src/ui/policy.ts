import type { Severity } from '../model/types';
import { levelOf, REMEDY, RULES, type Level, type RuleDef } from '../policy/rules';
import { resetPolicy, setRuleLevel, store } from '../state/app';
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
  private summary = h('span');
  private reset = h('button', { type: 'button', 'data-tip': TIP.policyReset, onclick: resetPolicy }, 'Reset to defaults');

  connectedCallback() {
    this.rows = RULES.map((r) => this.row(r));
    const groups = [...new Set(RULES.map((r) => r.group))];
    this.replaceChildren(
      viewHead('Severity policy', { summary: this.summary }),
      h('p', { class: 'meta policy-intro' }, 'How each check reports: as an error, a warning or info, or not at all. Changes apply right away to every file and are kept in this browser. Each check also says what DTsanity does about it: Auto-fix (always a one-click fix), Fix when clear (a fix when the right change is clear), Guided (a tool here to work on it) or Report only (the change is yours).'),
      h(
        'div',
        { class: 'policy' },
        groups.map((g) => h('section', { class: 'policy-group' }, h('h2', null, g), h('ul', { class: 'policy-list' }, this.rows.filter((x) => x.rule.group === g).map((x) => x.el)))),
      ),
      h('div', { class: 'policy-foot' }, this.reset),
    );
    this.unsub = store.select((s) => s.settings.policy, () => this.refresh());
  }

  disconnectedCallback() {
    this.unsub?.();
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
    this.summary.textContent = `${plural(RULES.length, 'rule')}${edited ? ` · ${edited} changed` : ' · built-in defaults'}`;
    this.reset.disabled = edited === 0;
  }
}
