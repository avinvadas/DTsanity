import type { Level } from '../contrast/levels';
import type { Category, Severity } from '../model/types';
import type { FlagKind, ScaleFlag } from '../palette/checks';

/**
 * Tooltip wording for every indicator, in one place so the explanations stay
 * consistent. Only fixed text lives here, never token names or values.
 */

export const TIP = {
  // Navigation
  navFiles: 'Load token files and download your changes.',
  policy: 'Severity policy: how each check reports, from error to off.',
  policyReset: 'Set every rule back to its built-in level.',
  policyBack: 'Back to where you were.',
  navThemes: 'Which files each theme reads, such as light and dark.',
  navIssues: 'Problems with the DTCG format, with suggested fixes. The icon shows the severest one found.',
  navColors: 'Base color palettes: scale checks, gamut and contrast, and the curve editor.',
  navSemantic: 'Foreground and background pairs found by name, checked for contrast in every theme. The number counts pairs.',
  navComponents: 'Component tokens (button, input, card…) in foreground and background pairs, checked like semantic ones. The number counts pairs.',
  navTokens: 'Every token with its written and resolved value.',
  themePick: 'The theme that Issues, the base tier and the tokens list show. “All themes” combines them: a check fails if it fails in any theme.',

  // Semantic pairs
  pairKind: 'Text must reach the text level (AA 4.5, AAA 7, Lc 60). UI parts such as icons and borders need the non-text level (3, or Lc 45).',
  pairFailText: 'Text pairs below the text level in at least one theme.',
  pairFailUi: 'Icon, border and other UI pairs below the non-text level in at least one theme.',
  pairMissing: 'One of the two tokens is not in this theme.',
  pairAdded: 'A pair you added.',
  pairRemove: 'Stop checking this pair. Nothing changes in your files.',
  pairOwnValue: 'This token has a raw color value, not a token reference. Pick a token to reference it instead.',
  pairRealiasFile: 'The file the reference is written in. Themes that read the same file change together.',
  pairFailCvd: 'Pairs that pass with typical vision but not with a color-vision deficiency in at least one theme.',
  pairCvdMiss: 'This pair passes with typical vision but falls below the level with these deficiencies (simulated at full strength).',
  siblingsFail: 'Groups of status colors (danger, warning, success…) whose closest two look too alike with some vision type.',
  vision: 'Show previews and results as seen with a color-vision deficiency. Simulated with the Machado 2009 model at full strength (dichromacy); achromatopsia keeps only luminance.',
  cvdDistance: 'The smallest OKLab difference (ΔE OK) at which two status colors count as different. 0.1 is clearly visible side by side; raise it for small marks such as icons.',
  siblingRealias: 'Point this group’s tokens at other existing tokens, theme by theme, to keep them apart with every vision type. Only the references change.',
  realias: 'Re-alias: point this token at another existing token, theme by theme. Only the reference changes.',

  // Typography styles
  typePart: 'The token this part of the style references. Pick another token of the same type to change the style; only the reference changes.',
  typeExtended: 'This style is copied in by $extends; change it where it is written.',
  typeOwnValue: 'This part has a raw value, not a token reference. Styles above the base tier point every part at a base token.',
  typeUseSame: 'Point this part at a token with the same value. The style looks the same; only the reference changes.',
  typeBroken: 'A part references a token that is missing or broken.',
  typeMode: 'The mode the scale shows. Styles whose parts change between modes (desktop, mobile…) are shown as each mode resolves them.',
  typeStyleAlerts: 'Styles with a format problem, or parts with raw values instead of token references.',
  typeRangeAlerts: 'Problems across the scale: styles that look the same, sizes too close to tell apart, or text too small to read.',
  typeRowAlerts: 'This style has alerts. Expand it for the details and fixes.',
  typeInherited: 'This style is an alias of another, so this part comes from there. Picking another token gives the style its own parts, copied from that style with this one changed.',
  typeExpand: 'Show the tokens this style is made of, and its alerts.',
  typeRange: {
    same: 'Every part resolves to the same value, so the styles can’t be told apart. Make one an alias of the other, or change one.',
    close: 'Neighbouring sizes with the same family and weight need a clear step between them to read as different levels.',
    small: 'Small text is hard to read, especially at lighter weights. 12px is a common minimum.',
  },
  pairBorderAlias: 'This token is an alias of another token as a whole, so its color is changed there.',
  tierOther: 'This token belongs to another tier than this view’s: a semantic or base token paired with a component token, or a base token used as a semantic background.',
  pairsReset: 'Forget the pairs you added, removed or re-kinded.',

  // Files
  unchanged: 'Exporting now gives back exactly the bytes you loaded.',
  unchangedConverted: 'No edits since the file was converted.',
  edited: 'This file has edits that are not downloaded yet.',
  fileMeta: 'The format this file was read as, and how many tokens it defines.',
  download: 'Save this file, with any fixes and edits applied.',
  downloadDtcg: 'Save this file converted to the DTCG format, with any fixes and edits applied.',
  downloadLegacy: 'Save this file back in its original format. Values that cannot be converted back are listed below the file.',
  remove: 'Stop checking this file. Nothing is deleted from your computer.',
  undoNone: 'Nothing to undo',
  redoNone: 'Nothing to redo',
  downloadAll: 'Save every loaded file in the DTCG format.',
  downloadUpdated: 'Save the whole token set with your changes as one folder (zipped): every loaded file under its own name and in its own format, plus CHANGES.md listing each change.',
  downloadUpdatedNone: 'Active once you change the tokens here: apply a fix, re-alias a token or edit a curve.',
  copyScopedPrompt: 'Copy a prompt with the corrections for these findings only, for an AI assistant or a ticket. It names your tokens and stays on your clipboard.',
  copyFixPrompt: 'Copy a prompt that lists every correction still needed (errors, warnings, contrast, color-vision and scale checks) for an AI assistant or a ticket. It names your tokens and stays on your clipboard.',
  clearAll: 'Remove every loaded file and start over.',

  // Issues
  reload: 'Read the files again from disk or their URL and re-run the checks.',
  chooseFolder: 'Read every token file in a folder and its subfolders, each named by its path in it, so files with the same name in different folders (one per theme) stay apart. Package manifests and node_modules are skipped.',
  themeCombo: 'Tokens Studio theme groups combine: each theme is checked with the first theme of every other group, so it has a whole set to resolve against.',
  dropzone: 'DTCG .json, .json5, .jsonc or .tokens files, several at once (such as primitives and semantic), or whole folders. Tokens Studio and Style Dictionary files too, with legacy formats on.',
  addMoreFiles: 'Open the loaded files in a dialog: remove any of them, or drop, pick or link more.',
  closeDialog: 'Cancel and close (Esc): the files go back to how they were.',
  filesSave: 'Keep these files and re-run every check on them.',
  filesCancel: 'Put the files back as they were when you opened this, and close.',
  fixAll: 'Apply every suggested fix in this group as one undoable step.',
  fix: 'Apply this suggested fix. You can undo it.',
  fixBefore: 'The value as it is now.',
  fixAfter: 'The value after the fix.',
  where: 'File, line and column where the problem is.',
  themeTag: 'This issue happens only when the file is read in these themes.',
  groupCount: 'Number of issues in this group.',
  clusterFixable: 'Issues DTsanity fixes in one click. Each fix shows its change first and can be undone.',
  clusterManual: 'Issues DTsanity can’t fix for you: the right change needs a decision. Edit the file, or copy the fix prompt for an AI assistant or a ticket.',

  // Themes
  themeErrors: 'DTCG errors found when the files are read as this theme. Green means none.',
  themeFile: 'Checked: this theme reads the file. Files every theme reads hold the shared tokens.',
  themeMode: 'The per-mode value in “$extensions” that this theme reads.',
  themeSets: 'Tokens Studio token sets this theme enables in this file.',
  removeTheme: 'Remove this theme. The files stay loaded.',

  // Tokens
  deprecated: 'Marked with “$deprecated”: still valid, but meant to be phased out.',
  extendedFrom: 'Inherited from another group through “$extends”, not written here.',
  noType: 'No “$type” on the token or any parent group, so its value cannot be checked.',
  alias: 'A reference to another token. The Resolved column shows the final value.',
  unresolved: 'The reference points to a token that does not exist, or the references loop.',
  notInTheme: 'This theme does not define this token.',
  colValue: 'The value as written in the file.',
  colResolved: 'The final value after following every reference.',

  // Palettes
  paletteMeta: 'Number of steps, and whether lightness goes from light to dark, dark to light, or has no clear order.',
  notBase: 'Leave this palette out of the scale and contrast checks, for example when it is a set of one-off colors.',
  treatAsBase: 'Run the scale and contrast checks on this palette as part of the system.',
  collapseRow: 'Collapse this palette to its heading. Its checks still count.',
  expandRow: 'Expand this palette to see its steps and checks.',
  formats: {
    oklch: 'Show colors as oklch(lightness chroma hue), the space every check here uses.',
    hex: 'Show colors as hex. Colors outside sRGB are shown approximately (≈).',
    rgb: 'Show colors as rgb(). Colors outside sRGB are shown approximately (≈).',
  },
  gamut: 'The color space your product targets. Colors outside it are flagged and drawn mapped into it.',
  step: 'The step name, taken from the last part of the token path.',
  unitName: 'The step name: the last part of this token’s path.',
  pinUnit: 'Pin this step: it keeps its color while curve edits change the rest of the row. A row has one pin at most; pinning another step moves it. Click again to unpin.',
  copyUnit: 'Click to copy the token’s name and value.',
  gamutP3: 'Outside sRGB but inside Display P3: shows correctly only on wide-gamut screens.',
  gamutOut: 'Outside Display P3 too: no common screen can show this color as written.',
  approx: '≈ means the color is outside this format’s range, so the text is the nearest match.',
  value: 'The color value, in the format chosen above.',
  l: 'L: perceived lightness, from 0 (black) to 100 (white).',
  c: 'C: chroma, how colorful it is. 0 is gray; around 0.37 is the most saturated a screen can show.',
  h: 'H: hue angle in degrees (about 30 red, 100 yellow, 145 green, 265 blue).',
  gamutOutSrgb: 'Outside sRGB, the target gamut: it is drawn mapped into sRGB, so screens show something other than the file. Switch the target to Display P3 if that is intended.',
  delta: {
    l: 'ΔL: how much lighter or darker each step is than the one before it, on the 0–100 lightness scale. Problems with a pair (reversed, too close, uneven) replace the number.',
    c: 'ΔC: how much chroma (colorfulness) changes from the step before; + is more colorful, − less.',
    h: 'ΔH: how far the hue turns from the step before, in degrees. – where a step is too gray for its hue to count.',
  },
  curveFor: {
    l: 'Edit this row’s lightness curve. The row previews live; nothing changes in your files until you apply.',
    c: 'Edit this row’s chroma curve. The row previews live; nothing changes in your files until you apply.',
    h: 'Edit this row’s hue curve. The row previews live; nothing changes in your files until you apply.',
  },
  flagWarning: 'Warning: likely a mistake in the scale.',
  flagInfo: 'Note: worth a look, but may be intended.',

  // Contrast
  targets: {
    wcag: 'WCAG 2.2: pairs pass at AA, a ratio of at least 4.5 for text and 3 for large text and UI parts (the usual legal baseline). Where AAA (7) is reached is shown too.',
    apca: 'APCA: the contrast method proposed for WCAG 3. Lc scores depend on which color is the text; higher is easier to read.',
  },
  endPicker: 'The neutral token this end of the whole system sits at. Only its lightness is used, without chroma. Each row gets its own end at this lightness, tinted with its hue, and steps past it are left out of the rows. Defaults to your lightest or darkest neutral, otherwise white or black.',
  endLight: '◻ Contrast as text on the light end.',
  endDark: '◼ Contrast as text on the dark end.',
  wcagValue: 'WCAG contrast ratio, from 1 (none) to 21 (black on white).',
  apcaValue: 'APCA lightness contrast (Lc), from 0 to about 106. Higher is easier to read.',
  noLevel: '– means it passes none of the selected levels.',
  rangeOn: 'Where each selected level is first reached when this row’s steps are used as text on its light (◻) or dark (◼) end: the global end’s lightness, tinted with this row’s hue.',
  pastEnds: 'The global ends bound every row, so these steps are left out of the grid and its checks. They stay in your file; move the ends to include them.',
  lightEnd: 'This row’s light end: the global light end’s lightness, tinted with this palette’s hue. Not a token; contrast on the light end is measured against it.',
  darkEnd: 'This row’s dark end: the global dark end’s lightness, tinted with this palette’s hue. Not a token; contrast on the dark end is measured against it.',
  passPoint: 'The heavy edge is the pass point: from here on, steps reach this level as text on this background; on the other side of the edge they do not.',
  missingStep: 'Missing step: other palettes in this system have it, this one does not.',
  previewRow: 'This row shows an unapplied curve edit. Apply or revert it in the curves panel.',
  stepDistance: 'How many steps apart two colors of this scale must be for one to be readable on the other.',
  nearest: 'For each step, the closest step that passes this level against it.',
  parity: 'Steps where this palette starts passing differ from most other palettes.',
} as const;

/** Curve editor controls. */
export const CURVE_TIP = {
  anchor: 'The anchor: the step in focus. When pinned (filled pin) it keeps its color and every curve passes through it, shown ◆ on the curve. Any step can be the anchor, including the row’s light and dark ends (dashed). Drag along the strip, or use the arrow keys, to move it.',
  pin: 'Pin this step: it keeps its color while the rest of the row changes, and every curve passes through it. A row has one pin at most; click again to unpin.',
  anchorPinned: 'The anchor is pinned, so its color is fixed. Unpin it to set its values.',
  anchorEnd: 'The anchor is one of this row’s ends. Its color comes from the global ends, so its values are read-only here; anchoring to it pins the curves to that end.',
  anchorL: 'Anchor lightness, 0 (black) to 100 (white). Editable in the lightness curve.',
  anchorC: 'Anchor chroma: 0 is gray, higher is more colorful. Editable in the chroma curve.',
  anchorH: 'Anchor hue angle in degrees. Editable in the hue curve.',
  presets: {
    Current: 'Fit the curve to the palette’s current values.',
    Linear: 'Straight lines from each end through the anchor, so lightness changes evenly on each side.',
    Ease: 'A smooth curve from each end through the anchor, without a sharp turn at the anchor.',
    Bell: 'Most colorful at the anchor, fading toward both ends.',
    Flat: 'The same chroma at every step (mapped down where the gamut is smaller).',
    Constant: 'The same hue as the anchor at every step.',
  } as Record<string, string>,
  shift: 'Turn the hue gradually by this many degrees from the anchor toward the last step.',
  contrast: 'Solve lightness so chosen steps just pass a contrast level on the light and dark ends.',
  solve: 'Set those steps’ lightness so they just pass, then smooth the curve through them.',
  revert: 'Close the panel and drop this edit. The rows go back to the values in your files; pins stay as set.',
  match: 'Every palette gets this palette’s lightness at each step, so the same step has the same contrast everywhere.',
  relative: 'Each palette keeps its own anchor lightness and follows the curve’s shape from there.',
  reset: 'Go back to the palette’s current values.',
  apply: 'Write the previewed rows to your files as one undoable step.',
} as const;

/** What each scale check looks for. */
export const FLAG_TIP: Record<FlagKind, string> = {
  inversion: 'Lightness should move one way across the scale. Here a step is lighter or darker than its order says.',
  'near-duplicate': 'Neighbouring steps that are almost the same color are hard to tell apart (ΔE under 0.02 in OKLab).',
  'hue-drift': 'The hue turns more than 30° across the scale. Often intended (warmer lights, cooler darks), but check it.',
  'uneven-lightness': 'Lightness gaps between steps vary a lot, so some steps look much closer than others.',
  unordered: 'Step names that are not numbers or a known scale (like lightest…darkest or sm…xl) cannot be put in order.',
  'missing-steps': 'Other palettes have these steps. Matching step sets let a semantic role switch palettes cleanly.',
  'outside-gamut': 'Colors outside the target gamut get clipped by the screen, so what users see differs from the file.',
  p3: 'These colors need a wide-gamut (Display P3) screen to show as written.',
};

export const SEVERITY_TIP: Record<Severity, string> = {
  error: 'Error: breaks the DTCG format. Tools may reject the file or read it wrongly.',
  warning: 'Warning: valid, but likely a mistake or something tools handle inconsistently.',
  info: 'Info: a suggestion for clearer or more portable tokens.',
};

export const CATEGORY_TIP: Record<Category, string> = {
  format: 'Whether the file is DTCG JSON at all.',
  structure: 'Token and group names, and how tokens and groups nest.',
  references: 'Aliases like {color.blue.500}: do they exist, loop, or point to the wrong type.',
  types: 'Each token’s “$type”, written or inherited from its groups.',
  values: 'Whether each value has the shape its type requires.',
  metadata: '“$description”, “$extensions” and “$deprecated”.',
};

/** The level a badge stands for, e.g. "AA L" → "Passes AA large text & UI (3)". */
export const levelTip = (l: Level) => `${l.badge}: passes ${l.label}${l.metric === 'apca' ? ' (APCA Lc)' : ' (WCAG ratio)'}.`;

/** What a scale check looks for, after whether it is a warning or a note. */
export const flagTip = (f: ScaleFlag) => `${f.severity === 'warning' ? TIP.flagWarning : TIP.flagInfo} ${FLAG_TIP[f.kind]}`;
