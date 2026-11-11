import type { ColorInfo, Gamut } from '../color/format';
import { h, icon } from './dom';
import { swatchSelect } from './swatch-select';

/**
 * The one control for pointing a token (or a part of a composite token) at
 * another token, used wherever the tool edits aliases. A reference leads with
 * the token icon; a value written in place has none and is marked as such.
 * Colors list with swatches; other types use a native select. An alert on the
 * value thickens the border in the alert's color.
 */

export type FieldStatus = 'error' | 'warning';

export interface TokenOption {
  value: string;
  label: string;
  /** Secondary text, such as the contrast a color would give. */
  meta?: string;
  /** The option's color, for color tokens. */
  info?: ColorInfo;
  /** The full name, as a tooltip, when the label is a short form of it. */
  title?: string;
  disabled?: boolean;
}

export interface TokenFieldOptions {
  /** Accessible name of the control. */
  label: string;
  groups: { label: string; options: TokenOption[] }[];
  /** The token referenced now; undefined when the value is written in place. */
  value?: string;
  /**
   * What the field shows when `value` is not among the options: the current
   * reference (`group` names why it is not offered), or the value written in place.
   */
  shown?: { label: string; info?: ColorInfo; group?: string };
  status?: FieldStatus;
  /** Nothing picked yet: the field shows this prompt rather than a value written in place. */
  placeholder?: string;
  /** Tooltip for the control. */
  tip?: string;
  disabled?: boolean;
  /** Set for color tokens: options are listed with swatches in this gamut. */
  gamut?: Gamut;
  /** Marks the control so it can be focused again after a pick re-renders it. */
  focusKey?: string;
  onPick: (value: string) => void;
}

export function tokenField(o: TokenFieldOptions): HTMLElement {
  const empty = o.value === undefined && o.placeholder !== undefined;
  const own = o.value === undefined && !empty;
  const cls = ['token-field', own ? 'own' : '', empty ? 'empty' : '', o.status ?? ''].filter(Boolean).join(' ');
  if (o.gamut) {
    const control = swatchSelect({
      label: o.label,
      groups: o.groups.map((g) => ({ label: g.label, options: g.options.filter((x) => x.info).map((x) => ({ value: x.value, label: x.label, meta: x.meta, title: x.title, disabled: x.disabled, info: x.info! })) })),
      value: o.value ?? '',
      gamut: o.gamut,
      token: o.value !== undefined,
      ...(empty ? { fallback: { label: o.placeholder! } } : o.shown ? { fallback: o.shown } : {}),
      onPick: o.onPick,
    });
    return h('span', { class: cls, 'data-tip': o.tip }, control);
  }
  const known = new Set(o.groups.flatMap((g) => g.options.map((x) => x.value)));
  const select = h(
    'select',
    { 'aria-label': o.label, 'data-focus': o.focusKey, disabled: o.disabled, 'data-tip': o.tip },
    o.value === undefined
      ? h('option', { value: '', selected: true, disabled: empty }, empty ? o.placeholder : (o.shown?.label ?? 'Not set'))
      : known.has(o.value!)
        ? null
        : h('optgroup', { label: o.shown?.group ?? 'Current' }, h('option', { value: o.value, selected: true }, o.shown?.label ?? o.value)),
    o.groups.map((g) => h('optgroup', { label: g.label }, g.options.map((x) => h('option', { value: x.value, selected: x.value === o.value, disabled: x.disabled, title: x.title }, x.meta ? `${x.label} · ${x.meta}` : x.label)))),
  );
  select.addEventListener('change', () => select.value && select.value !== o.value && o.onPick(select.value));
  return h('span', { class: cls }, o.value === undefined ? null : h('span', { class: 'token-mark', 'aria-hidden': 'true' }, icon('token')), select);
}
