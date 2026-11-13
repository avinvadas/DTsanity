# DTsanity features in detail

## Load

- Choose files, drop them anywhere on the page, or enter a URL (GitHub page links load the raw file).
- Drop or choose a whole folder: every token file in it and its subfolders loads under its path (`themes/white/theme.tokens.json`), so files with the same name in different folders stay apart. Package manifests, tool configs and `node_modules` are skipped.
- Files are read as they are: JSON, and JSON5 or JSONC (comments, unquoted keys, single quotes, trailing commas) for `.json5` and `.jsonc` files. Fixes are saved in the file's own syntax, keeping its comments. A `.json` file that isn't strict JSON is still read, with a warning that most JSON tools can't.
- Load several files together, such as primitives, semantic and components; references resolve across them.
- The file button in every view shows how many files are loaded. **Reload files** reads them again after you edit them elsewhere; **Add more files** opens a dialog to add or remove files without leaving the view (Cancel puts everything back).

## Check the DTCG format

- Rules from the DTCG spec (2025.10): structure, names, types, values, references (aliases and `$ref` pointers, cycles, typos) and metadata.
- Most issues come with a suggested fix and a before/after preview. Apply fixes one at a time or a whole category at once; every change can be undone.
- **Unsupported formats**: a file that is neither DTCG nor a supported legacy format is flagged once, for the file, saying what stops it, when most of its tokens can't be read (values per mode inside `$value`, types or properties of its own, names that break references) or when it holds values but no tokens. Its tokens' own findings are still listed.
- Colors written as CSS strings (`"#0c1927"`), an older form, are reported as legacy values. With legacy formats on they are read as colors (palettes, contrast, color blindness), as legacy files are; with them off they are left out, and the base tier says how many and why.
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

- Light, dark or brand variants read from a DTCG resolver file (`*.resolver.json`: one theme per combination of its modifiers' contexts, reading its sets and contexts in `resolutionOrder`), Tokens Studio `$themes`, file names (`semantic.light.json` + `semantic.dark.json`), or per-mode values in `$extensions`, and editable in a files × themes matrix. Each theme is checked on its own.
- Each theme has a contrast level: **standard** (AA: 4.5:1 text, 3:1 UI; APCA Lc 60 / Lc 45) or **enhanced** (AAA: 7:1 text, UI stays 3:1 as WCAG has no stricter level; APCA Lc 75 / Lc 60). Themes named high or increased contrast (`hc`, SAP's `hcb` and `hcw` too) are enhanced; pick either in the themes table. Results name the level they were measured against (“5.33 of 7 (AAA)”).
- Tokens Studio theme groups (Size, Color scheme…) combine: each theme is checked with the first theme of every other group, so it has a whole set to resolve against. The first theme is every group's first, named by all of them (`medium · Primary · Dark`); the table shows what each other theme is combined with.
- Theme, group and tier names show exactly as the files write them.
- `$ref` pointers (`#/gray/50/$value/components`) resolve against all of a theme's files together, as a resolver merges them; a value built from pointers is checked as it resolves. A file the resolver names that isn't loaded is reported.

## Severity policy

- Every check reports at a level: **error** (breaks the DTCG format, or text fails contrast), **warning** (valid but likely wrong, or a non-text accessibility failure) or **info** (a suggestion, listed apart and not counted).
- The cog beside the appearance switch opens the policy, on desktop and on phones: one line per check (55 in all), with a switch to turn it off and its level. While it's open, a back arrow appears beside the cog; either one returns to where you were. Changes apply right away to every file and view, including the fix prompt, and are kept in this browser with the other preferences. Reset to defaults, at the bottom, brings back the built-in levels.
- Errors are red with a filled triangle, warnings yellow with an outlined one, info gray with a circled “i”. Each color passes WCAG AA (4.5:1) on every surface it sits on, in light and dark mode.

## What DTsanity fixes, and what it doesn't

Not every finding can be fixed for you, and DTsanity says which ones it fixes. Each check is labelled on the policy page:

- **Auto-fix:** every finding comes with a one-click fix (empty groups, legacy values, non-text descriptions, turning on legacy support).
- **Fix when clear:** a fix when the right change is clear, such as a broken reference with one close match, a type that can be inferred from the value, or a name that can be cleaned up. Otherwise the change is yours.
- **Guided:** no automatic fix, but a tool here to work on it: re-alias a pair for contrast and color blindness, reshape a scale in the curve editor, add a file to a theme.
- **Report only:** found and explained, and listed in the fix prompt, but the change is yours, such as duplicate tokens, circular references, hard-coded values or type sizes.

In the Issues view, each category lists the issues DTsanity can fix in one click (Fixable here) before the ones that need a change from you (Needs your change); guided findings say which tool to use. The Issues summary says how many of the issues found can be fixed in one click, and `CHANGES.md` ends with what is still open. A test checks these labels against every sample set, so a label can't claim a fix the check doesn't offer.

## How DTsanity fixes

The principle: **DTsanity changes the format, never the design.** What is mechanical it fixes itself; what needs a design decision is left to you, or to the AI assistant you give the fix prompt to, with guidance. The page **How DTsanity fixes**, linked in the footer, says the same in the app. The text lives in `src/policy/principles.ts`, which the page and the fix prompt both read.

One-click fixes:

- **Only when the answer is clear:** a broken reference only with one close match, a missing type only when the value gives it away, a rename only when the new name is free.
- **The DTCG spec decides what is right:** fixes bring files to the DTCG format (2025.10); no house style.
- **Nothing is lost:** properties DTCG has no place for move under `$extensions` and are written back on export to the original format.
- **The smallest edit:** only the lines a fix is about change; files without fixes download as loaded.
- **Shown first, and undoable:** every fix previews its change and can be undone.
- **Design values are yours:** colors, sizes and token meaning are never changed for you; contrast, color blindness, scales and typography come with tools instead.

Two fixes go a step further, and are kept because they are previewed and undoable: **Write the value instead** (a base token that points at another gets the resolved value) and **Remove the empty group** (the one fix that deletes, for a group with nothing in it).

The fix prompt states only the rules that apply to what it lists: keep structure, names and order; change the format, not the design; the tier directions; for contrast, re-point a token to an existing base token before changing a base value; separate status colors by lightness, not only hue; list every change per file.

## Close the loop

- **Get fixed files**: one zip holding the whole set as you loaded it, every file under its own name and in its own format, plus `CHANGES.md` listing each change per file, the actions applied, and what is still open.
- **Copy fix prompt**: every remaining correction as one Markdown prompt for an AI assistant or a ticket: files that couldn't be read, errors, warnings, contrast, color blindness, scale checks and typography alerts, with optional suggestions. Every group of findings without a one-click fix has its own button for just that group (each “need your change” group, contrast, color blindness, scale findings, typography alerts, unread files); single findings don't. Fixes apply to one token or a whole group.
- Unchanged files download byte for byte as loaded; edits change only the lines they touch.

## Privacy

- The build is a single self-contained `index.html`. All scripts and styles are inlined, and a Content Security Policy blocks loading anything external.
- Settings saved in your browser hold only preferences, never token data.
- Swatches are drawn on `<canvas>`, and every area showing file content is masked from usability-recording tools.
- **Full isolation**: clone the repository and run the strict build, which has no usability recording and works offline from a file on disk.

All color math uses OKLCH, through [Color.js](https://colorjs.io/).
