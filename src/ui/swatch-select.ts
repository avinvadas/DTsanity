import type { ColorInfo, Gamut } from '../color/format';
import { paintAll, swatchCanvas } from './canvas';
import { h, icon, masked } from './dom';

/**
 * A single-choice list whose options lead with a color thumbnail or an icon,
 * which a native <select> cannot show. The button shows the chosen option; the list
 * opens as a popover under it. Keyboard: Enter, Space or the arrows open it;
 * the arrows, Home and End move; Enter or Space picks; Escape closes.
 *
 * A long list (token aliases) opens with a filter above it: typing narrows the
 * options to those whose name, group or value hold every word typed. The arrows
 * move from the filter into the list and back; Enter picks the first match; typing
 * on an option goes on in the filter. Closing the list clears the filter.
 */

/** More options than this, and the list has a filter. */
const FILTER_FROM = 8;

export interface SwatchOption {
  value: string;
  label: string;
  /** Secondary text after the label, such as a lightness. */
  meta?: string;
  /** The full name, as a tooltip, when the label is a short form of it. */
  title?: string;
  /** The color its thumbnail shows. */
  info?: ColorInfo;
  /** Or what the option leads with instead, such as an icon. Called once per place it is shown. */
  lead?: () => Node;
  disabled?: boolean;
}

export interface SwatchGroup {
  label: string;
  options: SwatchOption[];
}

export function swatchSelect(opts: {
  label: string;
  groups: SwatchGroup[];
  value: string;
  gamut: Gamut;
  /** The value is a token reference: the button leads with the token icon. */
  token?: boolean;
  /** Shown on the button when no option matches `value`. */
  fallback?: { label: string; info?: ColorInfo };
  /** The whole control is unavailable (shown, not openable). */
  disabled?: boolean;
  /** Mask the labels from usability recordings: true (the default) for token names and values. */
  mask?: boolean;
  /** Extra class on the control, for plain-text lists. */
  class?: string;
  /** Marks the button so a view can focus it again after a pick re-renders it. */
  focusKey?: string;
  onPick: (value: string) => void;
}): HTMLElement {
  const all = opts.groups.flatMap((g) => g.options);
  const chosen = all.find((o) => o.value === opts.value);
  const shown = chosen ?? opts.fallback;
  const empty = !all.length;
  const mask = opts.mask === false ? <T extends HTMLElement>(el: T) => el : masked;

  const face = (o: { label: string; meta?: string; title?: string; info?: ColorInfo; lead?: () => Node }) => [
    o.lead ? h('span', { class: 'ss-lead', 'aria-hidden': 'true' }, o.lead()) : o.info ? swatchCanvas(o.info, opts.gamut, false) : null,
    h('span', { class: 'ss-label', title: o.title }, o.label),
    o.meta ? h('span', { class: 'ss-meta' }, o.meta) : null,
  ];

  const id = `ss-${Math.random().toString(36).slice(2, 8)}`;
  const button = h(
    'button',
    { type: 'button', class: 'ss-button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': opts.label, 'data-focus': opts.focusKey, disabled: empty || opts.disabled },
    opts.token ? h('span', { class: 'token-mark', 'aria-hidden': 'true' }, icon('token')) : null,
    shown ? face(shown) : null,
    empty ? null : h('span', { class: 'ss-chevron', 'aria-hidden': 'true' }, icon('chevron-down')),
  ) as HTMLButtonElement;

  const items: HTMLElement[] = [];
  /** What each option is found by: its name, its value, its full name and its group's name. */
  const haystack = new Map<HTMLElement, string>();
  const options = h(
    'div',
    { id, class: 'ss-options', role: 'listbox', 'aria-label': opts.label, tabindex: '-1' },
    opts.groups.map((g) =>
      h(
        'div',
        { role: 'group', 'aria-label': g.label, class: 'ss-group' },
        g.label ? h('div', { class: 'ss-group-label', 'aria-hidden': 'true' }, g.label) : null,
        g.options.map((o) => {
          const el = h(
            'div',
            {
              role: 'option',
              class: 'ss-option',
              tabindex: '-1',
              'data-value': o.value,
              'aria-selected': String(o.value === opts.value),
              'aria-disabled': o.disabled ? 'true' : null,
            },
            face(o),
          );
          haystack.set(el, [o.label, o.value, o.title ?? '', o.meta ?? '', g.label].join(' ').toLowerCase());
          if (!o.disabled) {
            el.addEventListener('click', () => pick(o.value));
            items.push(el);
          }
          return el;
        }),
      ),
    ),
  );

  const groupEls = [...options.querySelectorAll<HTMLElement>('.ss-group')];
  // The filter, for long lists: it stays above the options as they scroll.
  const searchable = all.length > FILTER_FROM;
  const filter = searchable
    ? (h('input', { type: 'search', class: 'ss-filter', placeholder: 'Filter', 'aria-label': `Filter ${opts.label}`, 'aria-controls': id, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement)
    : null;
  const none = h('div', { class: 'ss-none', hidden: true }, 'No matches');
  /** Show only the options holding every word typed, and the groups that still have one. */
  const apply = (query: string) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    let any = false;
    for (const [el, text] of haystack) {
      const hit = words.every((w) => text.includes(w));
      el.hidden = !hit;
      any ||= hit;
    }
    for (const g of groupEls) g.hidden = ![...g.querySelectorAll<HTMLElement>('.ss-option')].some((el) => !el.hidden);
    const first = groupEls.find((g) => !g.hidden);
    for (const g of groupEls) g.classList.toggle('ss-first', g === first);
    none.hidden = any;
  };
  const visible = () => items.filter((el) => !el.hidden);
  filter?.addEventListener('input', () => {
    apply(filter.value);
    options.scrollTop = 0;
  });

  const list = h('div', { class: `ss-list${searchable ? ' has-filter' : ''}`, popover: 'auto' }, filter, options, none);

  function pick(value: string) {
    list.hidePopover();
    button.focus();
    if (value === opts.value) return;
    opts.onPick(value);
    // Picking redraws the controls; keep focus on this control's new button.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.ss-button[aria-label="${CSS.escape(opts.label)}"]`)?.focus());
  }

  function open() {
    if (empty || opts.disabled || list.matches(':popover-open')) return;
    list.showPopover();
    // Placed and focused here, as it opens, not on a later 'toggle' event, which can come late or merge with another.
    place();
    paintAll(list);
    const current = items.find((el) => el.dataset.value === opts.value) ?? items[0];
    current?.scrollIntoView({ block: 'nearest' });
    // A long list opens on its filter, its current option in view; a short one on its current option.
    (filter ?? current)?.focus();
  }

  function place() {
    const r = button.getBoundingClientRect();
    list.style.minWidth = `${r.width}px`;
    const below = window.innerHeight - r.bottom;
    const height = Math.min(list.scrollHeight, list.offsetHeight);
    const above = !(below >= height + 8 || below >= r.top);
    const top = above ? r.top - 4 - height : r.bottom + 4;
    list.style.top = `${Math.max(8, top)}px`;
    list.style.left = `${Math.min(r.left, window.innerWidth - list.offsetWidth - 8)}px`;
    // Opened above its button, the list keeps its height while filtered, so it doesn't drift away from the button.
    if (above && searchable) list.style.height = `${list.offsetHeight}px`;
  }

  // Every opening and closing, by a pick or not, starts the next opening with the whole list. Done before
  // the change ('beforetoggle' always fires, right away), with the button's expanded state.
  list.addEventListener('beforetoggle', (e) => {
    button.setAttribute('aria-expanded', String((e as ToggleEvent).newState === 'open'));
    if (filter) {
      filter.value = '';
      apply('');
    }
    list.style.height = '';
  });

  // A press on the button of an open list closes it (the press outside the list already did), rather than opening it again.
  let wasOpen = false;
  button.addEventListener('pointerdown', () => (wasOpen = list.matches(':popover-open')));
  button.addEventListener('click', () => {
    if (wasOpen) wasOpen = false;
    else open();
  });
  button.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (e) => {
    const shown = visible();
    const go = (i: number) => {
      const el = shown[Math.max(0, Math.min(shown.length - 1, i))];
      el?.focus();
      el?.scrollIntoView({ block: 'nearest' });
    };
    if (filter && e.target === filter) {
      // In the filter: down into the matches, Enter picks the first of them; other keys type.
      if (e.key === 'ArrowDown') go(0);
      else if (e.key === 'Enter' && filter.value.trim() && shown[0]) pick(shown[0].dataset.value!);
      else if (e.key === 'Enter') {
        /* nothing typed: Enter does nothing */
      } else if (e.key === 'Tab') list.hidePopover();
      else return;
      e.preventDefault();
      return;
    }
    const at = shown.indexOf(document.activeElement as HTMLElement);
    // Typing on an option goes on in the filter.
    if (filter && ((e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) || e.key === 'Backspace')) {
      filter.focus();
      return;
    }
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp' && at <= 0 && filter) filter.focus();
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(shown.length - 1);
    else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) pick(shown[at]!.dataset.value!);
    else if (e.key === 'Tab') list.hidePopover();
    else return;
    e.preventDefault();
  });

  return h('span', { class: `swatch-select${opts.class ? ` ${opts.class}` : ''}` }, mask(button), mask(list));
}
