import { store, updateSettings } from '../state/app';
import { h } from './dom';

let count = 0;

/** Preferences bar. Settings persist locally and hold no token data. */
export class TTSettings extends HTMLElement {
  private unsub?: () => void;

  connectedCallback() {
    // Its own id: the setting shows in the Files view and on What to check.
    const id = `tt-legacy-${++count}`;
    const legacy = h('input', { type: 'checkbox', id, role: 'switch' });
    legacy.addEventListener('change', () => updateSettings({ acceptLegacy: legacy.checked }));
    this.replaceChildren(
      h(
        'div',
        { class: 'setting' },
        legacy,
        h(
          'label',
          { for: id },
          h('strong', null, 'Accept legacy formats'),
          h('span', null, 'Converts files in older formats (Tokens Studio, Style Dictionary v3 and similar) to DTCG.'),
        ),
      ),
    );
    this.unsub = store.select((s) => s.settings.acceptLegacy, (on) => (legacy.checked = on));
  }

  disconnectedCallback() {
    this.unsub?.();
  }
}
