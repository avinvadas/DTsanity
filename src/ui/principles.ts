import { FIX_EXCEPTIONS, FIX_PRINCIPLES, PRINCIPLE, PRINCIPLE_ABOUT, PROMPT_RULES, PROMPT_WHY, type Principle } from '../policy/principles';
import { REMEDY, RULES, type Remedy } from '../policy/rules';
import { h, plural, viewHead } from './dom';

/**
 * "How DTsanity fixes": the principles behind its fixes and the fix prompt,
 * and what it does about each check. Linked from the footer; shown as a page
 * of its own, with only the header and the footer around it.
 */
export class TTPrinciples extends HTMLElement {
  connectedCallback() {
    if (this.firstChild) return;
    const items = (xs: readonly Principle[]) => h('ul', { class: 'principles' }, xs.map((p) => h('li', null, h('strong', null, p.title), h('span', null, p.text))));
    const remedies: Remedy[] = ['fix', 'sometimes', 'guided', 'none'];
    this.replaceChildren(
      viewHead('How DTsanity fixes', { summary: PRINCIPLE }),
      h(
        'div',
        { class: 'prose principles-page' },
        h('p', null, PRINCIPLE_ABOUT),

        h('h2', null, 'One-click fixes'),
        items(FIX_PRINCIPLES),

        h('h2', null, 'What DTsanity does about each check'),
        h('p', null, 'Each check is labelled on the severity policy page (the cog at the top). An issue without a fix is listed under “Needs your change”.'),
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

        h('h2', null, 'The fix prompt'),
        h('p', null, 'What DTsanity can’t fix goes into the fix prompt, for an AI assistant or a ticket. It lists every correction with where it is, and gives these rules with them:'),
        h('ul', { class: 'principles rules' }, PROMPT_RULES.map((r) => h('li', null, h('span', null, r.text)))),
        h('p', null, PROMPT_WHY),
      ),
    );
  }
}
