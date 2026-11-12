import { fixPrompt, type PromptScope } from '../io/prompt';
import type { Issue } from '../model/types';
import { store } from '../state/app';
import type { PairRow, SiblingRow } from '../state/pairs';
import { h, icon, plural } from './dom';
import { TIP } from './tips';

/**
 * Inline text that copies the fix prompt, for the findings it is next to
 * (`scope`) or for all of them, with a trailing copy icon. While the copy
 * is confirmed, the text says how many corrections went to the clipboard.
 */
export function promptLink(text: string, scope?: PromptScope): HTMLButtonElement {
  const label = h('span', null, text);
  const link: HTMLButtonElement = h(
    'button',
    {
      type: 'button',
      class: 'link prompt-link',
      'data-tip': scope ? TIP.copyScopedPrompt : TIP.copyFixPrompt,
      onclick: async () => {
        const { text: prompt, count } = fixPrompt(store.get(), scope);
        try {
          await navigator.clipboard.writeText(prompt || 'No corrections needed: every check passes.');
          label.textContent = count ? `copied ${plural(count, 'correction')}` : 'nothing to copy';
        } catch {
          label.textContent = 'copy failed';
        }
        setTimeout(() => (label.textContent = text), 1800);
      },
    },
    label,
    icon('copy'),
  );
  return link;
}

/** A stable key for an issue, the same in every merge of the theme models. */
const issueKey = (i: Issue) => [i.code, i.fileId, i.target, i.keyPath?.join('.'), i.message].join('\u0000');

/** Scope: these issues. */
export const issuesScope = (issues: readonly Issue[]): PromptScope => {
  const keys = new Set(issues.map(issueKey));
  return { issue: (i) => keys.has(issueKey(i)) };
};

/** Scope: one pair, with contrast or color-vision findings. */
export const pairScope = (r: PairRow): PromptScope => ({ pair: (x) => x.pair.fg === r.pair.fg && x.pair.bg === r.pair.bg });

/** Scope: one group of status colors. */
export const siblingScope = (g: SiblingRow): PromptScope => ({ sibling: (x) => x.group.id === g.group.id });
