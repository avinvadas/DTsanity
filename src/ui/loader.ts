import { isUnchanged } from '../io/export';
import { ACCEPT, fetchSource, isLoadError, normalizeUrl, parseSource, pickFiles, readFiles, reloadSource, type RawSource } from '../io/load';
import type { SourceFile } from '../model/types';
import { addFiles, replaceFiles, setBusy, store, type LoadError } from '../state/app';
import { h, icon, masked, plural } from './dom';
import { openFilesDialog } from './files-dialog';
import { TIP } from './tips';

/** Length of each step on the first load: the ring fill, the landing fading out, the results fading in. */
export const LOAD_MS = 330;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Settle the drop zone halfway back and fill its ring clockwise; resolves when the ring is full. */
function fillRing(zone: HTMLElement): Promise<void> {
  zone.classList.remove('loading');
  void zone.offsetWidth;
  zone.classList.add('loading');
  return wait(LOAD_MS);
}

/** Fade the whole landing out; resolves when it is gone. */
function fadeOut(view: HTMLElement): Promise<void> {
  view.classList.add('fade-out');
  return wait(LOAD_MS);
}

/** Parse sources and add them to the store, collecting errors for display. */
export async function ingest(pending: Promise<(RawSource | LoadError)[]>) {
  setBusy(true);
  // The first load plays out on the landing: ring fill, fade out, then the results fade in.
  const zone = store.get().files.length === 0 && !reducedMotion() ? document.querySelector<HTMLElement>('.dropzone') : null;
  const view = zone?.closest<HTMLElement>('.view');
  const ring = zone ? fillRing(zone) : null;
  try {
    const files: SourceFile[] = [];
    const errors: LoadError[] = [];
    for (const r of await pending) {
      const parsed = 'text' in r ? parseSource(r, store.get().settings) : r;
      if (isLoadError(parsed)) errors.push(parsed);
      else files.push(parsed);
    }
    if (ring) await ring;
    if (view && files.length) await fadeOut(view);
    addFiles(files, errors);
  } finally {
    zone?.classList.remove('loading');
    view?.classList.remove('fade-out');
    setBusy(false);
  }
}

/**
 * Read every loaded file from its source again (disk or URL) and re-run the
 * checks. Files whose source and content are unchanged keep their undo
 * history. Returns a short summary, or null if the user cancelled.
 */
export async function reloadAll(): Promise<string | null> {
  const files = store.get().files;
  const edited = files.filter((f) => !isUnchanged(f));
  if (edited.length && !confirm(`Reloading replaces your unsaved edits in ${edited.map((f) => f.name).join(', ')}. Continue?`)) return null;
  setBusy(true);
  try {
    const results = await Promise.all(files.map(async (f) => [f, await reloadSource(f)] as const));
    const updated: SourceFile[] = [];
    const errors: LoadError[] = [];
    let changed = 0;
    for (const [old, r] of results) {
      const parsed = 'text' in r ? parseSource(r, store.get().settings) : r;
      if (isLoadError(parsed)) {
        errors.push({ ...parsed, name: old.name });
        continue;
      }
      const textChanged = parsed.text !== old.text;
      if (textChanged) changed++;
      if (textChanged || edited.includes(old)) updated.push({ ...parsed, id: old.id, name: old.name });
    }
    replaceFiles(updated, errors);
    const parts = [changed ? `${plural(changed, 'file')} changed` : 'No changes in the source files'];
    if (errors.length) parts.push(`${plural(errors.length, 'file')} couldn't be reloaded`);
    return parts.join(' · ');
  } finally {
    setBusy(false);
  }
}

const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * The loaded file set as a split button: the main part says how many files
 * are read and reloads them from disk or their URL (without loading them
 * anew); the menu beside it offers Reload files and Add more files, which
 * opens the loader in a dialog over the current view. Disabled while
 * loading. Returns the element, its status line and an unsubscribe.
 */
export function reloadControl(tip: string): { el: HTMLElement; status: HTMLElement; unsub: () => void } {
  const status = h('span', { class: 'reload-status', role: 'status' });
  const reload = async () => {
    menu.hidePopover();
    status.replaceChildren('');
    const summary = await reloadAll();
    if (summary) status.replaceChildren(`${summary} · ${timeNow()}`);
  };
  const count = h('span', null);
  const main = h('button', { type: 'button', class: 'reload split-main', 'data-tip': tip, onclick: reload }, h('span', { 'aria-hidden': 'true' }, '↻ '), count);
  const toggle = h('button', { type: 'button', class: 'split-toggle', 'aria-label': 'File actions', 'aria-haspopup': 'menu', 'data-tip': TIP.fileActions }, icon('chevron-down'));
  const item = (label: string, tipText: string, act: () => void) => h('button', { type: 'button', role: 'menuitem', class: 'menu-item', 'data-tip': tipText, onclick: act }, label);
  const menu = h(
    'div',
    { class: 'split-menu', popover: 'auto', role: 'menu', 'aria-label': 'File actions' },
    item('Reload files', tip, () => void reload()),
    item('Add more files…', TIP.addMoreFiles, () => {
      menu.hidePopover();
      openFilesDialog();
    }),
  );
  // Below the toggle, right edges aligned, kept on screen.
  menu.addEventListener('toggle', (e) => {
    toggle.setAttribute('aria-expanded', String((e as ToggleEvent).newState === 'open'));
    if ((e as ToggleEvent).newState !== 'open') return;
    const b = split.getBoundingClientRect();
    menu.style.top = `${b.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(b.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.querySelector<HTMLElement>('.menu-item')?.focus();
  });
  toggle.addEventListener('click', () => menu.togglePopover());
  const split = h('div', { class: 'split-button' }, main, toggle, menu);
  const unsubs = [
    store.select((s) => s.busy, (busy) => (main.disabled = toggle.disabled = busy)),
    store.select((s) => s.files.length, (n) => (count.textContent = `${plural(n, 'file')} loaded`)),
  ];
  return { el: h('div', { class: 'reload-wrap' }, status, split), status, unsub: () => unsubs.forEach((u) => u()) };
}

let iconCount = 0;

/**
 * The drop zone's token-file icon. Fixed markup, never built from file data.
 * Strokes follow the text color so it suits both themes. The file body has a
 * solid base in the page color, so the whole file casts its shadow (the
 * translucent gradient alone barely does); the color point in
 * the middle cycles through the hues (see .tf-point in styles.css). Each
 * copy gets its own gradient id, as the landing and the dialog both show one.
 */
function tokenFileIcon(): SVGSVGElement {
  const id = `tt-tf-${++iconCount}`;
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon token-file-icon" viewBox="0 0 500 500" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(300,-400,400,300,100,450)"><stop offset="0" stop-color="white" stop-opacity="0.07"/><stop offset="1" stop-color="white" stop-opacity="0.15"/></linearGradient></defs>
    <path class="tf-base" d="M400,50l0,325c0,41.394 -33.606,75 -75,75l-225,0l0,-400l300,0Z" stroke="none"/>
    <path d="M400,50l0,325c0,41.394 -33.606,75 -75,75l-225,0l0,-400l300,0Z" fill="url(#${id})" stroke-opacity="0.25" vector-effect="non-scaling-stroke"/>
    <path stroke-opacity="0.5" vector-effect="non-scaling-stroke" d="M250,352.392l-82.562,-44.721c-7.664,-4.152 -12.438,-12.167 -12.438,-20.883l-0,-92.729m95,158.333l82.562,-44.721c7.664,-4.152 12.438,-12.167 12.438,-20.883l-0,-92.729m-95,158.333l-0,-71.25m-95,-87.083l84.029,-43.765c6.875,-3.581 15.067,-3.581 21.942,-0l84.029,43.765m-190,-0l63.669,34.488m126.331,-34.488l-63.669,34.488m-31.331,52.595c19.676,0 35.625,-15.949 35.625,-35.625c-0,-6.144 -1.556,-11.925 -4.294,-16.97m-31.331,52.595c-19.676,0 -35.625,-15.949 -35.625,-35.625c-0,-6.144 1.556,-11.925 4.294,-16.97m62.662,-0c-6.031,-11.112 -17.801,-18.655 -31.331,-18.655c-13.53,0 -25.3,7.543 -31.331,18.655"/>
    <circle class="tf-point" cx="250" cy="245" r="20" stroke="none"/>
  </svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}

export class TTLoader extends HTMLElement {
  private unsubs: (() => void)[] = [];

  connectedCallback() {
    const phone = !!this.closest('tt-mobile');
    const input = h('input', {
      type: 'file',
      class: 'visually-hidden',
      tabindex: '-1',
      'aria-hidden': 'true',
      multiple: true,
      accept: ACCEPT,
      onchange: () => {
        if (input.files?.length) void ingest(readFiles(input.files));
        input.value = '';
      },
    });

    const zone = h(
      'button',
      {
        type: 'button',
        class: 'dropzone',
        'data-tip': TIP.dropzone,
        onclick: async () => {
          const picked = await pickFiles(input);
          if (picked) void ingest(Promise.resolve(picked));
        },
      },
      h('span', { class: 'zone-ring', 'aria-hidden': 'true' }),
      tokenFileIcon(),
      // Phones can't drag files, so there the zone is a button to choose them.
      h(
        'span',
        { class: 'zone-text' },
        h('strong', { class: 'zone-title' }, phone ? 'Choose token files' : 'Drop JSON tokens files here'),
        h('span', { class: 'zone-sub' }, phone ? 'From Files, iCloud or Drive. DTCG .json, several at once.' : 'or click to select them'),
      ),
    );

    const url = masked(h('input', { type: 'url', id: 'tt-url', placeholder: 'https://…/tokens.json', autocomplete: 'off', spellcheck: 'false', required: true }));
    const hint = h('small', { class: 'hint' }, 'Fetched without cookies or referrer.');
    url.addEventListener('input', () => {
      let rewritten = false;
      try {
        rewritten = normalizeUrl(url.value).rewritten;
      } catch {
        /* not a URL yet */
      }
      hint.textContent = rewritten
        ? 'GitHub link: the raw file will be loaded.'
        : 'Fetched without cookies or referrer.';
    });
    const submit = h('button', { type: 'submit' }, 'Load');
    const form = h(
      'form',
      {
        class: 'url-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (url.value.trim()) void ingest(fetchSource(url.value).then((r) => [r]));
        },
      },
      h('label', { for: 'tt-url' }, 'Or load from an external link:'),
      h('div', { class: 'row' }, url, submit),
      hint,
    );

    const errors = masked(h('div', { class: 'load-errors', role: 'alert' }));

    this.replaceChildren(h('div', { class: 'loader' }, input, zone, form), errors);

    this.unsubs.push(
      // Before any file is loaded, the Files view is a centered landing.
      store.select(
        (s) => s.files.length === 0,
        (empty) => this.closest('.view')?.toggleAttribute('data-empty', empty),
      ),
      store.select(
        (s) => s.busy,
        (busy) => {
          this.toggleAttribute('aria-busy', busy);
          submit.disabled = busy;
          submit.textContent = busy ? 'Loading…' : 'Load';
        },
      ),
      store.select(
        (s) => s.loadErrors,
        (list) =>
          errors.replaceChildren(
            ...list.map((e) =>
              h(
                'div',
                { class: 'load-error' },
                h('strong', null, e.name),
                e.line ? ` (line ${e.line}, column ${e.col})` : '',
                h('p', null, e.message),
                e.excerpt ? h('pre', null, e.excerpt) : null,
              ),
            ),
          ),
      ),
    );
  }

  disconnectedCallback() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }
}
