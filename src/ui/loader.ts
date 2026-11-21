import { isUnchanged } from '../io/export';
import { ACCEPT, fetchSource, isLoadError, normalizeUrl, parseSource, pastedSource, pickFiles, readFiles, reloadSource, type RawSource } from '../io/load';
import type { SourceFile } from '../model/types';
import { addFiles, clearAll, replaceFiles, setBusy, store, type LoadError, type SetAside } from '../state/app';
import { createStore } from '../state/store';
import { targetSelect } from './contrast';
import { h, masked, plural } from './dom';
import { moreMenu, type MenuItem } from './menu';
import { promptButton } from './prompt-link';
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
    const setAside: SetAside[] = [];
    for (const r of await pending) {
      const parsed = 'text' in r ? parseSource(r, store.get().settings) : r;
      if (isLoadError(parsed)) (parsed.skipped ? setAside.push({ name: parsed.name, why: parsed.message }) : errors.push(parsed));
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
    if (adding.length || errors.length || setAside.length) addFiles(adding, errors, setAside);
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

let pickCount = 0;

/**
 * The drop zone's token-file icon: a file with “{ }” and “.JSON” cut out of
 * it, so the circle shows through. Fixed markup, never built from file data.
 * Drawn in the text color at 15%, with no shadow (see .token-file-icon).
 */
function tokenFileIcon(): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon token-file-icon" viewBox="0 0 500 500" aria-hidden="true" fill="currentColor" fill-rule="evenodd">
    <path class="tf-ink" transform="translate(-20 -20)" d="M420,70L420,395C420,436.394 386.394,470 345,470L120,470L120,70L420,70ZM237.503,324.915C238.842,324.915 239.512,324.245 239.512,322.905L239.512,309.795C239.512,308.455 238.842,307.785 237.503,307.785C234.678,307.785 232.474,307.454 230.89,306.792C229.306,306.13 228.207,305.071 227.594,303.616C226.98,302.161 226.674,300.226 226.674,297.811L226.674,272.611C226.674,268.549 225.717,265.184 223.805,262.516C221.892,259.849 219.155,258.148 215.592,257.414C219.174,256.663 221.917,254.958 223.819,252.3C225.722,249.642 226.674,246.282 226.674,242.22L226.674,217.104C226.674,214.708 226.975,212.788 227.579,211.342C228.183,209.897 229.277,208.834 230.861,208.152C232.445,207.47 234.659,207.129 237.503,207.129C238.842,207.129 239.512,206.46 239.512,205.12L239.512,192.009C239.512,190.67 238.842,190 237.503,190C229.863,190 223.738,190.97 219.128,192.91C214.518,194.851 211.181,198.01 209.117,202.389C207.053,206.767 206.021,212.68 206.021,220.128L206.021,242.902C206.021,244.741 205.647,246.097 204.899,246.971C204.151,247.845 202.921,248.282 201.208,248.282L196.661,248.282C195.321,248.282 194.652,248.952 194.652,250.291L194.652,264.54C194.652,265.878 195.321,266.547 196.661,266.547L201.208,266.547C202.921,266.547 204.151,266.979 204.899,267.843C205.647,268.707 206.021,270.069 206.021,271.929L206.021,294.787C206.021,302.119 207.048,307.998 209.101,312.424C211.155,316.849 214.487,320.038 219.098,321.988C223.709,323.939 229.844,324.915 237.503,324.915ZM269.946,449.588L276.679,449.588C277.242,449.588 277.524,449.306 277.524,448.743L277.524,422.362C277.524,420.831 277.508,419.293 277.475,417.746C277.443,416.2 277.402,414.685 277.352,413.203L277.546,413.203C278.12,414.544 278.73,415.959 279.377,417.448C280.024,418.938 280.695,420.44 281.39,421.955C282.086,423.469 282.792,424.96 283.51,426.427L294.779,448.984C294.973,449.387 295.303,449.588 295.768,449.588L305.881,449.588C306.427,449.588 306.7,449.306 306.7,448.743L306.7,403.273C306.7,402.71 306.427,402.428 305.881,402.428L299.096,402.428C298.55,402.428 298.277,402.71 298.277,403.273L298.277,426.022C298.277,427.285 298.297,428.685 298.337,430.223L298.461,434.8C298.502,436.314 298.556,437.727 298.623,439.038L298.43,439.038C297.999,437.854 297.496,436.588 296.919,435.24C296.342,433.892 295.701,432.477 294.997,430.996C294.292,429.514 293.534,427.977 292.723,426.385L281.162,403.032C280.968,402.629 280.638,402.428 280.173,402.428L269.946,402.428C269.382,402.428 269.1,402.71 269.1,403.273L269.1,448.743C269.1,449.306 269.382,449.588 269.946,449.588ZM297.149,324.915C304.829,324.915 310.969,323.939 315.57,321.988C320.17,320.038 323.497,316.849 325.552,312.424C327.606,307.998 328.633,302.119 328.633,294.787L328.633,271.929C328.633,270.069 329.007,268.707 329.755,267.843C330.502,266.979 331.733,266.547 333.446,266.547L337.993,266.547C339.331,266.547 340,265.878 340,264.54L340,250.291C340,248.952 339.331,248.282 337.993,248.282L333.446,248.282C331.733,248.282 330.502,247.845 329.755,246.971C329.007,246.097 328.633,244.741 328.633,242.902L328.633,220.128C328.633,212.68 327.601,206.767 325.537,202.389C323.473,198.01 320.136,194.851 315.525,192.91C310.914,190.97 304.788,190 297.149,190C295.811,190 295.142,190.67 295.142,192.009L295.142,205.12C295.142,206.46 295.811,207.129 297.149,207.129C300.09,207.129 302.329,207.47 303.865,208.152C305.401,208.834 306.471,209.897 307.075,211.342C307.678,212.788 307.98,214.708 307.98,217.104L307.98,242.22C307.98,246.282 308.931,249.642 310.833,252.3C312.735,254.958 315.477,256.663 319.059,257.414C315.498,258.148 312.762,259.849 310.849,262.516C308.937,265.184 307.98,268.549 307.98,272.611L307.98,297.811C307.98,300.226 307.673,302.161 307.059,303.616C306.445,305.071 305.365,306.13 303.819,306.792C302.273,307.454 300.05,307.785 297.149,307.785C295.811,307.785 295.142,308.455 295.142,309.795L295.142,322.905C295.142,324.245 295.811,324.915 297.149,324.915ZM158.854,460.471C162.831,459.739 165.821,457.882 167.823,454.901C169.825,451.92 170.826,447.743 170.826,442.371L170.826,403.273C170.826,402.71 170.544,402.428 169.981,402.428L163.025,402.428C162.461,402.428 162.179,402.71 162.179,403.273L162.179,442.934C162.179,445.83 161.708,448.113 160.766,449.783C159.824,451.453 158.419,452.503 156.551,452.933C155.626,453.156 155.252,453.565 155.43,454.16L157.204,460.008C157.381,460.507 157.931,460.661 158.854,460.471ZM240.368,450.452C246.685,450.452 251.432,448.926 254.609,445.874C257.787,442.822 259.375,438.433 259.375,432.706L259.375,419.31C259.375,413.536 257.787,409.134 254.609,406.106C251.432,403.078 246.685,401.564 240.368,401.564C234.052,401.564 229.305,403.078 226.128,406.106C222.95,409.134 221.362,413.536 221.362,419.31L221.362,432.706C221.362,438.433 222.95,442.822 226.128,445.874C229.305,448.926 234.052,450.452 240.368,450.452ZM240.368,442.876C236.977,442.876 234.402,441.976 232.645,440.175C230.887,438.373 230.008,435.752 230.008,432.309L230.008,419.707C230.008,416.234 230.887,413.604 232.645,411.818C234.402,410.033 236.977,409.14 240.368,409.14C243.808,409.14 246.394,410.033 248.128,411.818C249.862,413.604 250.729,416.234 250.729,419.707L250.729,432.309C250.729,435.752 249.862,438.373 248.128,440.175C246.394,441.976 243.808,442.876 240.368,442.876ZM144.503,450.452C146.376,450.452 147.767,449.988 148.674,449.061C149.581,448.134 150.035,446.895 150.035,445.345L150.035,444.124C150.035,442.541 149.581,441.294 148.674,440.383C147.767,439.473 146.376,439.018 144.503,439.018C142.662,439.018 141.28,439.473 140.356,440.383C139.432,441.294 138.97,442.541 138.97,444.124L138.97,445.345C138.97,446.895 139.432,448.134 140.356,449.061C141.28,449.988 142.662,450.452 144.503,450.452ZM196.212,450.452C202.368,450.452 206.859,449.316 209.687,447.044C212.514,444.773 213.937,441.538 213.954,437.339C213.97,435.225 213.683,433.398 213.091,431.859C212.499,430.32 211.515,428.965 210.137,427.795C208.76,426.624 206.909,425.549 204.585,424.57L194.244,420.178C192.799,419.575 191.664,418.981 190.839,418.394C190.014,417.808 189.426,417.17 189.076,416.481C188.726,415.792 188.551,415.005 188.551,414.119C188.583,412.361 189.221,411.054 190.467,410.198C191.712,409.343 193.564,408.915 196.024,408.915C198.8,408.915 200.946,409.475 202.46,410.594C203.974,411.714 204.652,413.248 204.494,415.197C204.446,415.658 204.494,415.989 204.639,416.189C204.784,416.389 204.993,416.489 205.267,416.489L212.1,416.489C212.616,416.489 212.913,416.059 212.992,415.197C213.266,412.213 212.759,409.719 211.471,407.715C210.183,405.711 208.229,404.193 205.608,403.16C202.987,402.128 199.798,401.611 196.039,401.611C190.747,401.611 186.747,402.693 184.04,404.857C181.332,407.022 179.954,410.137 179.906,414.205C179.906,416.193 180.198,417.952 180.781,419.483C181.365,421.014 182.349,422.372 183.733,423.559C185.118,424.745 186.972,425.836 189.297,426.832L199.756,431.273C201.154,431.845 202.258,432.409 203.068,432.964C203.878,433.52 204.454,434.146 204.795,434.842C205.137,435.538 205.307,436.36 205.307,437.308C205.307,439.254 204.59,440.697 203.154,441.638C201.719,442.578 199.548,443.048 196.64,443.048C193.655,443.048 191.44,442.504 189.996,441.415C188.551,440.327 187.846,438.619 187.879,436.291C187.895,435.573 187.591,435.214 186.965,435.214L180.203,435.214C179.625,435.214 179.303,435.621 179.239,436.435C178.867,440.852 180.08,444.293 182.876,446.756C185.673,449.22 190.118,450.452 196.212,450.452Z"/>
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
        h('strong', { class: 'zone-title' }, phone ? 'Select design tokens JSON files' : 'Drop your design tokens JSON files or folders here'),
        // On phones the title says it all; desktop adds that a click works too.
        phone ? null : h('span', { class: 'zone-sub' }, 'or click to select them, or paste code'),
      ),
    );

    // One field for both: a link to a token file, or token code pasted in. What it holds decides what
    // happens: a link is fetched (without cookies or referrer); code is checked as “Pasted code”.
    const field = masked(
      h('textarea', {
        id: 'tt-load',
        // Phones start on one line, so the drop circle stays the first thing; it grows with pasted code.
        rows: phone ? 1 : 4,
        spellcheck: 'false',
        autocomplete: 'off',
        placeholder: 'https://… or { … }',
        'aria-describedby': 'tt-load-hint',
      }),
    );
    const hint = h('small', { class: 'hint', id: 'tt-load-hint', 'aria-live': 'polite' });
    const submit = h('button', { type: 'submit', disabled: true }, 'Load');
    /** What the field holds: nothing yet, JSON (it starts like JSON), or a link. */
    const kindOf = (v: string): 'empty' | 'json' | 'link' => {
      const t = v.trim();
      return !t ? 'empty' : /^[[{"]/.test(t) ? 'json' : 'link';
    };
    // Four lines to start (one on phones); it grows with pasted code, up to about ten lines, then scrolls.
    const fit = () => {
      field.style.height = 'auto';
      // The cap is the field's max-height, in rem, so it grows with the page's text size.
      const cap = parseFloat(getComputedStyle(field).maxHeight) || 240;
      field.style.height = `${Math.min(field.scrollHeight + 2, cap)}px`;
    };
    const update = () => {
      const kind = kindOf(field.value);
      field.classList.toggle('is-json', kind === 'json');
      submit.disabled = kind === 'empty';
      submit.textContent = kind === 'json' ? 'Check' : 'Load';
      let github = false;
      if (kind === 'link') {
        try {
          github = normalizeUrl(field.value.trim()).rewritten;
        } catch {
          /* not a URL yet */
        }
      }
      hint.classList.remove('error');
      field.removeAttribute('aria-invalid');
      hint.textContent = kind === 'json' ? 'Code: checked here as pasted code. ⌘↩ to check.' : github ? 'GitHub link: the raw file will be loaded.' : '';
      fit();
    };
    field.addEventListener('input', update);
    update();
    // A problem with what was typed or pasted is said right here, under the field, which turns red until it changes.
    const invalid = (message: string) => {
      hint.classList.add('error');
      hint.textContent = message;
      field.setAttribute('aria-invalid', 'true');
    };
    const go = () => {
      const kind = kindOf(field.value);
      if (kind === 'link') {
        let url: URL | null = null;
        try {
          url = normalizeUrl(field.value.trim()).url;
        } catch {
          /* not a link */
        }
        if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return invalid('Please enter valid JSON code or a files repository URL.');
        return void ingest(
          fetchSource(field.value.trim()).then((r) => {
            if ('text' in r) return [r];
            invalid(r.message);
            return [];
          }),
        );
      }
      if (kind !== 'json') return;
      const raw = pastedSource(field.value, store.get().files.map((f) => f.name));
      const parsed = parseSource(raw, store.get().settings);
      if (isLoadError(parsed)) return invalid(parsed.skipped ? 'No design tokens in it.' : `${parsed.line ? `Line ${parsed.line}, column ${parsed.col}: ` : ''}${parsed.message}`);
      field.value = '';
      update();
      void ingest(Promise.resolve([raw]));
    };
    // Enter loads a link; in JSON it starts a new line, and ⌘/Ctrl+Enter checks it.
    field.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (kindOf(field.value) === 'link' || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        go();
      }
    });
    const form = h(
      'form',
      {
        class: 'url-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          go();
        },
      },
      h('label', { for: 'tt-load' }, 'Load files from a link, or paste code'),
      field,
      hint,
      // Under the field, where pasted code ends.
      h('div', { class: 'load-actions' }, submit),
    );

    const errors = masked(h('div', { class: 'load-errors', role: 'alert' }));

    this.replaceChildren(h('div', { class: 'loader' }, input, zone, form), errors);

    // The circle's width, for layouts that set the field as wide as the circle above it.
    const sizer = new ResizeObserver(() => form.style.setProperty('--zone-w', `${zone.getBoundingClientRect().width}px`));
    sizer.observe(zone);

    this.unsubs.push(
      () => sizer.disconnect(),
      // Before any file is loaded, the Files view is a centered landing.
      store.select(
        (s) => s.files.length === 0,
        (empty) => this.closest('.view')?.toggleAttribute('data-empty', empty),
      ),
      store.select(
        (s) => s.busy,
        (busy) => {
          this.toggleAttribute('aria-busy', busy);
          // Loading disables it; an empty field keeps it disabled after.
          submit.disabled = busy || !field.value.trim();
          submit.textContent = busy ? 'Loading…' : 'Load';
        },
      ),
      store.select(
        (s) => s.loadErrors,
        (list) =>
          errors.replaceChildren(
            // The unread files are a group too: their findings report asks to make them valid first.
            // Phones copy only from the footer.
            list.length ? h('div', { class: 'prompt-row' }, h('span', { class: 'prompt-row-text' }, `${plural(list.length, 'file')} couldn't be read`), phone ? null : promptButton({ files: true })) : '',
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
