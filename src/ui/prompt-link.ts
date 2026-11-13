import { fixPrompt, type PromptScope } from '../io/prompt';
import type { Issue } from '../model/types';
import { store } from '../state/app';
import type { PairRow, SiblingRow } from '../state/pairs';
import { h, icon, plural } from './dom';
import { TIP } from './tips';

/** The label on every fix prompt button. */
export const COPY_PROMPT = 'Copy the fix prompt';

/**
 * A secondary button that copies the fix prompt, for the group of findings it
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
        const { text: prompt, count } = fixPrompt(store.get(), scope);
        try {
          await navigator.clipboard.writeText(prompt || 'No corrections needed: every check passes.');
          label.textContent = count ? `Copied ${plural(count, 'correction')}` : 'Nothing to copy';
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

/** A line of text with the fix prompt button aligned right. */
export function promptRow(text: (string | Node)[] | string, scope: PromptScope | undefined, cls = ''): HTMLElement {
  return h('div', { class: `prompt-row ${cls}`.trim() }, h('span', { class: 'prompt-row-text' }, text), promptButton(scope));
}

/** A stable key for an issue, the same in every merge of the theme models. */
const issueKey = (i: Issue) => [i.code, i.fileId, i.target, i.keyPath?.join('.'), i.message].join('\u0000');

/** Scope: these issues. */
export const issuesScope = (issues: readonly Issue[]): PromptScope => {
  const keys = new Set(issues.map(issueKey));
  return { issue: (i) => keys.has(issueKey(i)) };
};

/** Scope: these pairs and status groups (a contrast or color-blindness section). */
export const pairsScope = (rows: readonly PairRow[], groups: readonly SiblingRow[] = []): PromptScope => {
  const pairs = new Set(rows.map((r) => `${r.pair.fg}\u0000${r.pair.bg}`));
  const ids = new Set(groups.map((g) => g.group.id));
  return { pair: (x) => pairs.has(`${x.pair.fg}\u0000${x.pair.bg}`), sibling: (x) => ids.has(x.group.id) };
};
