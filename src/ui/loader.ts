import { isUnchanged } from '../io/export';
import { ACCEPT, fetchSource, isLoadError, normalizeUrl, parseSource, pickFiles, pickFolder, readFiles, reloadSource, type RawSource } from '../io/load';
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
 * The drop zone's JSON-file icon (json_file_icon.svg). Fixed markup, never
 * built from file data. The outline and the label follow the text color and
 * the letters the page color, so it suits both themes. The file body has a
 * solid base in the page color, so the whole file casts its shadow. Each copy
 * gets its own gradient id, as the landing and the dialog both show one.
 */
function tokenFileIcon(): SVGSVGElement {
  const id = `tt-tf-${++iconCount}`;
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon token-file-icon" viewBox="0 0 500 500" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(300,-400,400,300,100,450)"><stop offset="0" stop-color="currentColor" stop-opacity="0.07"/><stop offset="1" stop-color="currentColor" stop-opacity="0.13"/></linearGradient></defs>
    <path class="tf-base" d="M400,50L400,375C400,416.394 366.394,450 325,450L100,450L100,50L400,50Z" stroke="none"/>
    <path d="M400,50L400,375C400,416.394 366.394,450 325,450L100,450L100,50L400,50Z" fill="url(#${id})" stroke-width="8"/>
    <rect x="100" y="280" width="200" height="100" fill="currentColor" stroke="none"/>
    <g class="tf-label" transform="matrix(0.951261,0,0,1.18908,38.744,-75.53)" stroke="none">
      <path d="M91.238,371.106C90.132,371.299 89.491,371.19 89.314,370.779L87.675,366.356C87.499,365.86 87.949,365.509 89.028,365.302C91.164,364.895 92.768,363.936 93.84,362.423C94.913,360.911 95.449,358.872 95.449,356.305L95.449,320.627C95.449,320.166 95.736,319.936 96.311,319.936L102.661,319.936C103.236,319.936 103.524,320.166 103.524,320.627L103.524,355.938C103.524,360.366 102.488,363.828 100.415,366.324C98.342,368.82 95.283,370.414 91.238,371.106Z"/>
      <path d="M132.185,362.624C125.617,362.624 120.812,361.527 117.77,359.333C114.729,357.139 113.389,354.184 113.751,350.467C113.813,349.72 114.15,349.346 114.762,349.346L120.926,349.346C121.591,349.346 121.919,349.677 121.911,350.339C121.894,352.7 122.775,354.408 124.552,355.464C126.329,356.521 129.047,357.049 132.707,357.049C136.242,357.049 138.902,356.562 140.689,355.589C142.475,354.616 143.369,353.131 143.369,351.134C143.369,350.146 143.159,349.296 142.739,348.584C142.32,347.873 141.614,347.242 140.624,346.691C139.633,346.141 138.289,345.588 136.594,345.031L124.897,341.107C122.385,340.262 120.364,339.327 118.836,338.3C117.308,337.274 116.214,336.097 115.556,334.768C114.898,333.44 114.569,331.921 114.569,330.21C114.622,326.635 116.125,323.909 119.078,322.034C122.031,320.159 126.357,319.222 132.055,319.222C136.018,319.222 139.418,319.675 142.255,320.581C145.092,321.487 147.228,322.81 148.664,324.55C150.099,326.291 150.675,328.439 150.391,330.995C150.293,331.785 149.983,332.18 149.461,332.18L143.217,332.18C142.933,332.18 142.718,332.093 142.572,331.919C142.427,331.745 142.38,331.437 142.434,330.995C142.63,329.021 141.786,327.488 139.901,326.395C138.016,325.302 135.354,324.756 131.916,324.756C128.87,324.756 126.575,325.185 125.029,326.043C123.484,326.901 122.689,328.22 122.644,330.001C122.644,330.917 122.856,331.724 123.28,332.421C123.704,333.118 124.423,333.76 125.436,334.346C126.449,334.932 127.844,335.522 129.621,336.115L141.171,340.019C143.683,340.856 145.694,341.779 147.204,342.787C148.715,343.796 149.801,344.966 150.464,346.297C151.126,347.629 151.453,349.222 151.444,351.077C151.435,354.728 149.888,357.566 146.802,359.589C143.715,361.612 138.843,362.624 132.185,362.624Z"/>
      <path d="M180.93,362.624C174.103,362.624 168.993,361.292 165.6,358.627C162.207,355.963 160.51,352.171 160.51,347.251L160.51,334.541C160.51,329.578 162.207,325.775 165.6,323.132C168.993,320.489 174.103,319.168 180.93,319.168C187.757,319.168 192.867,320.489 196.261,323.132C199.654,325.775 201.351,329.578 201.351,334.541L201.351,347.251C201.351,352.171 199.654,355.963 196.261,358.627C192.867,361.292 187.757,362.624 180.93,362.624ZM180.93,356.945C184.995,356.945 188.069,356.104 190.152,354.422C192.235,352.74 193.276,350.284 193.276,347.055L193.276,334.737C193.276,331.472 192.235,329.007 190.152,327.343C188.069,325.679 184.995,324.847 180.93,324.847C176.919,324.847 173.859,325.679 171.749,327.343C169.64,329.007 168.585,331.472 168.585,334.737L168.585,347.055C168.585,350.284 169.64,352.74 171.749,354.422C173.859,356.104 176.919,356.945 180.93,356.945Z"/>
      <path d="M214.021,361.856C213.446,361.856 213.158,361.626 213.158,361.165L213.158,320.627C213.158,320.166 213.446,319.936 214.021,319.936L224.248,319.936C224.745,319.936 225.086,320.099 225.271,320.424L239.313,343.195C240.277,344.7 241.147,346.1 241.925,347.397C242.702,348.694 243.404,349.917 244.03,351.067C244.656,352.217 245.223,353.322 245.731,354.381L245.916,354.381C245.882,353.2 245.854,351.949 245.833,350.627C245.813,349.306 245.785,347.973 245.75,346.63C245.715,345.287 245.697,344.047 245.697,342.909L245.697,320.627C245.697,320.166 245.981,319.936 246.547,319.936L252.766,319.936C253.333,319.936 253.617,320.166 253.617,320.627L253.617,361.165C253.617,361.626 253.333,361.856 252.766,361.856L242.728,361.856C242.232,361.856 241.891,361.693 241.705,361.368L227.941,339.267C227.113,337.906 226.305,336.565 225.518,335.244C224.731,333.923 223.97,332.612 223.236,331.311C222.502,330.011 221.801,328.741 221.132,327.502L220.947,327.502C220.972,328.892 221,330.26 221.032,331.606C221.063,332.952 221.078,334.289 221.078,335.617L221.078,361.165C221.078,361.626 220.791,361.856 220.215,361.856L214.021,361.856Z"/>
    </g>
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
        h('strong', { class: 'zone-title' }, phone ? 'Select design tokens JSON files' : 'Drop design tokens JSON files or folders here'),
        // On phones the title says it all; desktop adds that a click works too.
        phone ? null : h('span', { class: 'zone-sub' }, 'or click to select them'),
      ),
    );

    // A whole folder, read with every file's path in it, so same-named files in different folders (one per theme) stay apart.
    const folderInput = h('input', {
      type: 'file',
      class: 'visually-hidden',
      tabindex: '-1',
      'aria-hidden': 'true',
      onchange: () => {
        if (folderInput.files?.length) void ingest(readFiles(folderInput.files));
        folderInput.value = '';
      },
    });
    folderInput.setAttribute('webkitdirectory', '');
    const folder = phone
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: 'link folder-pick',
            'data-tip': TIP.chooseFolder,
            onclick: async () => {
              const picked = await pickFolder(folderInput);
              if (picked) void ingest(Promise.resolve(picked));
            },
          },
          'Or choose a folder',
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
      h('label', { for: 'tt-url' }, 'Load from a link (Github, etc.):'),
      h('div', { class: 'row' }, url, submit),
      hint,
    );

    const errors = masked(h('div', { class: 'load-errors', role: 'alert' }));

    this.replaceChildren(h('div', { class: 'loader' }, input, folderInput, zone, folder, form), errors);

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
