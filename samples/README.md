# Sample token sets

Design tokens from ten open-source design systems, kept here to test DTsanity
on real-world files. Each folder holds the token files, the project's
`LICENSE` and a `SOURCE.md` with the package or commit it came from and any
changes made. These are third-party files under their own licenses, not part
of DTsanity's license.

| Folder | Design system | Format | License |
|---|---|---|---|
| [carbon](carbon/SOURCE.md) | IBM Carbon | DTCG, color objects; light (White) and dark (Gray 100) themes | Apache-2.0 |
| [primer](primer/SOURCE.md) | GitHub Primer | DTCG (converted from JSON5); light/dark base files | MIT |
| [gitlab](gitlab/SOURCE.md) | GitLab Pajamas | DTCG, sRGB color objects; constant → semantic → contextual | MIT |
| [designsystemet](designsystemet/SOURCE.md) | Designsystemet (Norway) | Tokens Studio, many files with `$themes` | MIT |
| [open-props](open-props/SOURCE.md) | Open Props | DTCG-style, plus a Tokens Studio copy | MIT |
| [cloudscape](cloudscape/SOURCE.md) | AWS Cloudscape | DTCG-like, light/dark inside `$value` | Apache-2.0 |
| [spectrum](spectrum/SOURCE.md) | Adobe Spectrum | Spectrum's own format (`value`, `sets`); colors only | Apache-2.0 |
| [atlassian](atlassian/SOURCE.md) | Atlassian | Figma export (`value`); light, dark, increased contrast | Apache-2.0 |
| [backpack](backpack/SOURCE.md) | Skyscanner Backpack | Theo / Style Dictionary raw | Apache-2.0 |
| [sap-horizon](sap-horizon/SOURCE.md) | SAP Fiori Horizon | Style Dictionary (`value`); 4 themes, one file each | Apache-2.0 |

To try one, load every `.json` file in its folder at once (drag the files onto
the page). The non-DTCG sets need the legacy-format setting turned on.

`tests/samples.test.ts` loads every set and checks that it parses and
analyzes. For a per-set summary of tokens, themes, palettes and issues, run:

```bash
SAMPLES_REPORT=1 npx vitest run tests/samples.test.ts --silent=false
```
