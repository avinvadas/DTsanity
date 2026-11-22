import type { ColorInfo, Gamut } from '../color/format';
import { h } from './dom';
import { swatchSelect } from './swatch-select';

/**
 * The one control for pointing a token (or a part of a composite token) at
 * another token, used wherever the tool edits aliases. A reference leads with
 * the token icon; a value written in place has none and is marked as such.
 * Colors list with swatches, other types as names; long lists have a filter. An alert on the
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
  // One dropdown for every type, so every alias list can be filtered; colors lead with their swatch.
  const control = swatchSelect({
    label: o.label,
    groups: o.groups.map((g) => ({
      label: g.label,
      options: g.options
        .filter((x) => !o.gamut || x.info)
        .map((x) => ({ value: x.value, label: x.label, meta: x.meta, title: x.title, disabled: x.disabled, ...(o.gamut && x.info ? { info: x.info } : {}) })),
    })),
    value: o.value ?? '',
    gamut: o.gamut ?? 'srgb',
    token: o.value !== undefined,
    ...(empty ? { fallback: { label: o.placeholder! } } : o.shown ? { fallback: o.gamut ? o.shown : { label: o.shown.label } } : {}),
    disabled: o.disabled,
    focusKey: o.focusKey,
    onPick: o.onPick,
  });
  return h('span', { class: cls, 'data-tip': o.tip }, control);
}
