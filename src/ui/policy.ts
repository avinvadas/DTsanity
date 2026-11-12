import type { Severity } from '../model/types';
import { levelOf, RULES, type Level, type RuleDef } from '../policy/rules';
import { resetPolicy, setRuleLevel, store } from '../state/app';
import { h, plural, severityIcon, viewHead } from './dom';
import { TIP } from './tips';

const LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };

interface Row {
  rule: RuleDef;
  el: HTMLElement;
  on: HTMLInputElement;
  level: HTMLSelectElement;
  icon: HTMLElement;
  changed: HTMLElement;
}

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
      h('p', { class: 'meta policy-intro' }, 'How each check reports: as an error, a warning or info, or not at all. Changes apply right away to every file and are kept in this browser.'),
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
    const level = h(
      'select',
      { 'aria-label': `Severity of ${rule.title}` },
      (['error', 'warning', 'info'] as const).map((l) => h('option', { value: l }, LABEL[l])),
    );
    on.addEventListener('change', () => setRuleLevel(rule.id, on.checked ? rule.level : 'off'));
    level.addEventListener('change', () => setRuleLevel(rule.id, level.value as Level));
    const icon = h('span', { class: 'policy-sev' });
    const changed = h('small', { class: 'policy-changed' });
    const el = h(
      'li',
      { class: 'policy-row' },
      on,
      h('label', { for: id, class: 'policy-text' }, h('strong', null, rule.title, ' ', h('code', null, rule.id)), h('span', null, rule.about), changed),
      h('div', { class: 'policy-level' }, icon, level),
    );
    return { rule, el, on, level, icon, changed };
  }

  private refresh() {
    const policy = store.get().settings.policy;
    let edited = 0;
    for (const x of this.rows) {
      const l = levelOf(policy, x.rule.id);
      const off = l === 'off';
      x.on.checked = !off;
      x.level.disabled = off;
      x.level.value = off ? x.rule.level : l;
      x.icon.replaceChildren(off ? '' : severityIcon(l));
      x.icon.className = `policy-sev${off ? '' : ` ${l}`}`;
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
