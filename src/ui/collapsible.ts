import { h, icon, type Child } from './dom';

/**
 * Expandable and collapsible content, one way everywhere. Two forms share a
 * chevron, styling and remembered state:
 *  - `collapsible()`: a container whose summary line opens and closes it,
 *    for anything that can be wrapped (sections, panels, "more" areas);
 *  - `disclosure()`: the same toggle as a button, for content that can't be
 *    wrapped, such as palette rows in a shared grid or extra table rows. The
 *    caller shows or hides that content when it toggles.
 * With a `key`, the open state is kept for the session (in memory only, as
 * keys may name tokens), so re-renders don't reset what the user opened.
 */

const remembered = new Map<string, boolean>();

/** Whether the collapsible with `key` is open: as the user left it, or `fallback`. */
export const isOpen = (key: string, fallback: boolean) => remembered.get(key) ?? fallback;

export function setOpen(key: string, open: boolean) {
  remembered.set(key, open);
}

const chevron = () => h('span', { class: 'cl-chevron', 'aria-hidden': 'true' }, icon('chevron-down'));

export interface CollapsibleOptions {
  /** The always-visible line that opens and closes the content. */
  summary: Child;
  /** The content, or a function that builds it the first time it opens. */
  content: Child | (() => Child);
  /** Remembers the open state across re-renders. */
  key?: string;
  /** Open when nothing is remembered. Closed by default. */
  open?: boolean;
  /**
   * `row`: a heading and a separator line below, like the base color rows,
   * for lists of sections; `card`: a bordered block; `plain`: inline, for
   * "more" areas.
   */
  variant?: 'row' | 'card' | 'plain';
  class?: string;
  tip?: string;
  /** Extra attributes for the container, such as data-* for filtering. */
  attrs?: Record<string, unknown>;
  onToggle?: (open: boolean) => void;
}

export function collapsible(o: CollapsibleOptions): HTMLDetailsElement {
  const open = o.key ? isOpen(o.key, o.open ?? false) : (o.open ?? false);
  const body = h('div', { class: 'cl-body' });
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    body.replaceChildren(h('div', { class: 'cl-inner' }, typeof o.content === 'function' ? o.content() : o.content));
  };
  if (open) build();
  const el = h(
    'details',
    { ...o.attrs, class: ['cl', `cl-${o.variant ?? 'plain'}`, o.class].filter(Boolean).join(' '), open },
    h('summary', { class: 'cl-summary', 'data-tip': o.tip }, chevron(), h('span', { class: 'cl-label' }, o.summary)),
    body,
  ) as HTMLDetailsElement;
  builders.set(el, build);
  el.addEventListener('toggle', () => {
    if (el.open) build();
    if (o.key) setOpen(o.key, el.open);
    o.onToggle?.(el.open);
  });
  return el;
}

export interface DisclosureOptions {
  key: string;
  /** Open when nothing is remembered. */
  open: boolean;
  /** What the button opens, for its accessible name ("Show color.blue"). */
  label: string;
  onToggle: (open: boolean) => void;
  tip?: string;
  /** Text beside the chevron; a bare chevron when absent. */
  text?: string;
}

/** The toggle alone, for content placed elsewhere. */
export function disclosure(o: DisclosureOptions): HTMLButtonElement {
  const open = isOpen(o.key, o.open);
  const b = h(
    'button',
    { type: 'button', class: `cl-toggle${o.text ? ' with-text' : ''}`, 'aria-expanded': String(open), 'aria-label': `${open ? 'Collapse' : 'Expand'} ${o.label}`, 'data-tip': o.tip },
    chevron(),
    o.text ? h('span', null, o.text) : null,
  ) as HTMLButtonElement;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = !isOpen(o.key, o.open);
    setOpen(o.key, next);
    o.onToggle(next);
  });
  return b;
}

const builders = new WeakMap<HTMLDetailsElement, () => void>();

/** Open a collapsible container now, with its content built at once (the toggle event comes later). */
export function expand(el: HTMLDetailsElement) {
  builders.get(el)?.();
  el.open = true;
}

/** Open or close every collapsible container inside `root`. */
export function setAll(root: ParentNode, open: boolean) {
  for (const d of root.querySelectorAll<HTMLDetailsElement>('details.cl')) d.open = open;
}
