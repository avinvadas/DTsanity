# When a view can't show its data

Every case in which a view of DTsanity shows nothing, or less than the files
hold, curated from how the tool reads tokens and from running the ten sample
design systems with legacy formats off (the default) and on.

The rule for each case: the view names the problem in one sentence and sends
the user to the one place where it is handled. It does not fix anything itself.

## What each view needs

| View | Shows | A token reaches it when it is… |
|---|---|---|
| Base tier | Color scales and loose base colors | in a file that was read · typed `color` · a value of its own, not a reference · readable as a color · read as the base tier |
| Semantic tier | Pairs of foreground and background tokens | typed `color` (or a border's color) · resolves to a readable color · named with a foreground or background word |
| Component tier | The same pairs, for component tokens | as Semantic, and inside a component group |
| Typography (in each tier) | Type styles | typed `typography`, with its parts readable |
| Tokens list | Every token | in a file that was read |
| Themes | Themes and the files each reads | files whose themes can be told: `$themes`, a resolver, file names, or values by mode |
| Issues › Contrast, Color blindness | Pair results | the same as Semantic and Component |

## Problems: the files hold the data, but it can't be read

Each of these is an error. The view says it, and links to where it is handled.

| # | The problem | Views it empties | Seen in | Where it is handled |
|---|---|---|---|---|
| P1 | A file isn't valid JSON | All, for that file's tokens | (any broken file) | Files: the file is listed as couldn't be read, with the line and column |
| P2 | A file's top level isn't a JSON object | All, for that file | (none sampled) | Issues › Structure |
| P3 | A whole file is in an older format (Tokens Studio or Style Dictionary) and legacy formats are off | All, for that file. Every view, when all files are | Atlassian, Backpack, SAP Horizon, Spectrum, Open Props (one file) | Issues › File format: the finding per file, and its fix turns legacy formats on |
| P4 | A file is in a format of its own: values by mode inside `$value`, theme sets inside tokens, types given as a schema link | All color views; the Tokens list shows the tokens without types | Cloudscape (5,139 tokens), Spectrum with legacy on (726) | Issues › File format: one finding per file says what stops it. Only a change to the file solves it |
| P5 | Tokens have no `$type`, on them or on a parent group | Every view by type: Base, Semantic, Component, Typography | Cloudscape, Spectrum, Open Props (77) | Issues › Types |
| P6 | Tokens have a type DTCG doesn't define (`fontSizes`, `boxShadow`…) | The checks by type, for those tokens | Designsystemet (552), SAP Horizon, Open Props | Issues › Types: most have a fix to the DTCG type |
| P7 | Colors are written as CSS strings (`"#0c1927"`) and legacy formats are off | Base, Semantic, Component, Contrast, Color blindness: all of them when every color is written so | Designsystemet (all 131 base colors), Open Props (all 247), GitLab (529 colors), Primer (13) | Issues › Values: the finding per token, with a fix that converts it. Or legacy formats on, in What to check › Format |
| P8 | Colors are computed from expressions (`hsla({…H}, {…S}, {…L}, {…A})`) | Base, Semantic, Component, Contrast, Color blindness | SAP Horizon (all 1,157 colors, with legacy on) | Issues › File format: legacy conversion, one note per expression. Only a change to the file solves it |
| P9 | A color value doesn't fit the color type | Those colors, in Base, Semantic, Component | (none sampled: the samples' unreadable colors are all P7) | Issues › Values |
| P10 | A reference points to a token that isn't loaded (its file wasn't added, or the code was pasted alone) | Semantic, Component, Contrast, Color blindness: all of them when the primitives file is missing | Any set loaded without its base file | Issues › References, which names the missing tokens. The fix is usually to load the base file: Files |
| P11 | References go in a circle, or point to a group | Those tokens, in Semantic and Component | (none sampled) | Issues › References |
| P12 | Values by mode are written in the token itself, and legacy formats are off | Themes: none found | GitLab, Cloudscape | Issues › File format (values per mode). With legacy formats on they are read as themes |

## Not a problem: nothing of this kind is in the files

These views are empty because the files don't have what they show. The view
says what it looks for, without an error.

| # | Why the view is empty | View | Seen in | What it says to do |
|---|---|---|---|---|
| N1 | Every color is a reference: the base file isn't loaded | Base | A semantic file loaded alone | Load the file with the base colors: Files |
| N2 | No color is a reference: only base colors are loaded | Semantic, Component | Open Props | Load the semantic files: Files |
| N3 | References exist, but none is named with a foreground or background word | Semantic, Component | (none sampled) | Add pairs in the view itself |
| N4 | No token sits in a component group | Component | Designsystemet, Open Props, Atlassian | Nothing: say that no component tokens were found |
| N5 | No typography tokens | Typography (the section is left out) | Carbon, Atlassian, Backpack, Open Props | Nothing |
| N6 | One theme, or files read as one set | Themes | Backpack, Open Props | Add themes, in the view itself |
| N7 | Base colors don't form scales | Base: colors shown loose, no scales | Atlassian, Backpack | Nothing: the loose colors are shown |
| N8 | Colors with values of their own are read as semantic or component tokens | Base shows fewer colors than the files have | Backpack (300 of 396) | Issues › Tiers, where each is flagged |

## Where the user is looking from

| # | Why the view shows less | View | What it says to do |
|---|---|---|---|
| W1 | A theme is picked in the sidebar, and it doesn't read some files | All tier views | Pick All themes, or another theme, in the sidebar |
| W2 | With all themes on, Base shows the first theme only | Base | Pick a theme in the sidebar (already said in the view) |
| W3 | A file no theme reads | All tier views, for that file | Themes, where files are assigned to themes |
| W4 | Only `$themes` or `$metadata` was loaded, with no token files | All | Load the token files: Files |
| W5 | A file was set aside as not a token file (package.json and similar) | All, for that file | Files, where set-aside files are listed |

## How a view tells which case it is in

A view follows its own tokens through the stages in "What each view needs"
and stops at the first stage where nothing is left. That stage is the case.
When the tokens stop at several stages, the one that holds the most comes first.

1. Files: none loaded besides meta files (W4); any unreadable (P1, P2); all in an older format with legacy formats off (P3).
2. Format: files of a format of their own (P4, P12).
3. Types: tokens without a type DTsanity knows (P5, P6).
4. Values: colors that can't be read (P7, P8, P9).
5. References: colors that don't resolve (P10, P11).
6. Tier and naming: what remains is all of another kind (N1–N8).
7. Scope: the sidebar's theme (W1–W3).
