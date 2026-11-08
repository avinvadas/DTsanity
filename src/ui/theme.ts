import { h, icon } from './dom';

/**
 * Light or dark UI. The system setting decides until the person picks one;
 * the pick is kept in this browser only. index.html sets the attribute
 * before first paint, so the page never flashes the other theme.
 */

type Theme = 'light' | 'dark';
const KEY = 'tt-theme';
const dark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
const toggles = new Set<HTMLButtonElement>();

/** An on/off switch for dark: the knob carries the sun (off, light) or the moon (on, dark). */
function paint(b: HTMLButtonElement) {
  const on = current() === 'dark';
  b.setAttribute('aria-checked', String(on));
  b.querySelector('.theme-knob')!.replaceChildren(icon(on ? 'moon' : 'sun'));
  b.dataset.tip = on ? 'Dark theme: on' : 'Dark theme: off';
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  for (const b of toggles) paint(b);
  // Canvases read their colors when they draw.
  window.dispatchEvent(new Event('tt-theme'));
}

export function initTheme() {
  apply(stored() ?? (dark() ? 'dark' : 'light'));
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!stored()) apply(dark() ? 'dark' : 'light');
    });
  }
}

export function themeToggle(cls = ''): HTMLButtonElement {
  const b = h('button', {
    type: 'button',
    role: 'switch',
    'aria-label': 'Dark theme',
    class: `theme-toggle${cls ? ` ${cls}` : ''}`,
    onclick: () => {
      const next: Theme = current() === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* Not kept; it still applies for this visit. */
      }
      apply(next);
    },
  }, h('span', { class: 'theme-knob' })) as HTMLButtonElement;
  toggles.add(b);
  paint(b);
  return b;
}
