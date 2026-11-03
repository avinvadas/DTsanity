import { isUnchanged } from '../io/export';
import { removeFile, restoreFiles, snapshotFiles, store } from '../state/app';
import { h, masked, plural } from './dom';
import { TIP } from './tips';

/**
 * Add or remove files without leaving the current view: a modal dialog with
 * the same loader as the landing page (drop zone, file picker, URL) on top,
 * and the loaded files below it, each removable. Files dropped anywhere on
 * the page while it is open are added too.
 *
 * Changes show behind the dialog as they are made, but only count once the
 * user saves: Cancel (or Esc, the close button, a click outside) puts the
 * file set and its undo history back as they were when the dialog opened.
 */

let open: HTMLDialogElement | undefined;

export function openFilesDialog() {
  if (open) return open.showModal();
  const before = snapshotFiles();
  let saved = false;

  const list = h('ul', { class: 'file-list' });
  const summary = h('h3', { class: 'section-title' });
  const close = h('button', { type: 'button', class: 'ghost icon-btn', 'aria-label': 'Cancel', 'data-tip': TIP.closeDialog }, '✕');
  const save = h('button', { type: 'button', class: 'primary-neutral', 'data-tip': TIP.filesSave }, 'Reload and Save');
  const cancel = h('button', { type: 'button', 'data-tip': TIP.filesCancel }, 'Cancel');
  const dialog = h(
    'dialog',
    { class: 'files-dialog', 'aria-labelledby': 'tt-files-dialog-title' },
    h('header', { class: 'vh' }, h('div', { class: 'vh-row' }, h('h2', { class: 'vh-title', id: 'tt-files-dialog-title' }, 'Add token files'), close)),
    h('div', { class: 'load-card' }, document.createElement('tt-loader')),
    summary,
    list,
    h('footer', { class: 'dialog-foot' }, cancel, save),
  ) as HTMLDialogElement;
  close.addEventListener('click', () => dialog.close());
  cancel.addEventListener('click', () => dialog.close());
  save.addEventListener('click', () => {
    saved = true;
    dialog.close();
  });
  // A click on the backdrop lands on the dialog itself.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  const unsub = store.select(
    (s) => s.files,
    (files) => {
      summary.textContent = files.length ? `${plural(files.length, 'file')} loaded` : 'No files loaded';
      list.hidden = !files.length;
      list.replaceChildren(
        ...files.map((f) =>
          h(
            'li',
            { class: 'file' },
            masked(h('span', { class: 'file-name' }, f.name)),
            isUnchanged(f) ? null : h('span', { class: 'badge changed', 'data-tip': TIP.edited }, 'Edited'),
            h('button', { type: 'button', class: 'ghost icon-btn file-remove', 'aria-label': 'Remove file', 'data-tip': TIP.remove, onclick: () => removeFile(f.id) }, '✕'),
          ),
        ),
      );
    },
  );
  dialog.addEventListener('close', () => {
    unsub();
    if (!saved && store.get().files !== before.files) restoreFiles(before);
    dialog.remove();
    open = undefined;
  });
  document.body.append(dialog);
  open = dialog;
  dialog.showModal();
}
