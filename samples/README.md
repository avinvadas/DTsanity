# Sample token sets

Design tokens from ten open-source design systems, kept here to test DTsanity
on real-world files. Each folder holds the token files, the project's
`LICENSE` and a `SOURCE.md` with the package or commit it came from and any
changes made. These are third-party files under their own licenses, not part
of DTsanity's license.

| Folder | Design system | Format | License |
|---|---|---|---|
| [carbon](carbon/SOURCE.md) | IBM Carbon | DTCG 2025.10 with a resolver file; four themes, one folder each; `$ref` pointers into the palette | Apache-2.0 |
| [primer](primer/SOURCE.md) | GitHub Primer | DTCG in JSON5; light/dark base files | MIT |
| [gitlab](gitlab/SOURCE.md) | GitLab Pajamas | DTCG, sRGB color objects; constant → semantic → contextual | MIT |
| [designsystemet](designsystemet/SOURCE.md) | Designsystemet (Norway) | Tokens Studio, many files with `$themes` | MIT |
| [open-props](open-props/SOURCE.md) | Open Props | DTCG-style, plus a Tokens Studio copy | MIT |
| [cloudscape](cloudscape/SOURCE.md) | AWS Cloudscape | DTCG-like, light/dark inside `$value` | Apache-2.0 |
| [spectrum](spectrum/SOURCE.md) | Adobe Spectrum | Spectrum's own format (`value`, `sets`); colors only | Apache-2.0 |
| [atlassian](atlassian/SOURCE.md) | Atlassian | Figma export (`value`); light, dark, increased contrast | Apache-2.0 |
| [backpack](backpack/SOURCE.md) | Skyscanner Backpack | Theo / Style Dictionary raw | Apache-2.0 |
| [sap-horizon](sap-horizon/SOURCE.md) | SAP Fiori Horizon | Style Dictionary (`value`); 4 themes, one file each | Apache-2.0 |

Every file is as its design system publishes it, in its own folders; a set
that DTsanity can't read as published is a bug in DTsanity, not in the set.
To try one, drop its folder onto the page (or click “Or choose a folder”).
The non-DTCG sets need the legacy-format setting turned on.

Four suites run on these sets, as part of `npm test`:

- `tests/samples.test.ts`: every set parses and analyzes.
- `tests/fix-safety.test.ts`: applying every fix changes the files' format,
  never what their tokens mean (an independent oracle in `tests/oracle/`
  compares colors, lengths, line heights… before and after), loses no token,
  breaks no reference, adds no error, undoes byte for byte and reads the same
  when exported and loaded again.
- `tests/planted.test.ts`: known defects (a broken or misspelled reference,
  a missing or misspelled type, a hex string for a color, `value` without
  the `$`, a duplicate key, a loop, a reference to a group, a `.` in a name,
  an empty group) are planted at seeded-random places in the DTCG sets; each
  must be caught, and a fix must give back what was there.
- `tests/remedy.test.ts`: each check's fix label matches what it offers.

For the per-set summary and the planted-defects catch rates, run:

```bash
npm run test:samples -- --silent=false
```
