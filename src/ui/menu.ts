import { h, icon, type IconName } from './dom';

/** One action in a menu: an icon, its label, an optional tooltip and what it does. */
export type MenuItem = { label: string; icon?: IconName; tip?: string; act: () => void };

/**
 * The actions menu: every contextual menu in the app (the
 * "more" button). A popover list of 3rem rows, each an icon and a label,
 * opened by `toggle` below `anchor` with right edges aligned and kept on
 * screen. Choosing an item closes the menu, then runs it. Returns the menu.
 */
export function actionsMenu(anchor: HTMLElement, toggle: HTMLButtonElement, menuLabel: string, items: MenuItem[]) {
  const menu = h(
    'div',
    { class: 'actions-menu', popover: 'auto', role: 'menu', 'aria-label': menuLabel },
    items.map((it) =>
      h(
        'button',
        { type: 'button', role: 'menuitem', class: 'menu-item', 'data-tip': it.tip, onclick: () => (menu.hidePopover(), it.act()) },
        it.icon ? icon(it.icon) : null,
        h('span', null, it.label),
      ),
    ),
  );
  menu.addEventListener('toggle', (e) => {
    toggle.setAttribute('aria-expanded', String((e as ToggleEvent).newState === 'open'));
    if ((e as ToggleEvent).newState !== 'open') return;
    const b = anchor.getBoundingClientRect();
    menu.style.top = `${b.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(b.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.querySelector<HTMLElement>('.menu-item')?.focus();
  });
  toggle.addEventListener('click', () => menu.togglePopover());
  return menu;
}

/** A "more" button (three dots) opening the actions menu for what it sits beside. */
export function moreMenu(menuLabel: string, items: MenuItem[]) {
  const toggle = h('button', { type: 'button', class: 'x-btn more-btn', 'aria-label': menuLabel, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-tip': menuLabel }, icon('dots'));
  const el = h('div', { class: 'more-menu' }, toggle);
  el.append(actionsMenu(toggle, toggle, menuLabel, items));
  return el;
}
