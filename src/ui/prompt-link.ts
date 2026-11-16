import { fixPrompt, type FixPrompt, type PromptScope } from '../io/prompt';
import { store } from '../state/app';
import { h, icon, plural } from './dom';
import { TIP } from './tips';

/** The label on every findings report button. */
export const COPY_PROMPT = 'Copy the findings report';

/**
 * What a copy put on the clipboard, in the units the Issues page counts
 * ("591 corrections"), with what else the prompt lists named apart, so the
 * two numbers can always be checked against each other.
 */
export function copiedLabel({ count, more }: FixPrompt, empty = 'Nothing to copy'): string {
  if (!count && !more) return empty;
  const others = more ? plural(more, 'other finding') : '';
  return count ? `Copied ${plural(count, 'correction')}${others ? `, plus ${others}` : ''}` : `Copied ${others}`;
}

/**
 * A secondary button that copies the findings report, for the group of findings it
 * heads (`scope`) or for all of them, with a copy icon after its label. Only groups get one,
 * never a single finding. While the copy
 * is confirmed, it says how many corrections went to the clipboard.
 */
export function promptButton(scope?: PromptScope): HTMLButtonElement {
  const label = h('span', null, COPY_PROMPT);
  const button: HTMLButtonElement = h(
    'button',
    {
      type: 'button',
      class: 'small prompt-btn',
      'data-tip': scope ? TIP.copyScopedPrompt : TIP.copyFixPrompt,
      onclick: async () => {
        const p = fixPrompt(store.get(), scope);
        try {
          await navigator.clipboard.writeText(p.text || 'No corrections needed: every check passes.');
          label.textContent = copiedLabel(p);
        } catch {
          label.textContent = 'Copy failed';
        }
        setTimeout(() => (label.textContent = COPY_PROMPT), 1800);
      },
    },
    // Always at the right end of its line: the icon trails, at the edge.
    label,
    icon('copy'),
  );
  return button;
}

/** A line of text with the findings report button aligned right. */
export function promptRow(text: (string | Node)[] | string, scope: PromptScope | undefined, cls = ''): HTMLElement {
  return h('div', { class: `prompt-row ${cls}`.trim() }, h('span', { class: 'prompt-row-text' }, text), promptButton(scope));
}

export { issuesScope, pairsScope } from '../io/prompt';
