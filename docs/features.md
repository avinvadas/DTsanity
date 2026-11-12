# DTsanity features in detail

## Load

- Choose files, drop them anywhere on the page, or enter a URL (GitHub page links load the raw file).
- Load several files together, such as primitives, semantic and components; references resolve across them.
- The file button in every view shows how many files are loaded. **Reload files** reads them again after you edit them elsewhere; **Add more files** opens a dialog to add or remove files without leaving the view (Cancel puts everything back).

## Check the DTCG format

- Rules from the DTCG spec (2025.10): structure, names, types, values, references (aliases and `$ref` pointers, cycles, typos) and metadata.
- Most issues come with a suggested fix and a before/after preview. Apply fixes one at a time or a whole category at once; every change can be undone.
- **Legacy formats** (optional): Tokens Studio and Style Dictionary v3 files are converted to DTCG on load.

## Tiers

- Every token is read as **base** (raw values such as `color.blue.500`), **semantic** (what a value is for, such as `color.text.danger`) or **component** (one component's use, such as `button.primary.bg`).
- The tier comes from layer names in groups or file names (`primitives`, `semantic`, `components`…), then from the token's name and value. Tab names follow the words your files use.
- Rules: base tokens hold values; semantic tokens point at base or semantic tokens; component tokens point at semantic or base tokens.

## Base tier: color scales

- Base colors shown as ordered palettes on a shared step grid. Palettes with named steps (light, base, dark) are placed by lightness.
- Scale checks: lightness inversions, near-duplicate steps, hue drift, uneven lightness gaps, missing steps, and colors outside the target gamut (sRGB or Display P3). Colors shown as OKLCH, hex or RGB.
- Contrast per scale against a light and a dark end, the passing range, and the step distance at which any two colors pass.
- **Curve editor**: reshape a palette's lightness, chroma and hue around an anchor color, with presets (linear, eased, chroma bell, hue shift, contrast-targeted lightness). Results are previewed with their contrast and the semantic tokens they affect, and can be applied to other palettes in one undoable step.
- Colors outside any scale are grouped as the file groups them: series in one row, singles in their own.

## Semantic and component tiers: pairs

- Foreground and background pairs found by name (`text`, `icon`, `border`, `on-*` with `bg`, `surface`, `container`…), checked in every theme: text against AA, AAA or APCA text levels; icons and borders against the UI level.
- Borders are drawn as a line around the background; text as "Aa"; icons as a mark.
- **Re-alias** any token to another existing one, theme by theme, without editing values.
- The component tier is grouped by component, with search and expand/collapse all.
- Typography styles are listed by hierarchy: display, headings (h1 before h2), titles, subtitles, body, labels, captions, then code. Each family (`body`, `body.short`) stays together and runs from its largest step to its smallest, by its size word (`2xl` … `xs`), heading level or numbered step, or else by font size.

## Color blindness

- Every pair shown as seen with typical vision and with protanopia, deuteranopia, tritanopia and achromatopsia (Machado 2009 at full severity).
- Status colors that must stay apart (danger, warning, success, info…) are checked for a minimum difference under each vision type.

## Themes

- Light, dark or brand variants detected from file names (`semantic.light.json` + `semantic.dark.json`), Tokens Studio `$themes`, or per-mode values in `$extensions`, and editable in a files × themes matrix. Each theme is checked on its own.

## Severity policy

- Every check reports at a level: **error** (breaks the DTCG format, or text fails contrast), **warning** (valid but likely wrong, or a non-text accessibility failure) or **info** (a suggestion, listed apart and not counted).
- The cog beside the appearance switch opens the policy, on desktop and on phones: one line per check (55 in all), with a switch to turn it off and its level. While it's open, a back arrow appears beside the cog; either one returns to where you were. Changes apply right away to every file and view, including the fix prompt, and are kept in this browser with the other preferences. Reset to defaults, at the bottom, brings back the built-in levels.
- Errors are red with a filled triangle, warnings yellow with an outlined one, info gray with a circled “i”. Each color passes WCAG AA (4.5:1) on every surface it sits on, in light and dark mode.

## Close the loop

- **Get fixed files**: one zip holding the whole set as you loaded it, every file under its own name and in its own format, plus `CHANGES.md` listing each change per file and the actions applied.
- **Copy fix prompt**: every remaining correction (errors, warnings, contrast, color blindness, scale checks) as one Markdown prompt for an AI assistant or a ticket.
- Unchanged files download byte for byte as loaded; edits change only the lines they touch.

## Privacy

- The build is a single self-contained `index.html`. All scripts and styles are inlined, and a Content Security Policy blocks loading anything external.
- Settings saved in your browser hold only preferences, never token data.
- Swatches are drawn on `<canvas>`, and every area showing file content is masked from usability-recording tools.
- **Full isolation**: clone the repository and run the strict build, which has no usability recording and works offline from a file on disk.

All color math uses OKLCH, through [Color.js](https://colorjs.io/).
