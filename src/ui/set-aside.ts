import { NO_TOKENS_INSIDE, NOT_A_TOKEN_FILE } from '../io/load';
import { dismissSetAside, store, type SetAside } from '../state/app';
import { h, masked, severityIcon, xButton } from './dom';

/** How many names a reason lists before “and N more”. */
const SHOWN = 5;

const names = (list: SetAside[]) => {
  const shown = list.slice(0, SHOWN).map((x) => x.name.split('/').at(-1)!);
  return list.length > SHOWN ? `${shown.join(', ')} and ${list.length - SHOWN} more` : shown.join(', ');
};

/**
 * A note at the top of the page about files the last load set aside: files
 * that aren't token files by their type (a CSS module, a README), and JSON
 * with no design tokens in it (a translation, a config). Not findings: they
 * aren't counted or reported. It stays until closed or the next load.
 */
export class TTSetAside extends HTMLElement {
  private unsub?: () => void;

  connectedCallback() {
    this.unsub = store.select(
      (s) => s.setAside,
      (list) => this.render(list),
    );
  }

  disconnectedCallback() {
    this.unsub?.();
  }

  private render(list: SetAside[]) {
    this.hidden = !list.length;
    if (!list.length) return this.replaceChildren();
    const byType = list.filter((x) => x.why === NOT_A_TOKEN_FILE);
    const empty = list.filter((x) => x.why === NO_TOKENS_INSIDE);
    const other = list.filter((x) => x.why !== NOT_A_TOKEN_FILE && x.why !== NO_TOKENS_INSIDE);
    const parts = [
      byType.length ? `not token files: ${names(byType)}` : '',
      empty.length ? `JSON with no design tokens in it: ${names(empty)}` : '',
      other.length ? names(other) : '',
    ].filter(Boolean);
    this.replaceChildren(
      h(
        'div',
        { class: 'set-aside', role: 'status' },
        severityIcon('info'),
        masked(h('p', null, h('strong', null, `${list.length === 1 ? '1 file' : `${list.length} files`} set aside`), ` — ${parts.join('; ')}. They weren't checked, and aren't counted.`)),
        xButton('Close this note', dismissSetAside, undefined, 'set-aside-close'),
      ),
    );
  }
}
