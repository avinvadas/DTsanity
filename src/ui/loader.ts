import { isUnchanged } from '../io/export';
import { ACCEPT, fetchSource, isLoadError, normalizeUrl, parseSource, pickFiles, readFiles, reloadSource, type RawSource } from '../io/load';
import type { SourceFile } from '../model/types';
import { addFiles, clearAll, replaceFiles, setBusy, store, type LoadError } from '../state/app';
import { createStore } from '../state/store';
import { targetSelect } from './contrast';
import { h, masked, plural } from './dom';
import { moreMenu, type MenuItem } from './menu';
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
    // A file named like a loaded one replaces it; if that one has edits not yet downloaded, ask first.
    const edited = new Set(store.get().files.filter((f) => !isUnchanged(f)).map((f) => f.name));
    const clashes = files.filter((f) => edited.has(f.name)).map((f) => f.name);
    const keep =
      !clashes.length ||
      confirm(`Replace ${clashes.join(', ')}? Your changes to ${clashes.length === 1 ? 'it' : 'them'} haven't been downloaded and will be lost.`);
    const adding = keep ? files : files.filter((f) => !edited.has(f.name));
    if (ring) await ring;
    if (view && adding.length) await fadeOut(view);
    if (adding.length || errors.length) addFiles(adding, errors);
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
    const summary = parts.join(' · ');
    fileStatus.set({ at: new Date() });
    return summary;
  } finally {
    setBusy(false);
  }
}

/**
 * The contrast target every pair is measured against: a labeled dropdown,
 * kept in step with the setting wherever it changes. Returns it and an unsubscribe.
 */
export function contrastControl(className = 'contrast-pick'): { el: HTMLElement; unsub: () => void } {
  const pickId = `contrast-pick-${++pickCount}`;
  const target = targetSelect(store.get().settings, pickId);
  const unsub = store.select((s) => s.settings.contrast, (c) => {
    target.value = c[0] ?? 'wcag';
    target.dataset.tip = TIP.targets[c[0] ?? 'wcag'];
  });
  return { el: h('div', { class: className }, h('label', { class: 'pick-label', for: pickId }, 'Contrast'), target), unsub };
}

/**
 * The controls at the right of every view's header: a status line for the
 * view's own messages. The contrast target and the file actions are global,
 * so they sit in the sidebar under the logo. Returns the element, its status
 * line and an unsubscribe.
 */
export function viewControls(): { el: HTMLElement; status: HTMLElement; unsub: () => void } {
  const status = h('span', { class: 'reload-status', role: 'status' });
  return { el: h('div', { class: 'reload-wrap' }, status), status, unsub: () => {} };
}

/** Clear every file, asking first when edits made here haven't been downloaded (they live only in this tab). */
export function confirmClearAll() {
  const edited = store.get().files.filter((f) => !isUnchanged(f)).length;
  if (edited && !confirm(`Clear all files? Changes to ${plural(edited, 'file')} haven't been downloaded and will be lost.`)) return;
  clearAll();
}

/** The last change to the loaded files: what happened (and any detail) and when. */
export const fileStatus = createStore<{ at: Date | null }>({ at: null });
store.select(
  (s) => s.files,
  (files, prev) => {
    if (prev && files.length) fileStatus.set({ at: new Date() });
  },
);

/**
 * The status line: how many files, and when they were last updated (loaded,
 * reloaded, added, removed or edited). Nothing more, unless a file couldn't
 * be read (missing, or damaged): then it says which, as an error.
 * Returns it and an unsubscribe.
 */
export function fileStatusLine(tag: 'p' | 'span' = 'p'): { el: HTMLElement; unsub: () => void } {
  const el = h(tag, { class: 'files-status', role: 'status' });
  const paint = () => {
    const { files, loadErrors } = store.get();
    const { at } = fileStatus.get();
    const time = at?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const text = files.length ? [plural(files.length, 'file'), time ? `Updated ${time}` : ''].filter(Boolean).join(' · ') : '';
    const failed = loadErrors.length === 1 ? `${loadErrors[0].name} couldn't be read` : loadErrors.length ? `${plural(loadErrors.length, 'file')} couldn't be read` : '';
    // Masked: the error names a file.
    el.replaceChildren(text, failed ? masked(h('span', { class: 'files-error' }, failed)) : '');
  };
  const unsubs = [fileStatus.select((s) => s, paint), store.select((s) => s.files, paint), store.select((s) => s.loadErrors, paint)];
  return { el, unsub: () => unsubs.forEach((u) => u()) };
}

let iconCount = 0;
let pickCount = 0;

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

/**
 * The loaded files at a glance, under the logo: the status line on the left,
 * the file actions in a menu on the right. Returns it and an unsubscribe.
 */
export function filesBar(items: MenuItem[]): { el: HTMLElement; unsub: () => void } {
  const status = fileStatusLine();
  const el = h('div', { class: 'files-bar' }, status.el, moreMenu('File actions', items));
  return { el, unsub: status.unsub };
}
