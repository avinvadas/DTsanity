# DTsanity development

## Project layout

Plain TypeScript with native custom elements, no framework. Vite is used only to build.

```
src/json/      lossless JSON parser/serializer (keeps key order and formatting byte-for-byte)
src/model/     token model: collection, $type inheritance, $extends, alias and $ref resolution, Tokens Studio sets
src/validate/  DTCG 2025.10 rules (structure, types, values, references, metadata) with suggested fixes
src/legacy/    Tokens Studio / Style Dictionary v3 ↔ DTCG conversion
src/color/     Color.js bridge: DTCG colors, OKLCH analysis, display formats, gamut mapping
src/palette/   base-tier palettes, step order and lightness placement, scale checks
src/semantic/  foreground/background pairs, re-aliasing, status-color siblings
src/contrast/  WCAG 2.2 / APCA levels, pass ranges, step distance, cross-palette parity
src/curves/    curve model: monotone splines, anchor, presets, gamut fitting, contrast-targeted lightness, batch mapping
src/themes/    theme detection (file names, Tokens Studio $themes, $extensions modes) and the all-themes view
src/state/     store, settings, undoable edits and fixes
src/io/        loading (file, drop, URL), export, the fixed-set zip with CHANGES.md, the fix prompt
src/ui/        custom elements
tests/         Vitest suites and fixture token files
```
