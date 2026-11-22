import type { Category } from '../model/types';
import { diagnose, type Cause, type DiagnosedView, type Place } from '../state/diagnose';
import { expand, setOpen } from './collapsible';
import { h, icon } from './dom';
import { goTo } from './nav';

/** The view's side of state/diagnose.ts: the empty view in place of the content, or one line above it, each linking to where the case is handled. */

export const CATEGORY_LABEL: Record<Category, string> = {
  format: 'File format',
  structure: 'Structure',
  references: 'References',
  types: 'Types',
  values: 'Values',
  metadata: 'Metadata',
};

/** Go to Issues with a place open and in view: a category inside Format, or the Tiers section. */
function openIssues(place: Exclude<Place, 'files'>) {
  const ids = place === 'tiers' ? ['issues-tiers'] : ['issues-format', `issues-cat-${place.issues}`];
  for (const id of ids) setOpen(`issues:${id}`, true);
  goTo('issues');
  requestAnimationFrame(() => {
    let last: HTMLDetailsElement | undefined;
    for (const id of ids) {
      const el = [...document.querySelectorAll<HTMLDetailsElement>(`#${id}`)].find((e) => e.offsetParent);
      if (el) expand((last = el));
    }
    last?.scrollIntoView({ block: 'start' });
  });
}

function placeLink(to: Place): HTMLElement {
  if (to === 'files') return h('a', { href: '#files' }, 'Go to Files');
  const label = to === 'tiers' ? 'Issues › Tiers' : `Issues › ${CATEGORY_LABEL[to.issues]}`;
  return h(
    'a',
    {
      href: '#issues',
      onclick: (e: Event) => {
        e.preventDefault();
        openIssues(to);
      },
    },
    `Go to ${label}`,
  );
}

/** In place of an empty view's content: what is missing, why, and where it is handled. */
export function emptyView(title: string, c: Cause): HTMLElement {
  const problem = c.kind === 'problem';
  return h(
    'div',
    { class: `view-error${problem ? ' problem' : ''}`, role: problem ? 'alert' : 'status' },
    problem ? h('span', { class: 'view-error-icon', 'aria-hidden': 'true' }, icon('alert-triangle')) : null,
    h('div', { class: 'view-error-body' }, h('h3', null, title), h('p', null, c.text), c.to ? h('p', { class: 'view-error-go' }, placeLink(c.to)) : null),
  );
}

/** Above a view that shows some of its data: the largest share of what it can't, in one line. */
export function partialLine(c: Cause): HTMLElement {
  return h('p', { class: 'blocked-note', role: 'note' }, h('strong', null, 'Not shown here: '), `${c.text} `, c.to ? placeLink(c.to) : null);
}

/** The diagnosis as the view shows it: the empty view, the one line, or neither. */
export function diagnosisFor(view: DiagnosedView, shown: number, title: string): { empty: HTMLElement | null; line: HTMLElement | null } {
  const d = diagnose(view, shown);
  return { empty: d.empty ? emptyView(title, d.empty) : null, line: d.partial ? partialLine(d.partial) : null };
}
