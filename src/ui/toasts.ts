import type { Fix } from '../model/types';
import type { Edit } from '../model/types';
import { applyEdits, applyFixes, store, undo, type AppState } from '../state/app';
import { h, masked, xButton } from './dom';
import { changeText, findingChange, findings } from './findings';

/**
 * Fix results, as notes stacked in the bottom right corner, newest at the
 * bottom. Each stays until it is closed; past MAX, the oldest goes. A note's
 * Undo shows only while its change is the last one made: undoing undoes the
 * last change, so on an older note it would undo something else. Once undone,
 * a note keeps no Undo.
 *
 * Notes belong to the page they were made on: they go when another page
 * opens, and when the files are read again.
 */

const MAX = 4;

let stack: HTMLElement | undefined;

/** Closes every note. */
export function clearToasts() {
  stack?.querySelectorAll<HTMLButtonElement>('.toast-close').forEach((b) => b.click());
}

// Another page: the view part of the address changes ("#issues" to "#semantic"; "#semantic/…" places stay on the page).
const viewOf = (hash: string) => hash.slice(1).split('/')[0];
let view = viewOf(location.hash);
window.addEventListener('hashchange', () => {
  const next = viewOf(location.hash);
  if (next !== view) clearToasts();
  view = next;
});

function host(): HTMLElement {
  if (stack?.isConnected) return stack;
  stack = h('div', { class: 'toasts', role: 'region', 'aria-label': 'Fix results', 'aria-live': 'polite' });
  document.body.append(stack);
  return stack;
}

type Command = AppState['past'][number];

/** Adds a note: its first line, what the fresh check found, and Undo while `command` is the last change. */
export function toast(title: string, detail: string, command?: Command, undone = `Undone: ${title}`): HTMLElement {
  // Masked: notes name tokens and files.
  const text = masked(h('div', { class: 'toast-text' }, h('p', { class: 'toast-title' }, title), h('p', { class: 'toast-detail' }, detail)));
  // Actions sit under the text, left-aligned, clear of the close button.
  const actions = h('div', { class: 'toast-actions' });
  let unsub = () => {};
  const close = () => {
    unsub();
    el.remove();
  };
  const el = h('div', { class: 'toast', role: 'status' }, h('div', { class: 'toast-body' }, text, actions), xButton('Close', close, undefined, 'toast-close'));

  if (command) {
    const undoButton = h(
      'button',
      {
        type: 'button',
        class: 'link toast-undo',
        onclick: () => {
          const before = findings(store.get());
          undo();
          unsub();
          undoButton.remove();
          text.replaceChildren(h('p', { class: 'toast-title' }, undone), h('p', { class: 'toast-detail' }, `${changeText(findingChange(before, findings(store.get())))}.`));
        },
      },
      'Undo',
    );
    actions.append(undoButton);
    // Undo only while this change is the last one: a later change or ⌘Z hides it, undoing that later change shows it again.
    unsub = store.subscribe((s) => (undoButton.hidden = s.past.at(-1) !== command));
  }

  const root = host();
  root.append(el);
  while (root.children.length > MAX) (root.firstElementChild as HTMLElement).querySelector<HTMLButtonElement>('.toast-close')!.click();
  return el;
}

/**
 * Applies fixes and says what happened in a note: how many were applied, and
 * what the fresh check of every file found, gone and new.
 */
export function applyWithToast(fixes: Fix[], label?: string): number {
  const before = findings(store.get());
  const last = store.get().past.at(-1);
  const applied = applyFixes(fixes, label);
  const waiting = fixes.length - applied;
  const command = store.get().past.at(-1);
  const title = fixes.length === 1 ? `Applied: ${fixes[0]!.label}` : `Applied ${applied} fixes${waiting ? `; ${waiting} more on the same tokens are offered again` : ''}`;
  const undone = `Undone: ${fixes.length === 1 ? fixes[0]!.label : `${applied} fixes`}`;
  toast(title, `${changeText(findingChange(before, findings(store.get())))}.`, command !== last ? command : undefined, undone);
  return applied;
}

/**
 * Applies a change to tokens (pointing a token at another one, a curve edit) and says what
 * the fresh check of every file found, with Undo.
 */
export function editWithToast(label: string, edits: Edit[]) {
  const before = findings(store.get());
  const last = store.get().past.at(-1);
  applyEdits(label, edits);
  const command = store.get().past.at(-1);
  if (command === last) return;
  toast(label, `${changeText(findingChange(before, findings(store.get())))}.`, command, `Undone: ${label}`);
}

// ---------------------------------------------------------------------------
// Files updated after the first load: added, removed or replaced by a file of
// the same name, from the Files page, the Add token files dialog or a drop.
// Edits change a file's tokens, not the file that was loaded: they have their own notes.

interface FileSnap {
  texts: Map<string, string>;
  state: AppState;
}

const fileSnap = (s: AppState): FileSnap => ({ texts: new Map(s.files.map((f) => [f.name, f.text])), state: s });
let lastFiles = fileSnap(store.get());
let quiet = 0;
let held: FileSnap | undefined;

const named = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.length} files`);

function reportFiles(from: FileSnap, s: AppState) {
  // The first load, and clearing every file, show on the page itself.
  if (!from.texts.size || !s.files.length) return;
  const now = fileSnap(s).texts;
  const added = [...now.keys()].filter((n) => !from.texts.has(n));
  const removed = [...from.texts.keys()].filter((n) => !now.has(n));
  const replaced = [...now.keys()].filter((n) => from.texts.has(n) && from.texts.get(n) !== now.get(n));
  if (!added.length && !removed.length && !replaced.length) return;
  const parts = [added.length ? `Added ${named(added)}.` : '', removed.length ? `Removed ${named(removed)}.` : '', replaced.length ? `Loaded again with changes: ${named(replaced)}.` : ''];
  toast('Files updated', `${parts.filter(Boolean).join(' ')} ${changeText(findingChange(findings(from.state), findings(s)))}.`);
}

store.subscribe((s, prev) => {
  if (s.files === prev.files) return;
  if (held) return;
  if (!quiet) reportFiles(lastFiles, s);
  lastFiles = fileSnap(s);
});

/** Runs `fn` without a "Files updated" note: for changes that say what they did in their own note (Reload files). */
export function quietFiles(fn: () => void) {
  quiet++;
  try {
    fn();
  } finally {
    quiet--;
    lastFiles = fileSnap(store.get());
  }
}

/**
 * Holds the "Files updated" note while files come and go (the Add token files
 * dialog, which can still be cancelled). The returned function lets it go: one
 * note for the net change, none when nothing changed.
 */
export function holdFiles(): () => void {
  const from = held ?? lastFiles;
  held = from;
  return () => {
    held = undefined;
    reportFiles(from, store.get());
    lastFiles = fileSnap(store.get());
  };
}
