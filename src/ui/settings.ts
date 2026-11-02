import { store, updateSettings } from '../state/app';
import { h } from './dom';

/** Preferences bar. Settings persist locally and hold no token data. */
export class TTSettings extends HTMLElement {
  private unsub?: () => void;

  connectedCallback() {
    const legacy = h('input', { type: 'checkbox', id: 'tt-legacy', role: 'switch' });
    legacy.addEventListener('change', () => updateSettings({ acceptLegacy: legacy.checked }));
    this.replaceChildren(
      h(
        'div',
        { class: 'setting' },
        legacy,
        h(
          'label',
          { for: 'tt-legacy' },
          h('strong', null, 'Accept legacy formats'),
          h('span', null, 'Converts Tokens Studio and Style Dictionary v3 files to DTCG.'),
        ),
      ),
    );
    this.unsub = store.select((s) => s.settings.acceptLegacy, (on) => (legacy.checked = on));
  }

  disconnectedCallback() {
    this.unsub?.();
  }
}
