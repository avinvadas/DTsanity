import { h, xButton, type Child } from './dom';

export interface Choice<T> {
  label: string;
  value: T;
  primary?: boolean;
}

/**
 * A modal question: a title, what it is about, and its answers as buttons,
 * the primary one last. Resolves with the chosen answer's value, or null when
 * it is cancelled (Cancel, Esc, the close button or a click outside).
 */
export function choiceDialog<T>(title: string, body: Child[], choices: Choice<T>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let result: T | null = null;
    const titleId = `tt-choice-${Math.random().toString(36).slice(2)}`;
    const cancel = h('button', { type: 'button' }, 'Cancel');
    const buttons = choices.map((c) =>
      h('button', { type: 'button', class: c.primary ? 'primary-neutral' : undefined, onclick: () => ((result = c.value), dialog.close()) }, c.label),
    );
    const dialog = h(
      'dialog',
      { class: 'choice-dialog', 'aria-labelledby': titleId },
      h('header', { class: 'choice-head' }, h('h2', { class: 'choice-title', id: titleId }, title), xButton('Cancel', () => dialog.close())),
      h('div', { class: 'choice-body' }, body),
      h('footer', { class: 'dialog-foot' }, cancel, buttons),
    ) as HTMLDialogElement;
    cancel.addEventListener('click', () => dialog.close());
    // A click on the backdrop lands on the dialog itself.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    // The primary answer has the focus: Enter confirms it.
    (buttons.find((_, i) => choices[i]!.primary) ?? cancel).focus();
  });
}
