/**
 * DOM helpers. Token files are untrusted input, so nothing from them is ever
 * written as HTML: `h()` sets text with text nodes and attributes with
 * setAttribute, never innerHTML.
 */

export type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/**
 * Exclude an element's content from usability recordings (Hotjar, Clarity).
 * Every region that shows anything from the user's files must be masked.
 */
export function masked<T extends HTMLElement>(el: T): T {
  el.setAttribute('data-hj-suppress', '');
  el.setAttribute('data-clarity-mask', 'true');
  return el;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Stroke icons (Tabler, MIT). Fixed markup, never built from file data. */
const ICONS = {
  pin: '<path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/>',
  'pin-filled':
    '<path d="M15.113 3.21l.094 .083l5.5 5.5a1 1 0 0 1 -1.175 1.59l-3.172 3.171l-1.424 3.797a1 1 0 0 1 -.158 .277l-.07 .08l-1.5 1.5a1 1 0 0 1 -1.32 .082l-.095 -.083l-2.793 -2.792l-3.793 3.792a1 1 0 0 1 -1.497 -1.32l.083 -.094l3.792 -3.793l-2.792 -2.793a1 1 0 0 1 -.083 -1.32l.083 -.094l1.5 -1.5a1 1 0 0 1 .258 -.187l.098 -.042l3.796 -1.425l3.171 -3.17a1 1 0 0 1 1.497 -1.26z"/>',
  curve: '<path d="M6.5 17.5c5 0 5 -11 11 -11"/><circle cx="4.5" cy="17.5" r="2"/><circle cx="19.5" cy="6.5" r="2"/>',
  'chevron-down': '<path d="M6 9l6 6l6 -6"/>',
  x: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
  copy: '<path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/>',
  check: '<path d="M5 12l5 5l10 -10"/>',
  dots: '<path d="M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  chevron: '<path d="M9 6l6 6l-6 6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>',
  token:
    '<path d="M12 21L5.04743 17.234C4.40205 16.8844 4 16.2094 4 15.4754V7.66667M12 21L18.9526 17.234C19.598 16.8844 20 16.2094 20 15.4754L20 7.66667M12 21V15M4 7.66667L11.0761 3.98118C11.6551 3.67962 12.3449 3.67962 12.9239 3.98118L20 7.66667M4 7.66667L9.36162 10.5709M20 7.66667L14.6384 10.5709M12 15C13.6569 15 15 13.6569 15 12C15 11.4826 14.869 10.9958 14.6384 10.5709M12 15C10.3431 15 9 13.6569 9 12C9 11.4826 9.13099 10.9958 9.36162 10.5709M14.6384 10.5709C14.1305 9.63523 13.1394 9 12 9C10.8606 9 9.8695 9.63523 9.36162 10.5709"/>',
  'alert-triangle-filled':
    '<path d="M12 1.67c.955 0 1.845 .467 2.39 1.247l.105 .16l8.114 13.548a2.914 2.914 0 0 1 -2.307 4.363l-.195 .008h-16.225a2.914 2.914 0 0 1 -2.582 -4.2l.099 -.185l8.11 -13.538a2.914 2.914 0 0 1 2.491 -1.403zm.01 13.33l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007zm-.01 -7a1 1 0 0 0 -.993 .883l-.007 .117v4l.007 .117a1 1 0 0 0 1.986 0l.007 -.117v-4l-.007 -.117a1 1 0 0 0 -.993 -.883z"/>',
  'info-circle': '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 9h.01"/><path d="M11 12h1v4h1"/>',
  'alert-triangle': '<path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const t = document.createElement('template');
  // Filled variants are drawn as solid shapes, the rest as strokes.
  const paint = name.endsWith('-filled') ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
  t.innerHTML = `<svg class="icon" viewBox="0 0 24 24" width="16" height="16" ${paint} aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}

/**
 * A pin toggle: a filled pin at full strength when on, a faint outline when off. `label` names
 * the step (token data, so the caller keeps it inside masked content).
 */
export function pinButton(on: boolean, label: string, tip: string, onToggle: () => void): HTMLButtonElement {
  const b = h(
    'button',
    { type: 'button', class: `pin-btn${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': `${on ? 'Unpin' : 'Pin'} ${label}`, 'data-tip': tip },
    icon(on ? 'pin-filled' : 'pin'),
  ) as HTMLButtonElement;
  // Inside rows that react to pointer and click themselves (scrub strips, copyable units).
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggle();
  });
  return b;
}

/** The icon for a severity: a filled triangle for errors, an outlined one for warnings, a circled "i" for info. */
export function severityIcon(severity: 'error' | 'warning' | 'info'): SVGSVGElement {
  const el = icon(severity === 'error' ? 'alert-triangle-filled' : severity === 'warning' ? 'alert-triangle' : 'info-circle');
  el.classList.add('sev-icon');
  return el;
}

/**
 * The header every view starts with, so titles, counts and actions sit in
 * the same place on every page: a title row with actions on the right, then
 * a summary line that keeps its height when empty.
 */
export function viewHead(title: Child, opts: { summary?: Child; actions?: Child } = {}): HTMLElement {
  return h(
    'header',
    { class: 'vh' },
    h('div', { class: 'vh-row' }, h('h1', { class: 'vh-title' }, title), h('div', { class: 'vh-actions' }, opts.actions ?? null)),
    h('div', { class: 'vh-summary' }, opts.summary ?? null),
  );
}

/**
 * A labeled one-of-several choice, as in the view headers (color format,
 * target gamut): a small caps label, then the options as a segmented control.
 */
export function segmentedPick<T extends string>(
  label: string,
  options: { value: T; label: string; tip?: string }[],
  current: T,
  pick: (value: T) => void,
  tip?: string,
): HTMLElement {
  const id = `pick-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return h(
    'div',
    { class: 'seg-pick' },
    h('span', { class: 'pick-label', id, 'data-tip': tip }, label),
    h(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-labelledby': id },
      options.map((o) =>
        h(
          'button',
          { type: 'button', role: 'radio', 'aria-checked': String(o.value === current), class: o.value === current ? 'on' : undefined, 'data-tip': o.tip, onclick: () => pick(o.value) },
          o.label,
        ),
      ),
    ),
  );
}

/**
 * The one X button: remove, close or dismiss. An icon centered in a square
 * target, muted until hovered; `label` names what it does for screen readers.
 */
export function xButton(label: string, onclick: (e: Event) => void, tip?: string, extra = ''): HTMLButtonElement {
  return h('button', { type: 'button', class: `x-btn${extra ? ` ${extra}` : ''}`, 'aria-label': label, 'data-tip': tip, onclick }, icon('x'));
}
