import { COMPONENT_PAIRS, FIX_EXCEPTIONS, FIX_PRINCIPLES, FLAG_PRINCIPLES, PAIR_PRINCIPLES, PRINCIPLE, PRINCIPLE_ABOUT, PROMPT_RULES, PROMPT_WHY, type Principle } from '../policy/principles';
import { REMEDY, RULES, type Remedy } from '../policy/rules';
import { h, plural, viewHead } from './dom';

/**
 * "How DTsanity works": findings are flags your design system decides on,
 * the principles behind the format fixes and the findings report, and what
 * it does about each check. Linked from the footer; shown as a page
 * of its own, with only the header and the footer around it.
 */
export class TTPrinciples extends HTMLElement {
  connectedCallback() {
    if (this.firstChild) return;
    const items = (xs: readonly Principle[]) => h('ul', { class: 'principles' }, xs.map((p) => h('li', null, h('strong', null, p.title), h('span', null, p.text))));
    const remedies: Remedy[] = ['fix', 'sometimes', 'guided', 'none'];
    this.replaceChildren(
      viewHead('How DTsanity works', { summary: PRINCIPLE }),
      h(
        'div',
        { class: 'prose principles-page' },
        h('p', null, PRINCIPLE_ABOUT),

        h('h2', null, 'Flags, not instructions'),
        items(FLAG_PRINCIPLES),

        // Linked from the Semantic and Component tier pages: #principles/pairs, #principles/component-pairs.
        h('h2', { id: 'principles-pairs' }, 'Contrast pairs'),
        items(PAIR_PRINCIPLES),
        h('h3', { id: 'principles-component-pairs' }, 'Component pairs'),
        h('p', null, COMPONENT_PAIRS),

        h('h2', null, 'One-click fixes'),
        h('p', null, 'Where the right change is only a matter of format, DTsanity offers a fix. It changes the format, never the design, and only when you apply it.'),
        items(FIX_PRINCIPLES),

        h('h2', null, 'What DTsanity does about each check'),
        h('p', null, 'Each check is labelled on the What to check page (the cog at the top). An issue without a fix is listed under “Needs your change”.'),
        h(
          'ul',
          { class: 'principles remedies' },
          remedies.map((r) => {
            const rules = RULES.filter((x) => x.remedy === r);
            return h(
              'li',
              null,
              h('strong', null, h('span', { class: `remedy ${r}` }, REMEDY[r].label), ' ', h('span', { class: 'meta' }, plural(rules.length, 'check'))),
              h('span', null, REMEDY[r].about),
              h('span', { class: 'meta' }, rules.map((x) => x.title).join(', ')),
            );
          }),
        ),

        h('h2', null, 'Two fixes that go a step further'),
        items(FIX_EXCEPTIONS),

        h('h2', null, 'The findings report'),
        h('p', null, 'The findings report (Copy as prompt) lists every finding for an AI assistant, your design system’s own tooling or a ticket: by rule, required first, then advice, each with its source, the problem, the evidence and what must be true when it is done. It opens by saying its findings are flags and your system’s rules prevail, never says how to fix them, and gives these rules with it:'),
        h('ul', { class: 'principles rules' }, PROMPT_RULES.map((r) => h('li', null, h('span', null, r.text)))),
        h('p', null, PROMPT_WHY),
      ),
    );
  }
}
