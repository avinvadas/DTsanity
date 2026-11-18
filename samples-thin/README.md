# Thin sample sets

Small but realistic editions of seven sets in [samples/](../samples/README.md),
for quick checks: the same formats and structure, a fraction of the tokens.

| Folder | From | Format | Tokens |
|---|---|---|---|
| [gitlab](gitlab/SOURCE.md) | GitLab Pajamas | DTCG; constant → semantic → contextual | 319 of 972 |
| [designsystemet](designsystemet/SOURCE.md) | Designsystemet | Tokens Studio with `$themes` | 461 of 835 |
| [carbon](carbon/SOURCE.md) | IBM Carbon | DTCG with a resolver; two of four themes; `$ref` pointers | 291 of 1486 |
| [cloudscape](cloudscape/SOURCE.md) | AWS Cloudscape | Light and dark inside `$value`, with contexts | 540 of 5139 |
| [atlassian](atlassian/SOURCE.md) | Atlassian | Figma export (`value`); light and dark | 298 of 1868 |
| [backpack](backpack/SOURCE.md) | Skyscanner Backpack | Theo / Style Dictionary raw, `{!ALIAS}` | 285 of 596 |
| [sap-horizon](sap-horizon/SOURCE.md) | SAP Fiori Horizon | Style Dictionary (`value`); two of four themes | 1182 of 24752 |

Every set except GitLab and Carbon needs legacy formats on.

Each keeps a few hues, the core semantic tokens and one or two components
(each `SOURCE.md` says which), plus every token they point at, so the
trimming breaks no reference. Tokens are as published; only whole tokens,
files and themes are left out. The findings left are the sets' own: no kind
of finding appears that the full set doesn't have.

Primer isn't here: its files are JSON5, which the script doesn't read.

Made by `node scripts/thin.mjs`, which reads `samples/` and rewrites the set
folders; don't edit them by hand. The files keep their projects' licenses
(`LICENSE`, and `NOTICE` where there is one, in each folder).
