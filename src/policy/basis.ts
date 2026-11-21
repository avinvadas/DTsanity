/**
 * What each rule stands on, so a finding can say whether it is a requirement
 * or advice, and why:
 * - a standard: the DTCG Format or Color Module 2025.10 (by section), WCAG 2.2
 *   (by success criterion) or JSON (RFC 8259). Its findings are required,
 *   unless the standard only recommends.
 * - a DTsanity convention: a practice DTsanity checks for (tiers, scales,
 *   typography). Its findings are advice: a design system's own rules may
 *   decide otherwise, and declining one with a reason settles it.
 * - DTsanity itself: what it could or couldn't check (a file no theme reads).
 *   Advice about the check, not the files.
 *
 * Sections are cited by number and title as the 2025.10 reports write them
 * (https://www.designtokens.org/tr/2025.10/format/ and …/color/), so any
 * tool or person can look the rule up.
 */

export type Standing = 'required' | 'advice';

export interface Basis {
  /** Where the rule comes from. */
  source: 'DTCG' | 'WCAG' | 'JSON' | 'DTsanity';
  /** The section, criterion or practice, e.g. "Format 5.1.1 Character restrictions". */
  ref: string;
  standing: Standing;
}

const dtcg = (ref: string, standing: Standing = 'required'): Basis => ({ source: 'DTCG', ref, standing });
const wcag = (ref: string, standing: Standing = 'required'): Basis => ({ source: 'WCAG', ref, standing });
const convention = (ref: string): Basis => ({ source: 'DTsanity', ref: `convention: ${ref}`, standing: 'advice' });
const check = (ref: string): Basis => ({ source: 'DTsanity', ref: `check: ${ref}`, standing: 'advice' });

export const BASIS: Record<string, Basis> = {
  // Format
  'legacy-format': dtcg('Format 5.1 Name and value'),
  'legacy-conversion': dtcg('Format 8 Types'),
  'json5-syntax': dtcg('Format 4 File format'),
  'resolver-missing': check('a theme checked without one of its files'),
  'value-per-mode': dtcg('Format 5.1 Name and value'),
  'unsupported-format': dtcg('Format 5.1 Name and value'),
  'no-tokens': dtcg('Format 5.1 Name and value', 'advice'),
  'file-not-in-theme': check('a file no theme reads goes unchecked'),
  // Structure
  'root-not-object': dtcg('Format 4 File format'),
  'duplicate-key': { source: 'JSON', ref: 'RFC 8259, 4 Objects (names should be unique)', standing: 'required' },
  // DTCG doesn't say what loading one token from two files means: tools differ, the last one usually wins.
  'duplicate-path': convention('one definition per token across the files loaded together'),
  'invalid-node': dtcg('Format 6.1 Group Structure'),
  // "$" is reserved for properties the format defines now or later; it doesn't forbid others.
  'unknown-property': dtcg('Format 5.1.1 Character restrictions', 'advice'),
  'token-has-children': dtcg('Format 6.1 Group Structure'),
  'legacy-property': dtcg('Format 5.1 Name and value'),
  'invalid-name': dtcg('Format 5.1.1 Character restrictions'),
  'empty-group': dtcg('Format 6.5 Empty Groups', 'advice'),
  'token-group-conflict': dtcg('Format 6.1 Group Structure'),
  // Types and values
  'missing-type': dtcg('Format 5.2.2 Type'),
  'unknown-type': dtcg('Format 8 Types'),
  'alias-type-mismatch': dtcg('Format 5.2.2 Type'),
  'invalid-value': dtcg('Format 8 Types and 9 Composite types; Color 4.1 Format'),
  'legacy-value': dtcg('Format 8 Types; Color 4.1 Format'),
  'inconsistent-value': convention('values tools read alike'),
  'font-fallback': convention('a generic family last in a font stack'),
  // References
  'unresolved-reference': dtcg('Format 7.2 Reference Resolution'),
  'outside-reference': dtcg('Format 7.2 Reference Resolution', 'advice'),
  'reference-to-group': dtcg('Format 7.1.1 Curly Brace Syntax (Token References)'),
  'circular-reference': dtcg('Format 7.2.3 Circular References'),
  'invalid-ref': dtcg('Format 7.1.2 JSON Pointer Syntax (Required Support)'),
  'unresolved-ref': dtcg('Format 7.4.5 Error Conditions'),
  'circular-extends': dtcg('Format 6.4.4 Circular Reference Prevention'),
  'invalid-extends': dtcg('Format 6.4.5 Supported Reference Formats'),
  'extends-token': dtcg('Format 6.4 Extending Groups'),
  'unresolved-extends': dtcg('Format 6.4.6 Error Conditions'),
  'embedded-reference': dtcg('Format 7.1.1 Curly Brace Syntax (Token References)'),
  'deprecated-reference': dtcg('Format 5.2.4 Deprecated', 'advice'),
  // Tiers
  'tier-base-reference': convention('token tiers: base tokens hold values'),
  'tier-reference': convention('token tiers: each tier points at the tiers below it'),
  'tier-hardcoded': convention('token tiers: semantic and component tokens point at base tokens'),
  'tier-name-mismatch': convention('token tiers: a tier’s name and what its tokens do agree'),
  // Metadata
  'invalid-description': dtcg('Format 5.2.1 Description'),
  'invalid-type-property': dtcg('Format 5.2.2 Type'),
  'invalid-deprecated': dtcg('Format 5.2.4 Deprecated'),
  'invalid-extensions': dtcg('Format 5.2.3 Extensions'),
  'extension-naming': dtcg('Format 5.2.3 Extensions (reverse domain names recommended)', 'advice'),
  // Contrast
  'contrast-text': wcag('1.4.3 Contrast (Minimum); 1.4.6 Contrast (Enhanced) in high-contrast themes'),
  'contrast-ui': wcag('1.4.11 Non-text Contrast'),
  // 1.4.11 asks for it only where the border is what shows the component or its state: DTsanity can't tell from the files.
  'contrast-border': wcag('1.4.11 Non-text Contrast, where the border is what identifies the component or its state', 'advice'),
  'contrast-inactive': wcag('1.4.3 and 1.4.11 exempt inactive components and decorative lines', 'advice'),
  // Color blindness
  'cvd-pair': convention('simulated color-vision deficiencies (see WCAG 1.4.1 Use of Color)'),
  'cvd-siblings': convention('status colors told apart under simulated color-vision deficiencies (see WCAG 1.4.1 Use of Color)'),
  // Base color scales
  'scale-inversion': convention('ordered color scales'),
  'scale-near-duplicate': convention('ordered color scales'),
  'scale-outside-gamut': convention('colors inside the target gamut'),
  'scale-hue-drift': convention('ordered color scales'),
  'scale-uneven-lightness': convention('ordered color scales'),
  'scale-missing-steps': convention('ordered color scales'),
  'scale-unordered': convention('ordered color scales'),
  'scale-p3': convention('colors inside the target gamut'),
  // Typography
  'type-same': convention('a distinct type scale'),
  'type-close': convention('a distinct type scale'),
  'type-small': convention('readable text sizes'),
};

/** The basis as a short label: "Required · DTCG Format 5.2.2 Type", "Advice · DTsanity convention: token tiers…". */
export function basisLabel(id: string): string | undefined {
  const b = BASIS[id];
  if (!b) return undefined;
  return `${b.standing === 'required' ? 'Required' : 'Advice'} · ${b.source} ${b.ref}`;
}
