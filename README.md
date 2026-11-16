# DTsanity

**Design tokens validator and accessibility checker.** Load your design token files, see what breaks the DTCG spec or fails contrast and color blindness, fix it in place, and download the fixed set. It runs entirely in your browser: your tokens never leave it.

## What it checks

- **DTCG format**: structure, types, values, references and metadata (spec 2025.10), with one-click fixes you can undo.
- **Contrast**: every text and UI pair against WCAG 2.2 AA, AAA or APCA, in every theme.
- **Color blindness**: pairs and status colors (danger, success…) simulated for protanopia, deuteranopia, tritanopia and achromatopsia.
- **Tiers**: base, semantic and component tokens, and whether each points at the right tier.
- **Base color scales**: lightness order, near-duplicates, hue drift, gamut (sRGB, P3), with a curve editor to reshape them.
- **Themes**: light, dark and brand variants, each checked on its own.
- **Legacy formats**: Tokens Studio and Style Dictionary v3, converted to DTCG and back.

## Close the loop

- **Get fixed files**: the whole token set as you loaded it, with your changes, in one zip with a `CHANGES.md`.
- **Copy findings report**: every remaining finding as one report for an AI assistant, your design system's tooling or a ticket.

## Privacy

Everything happens on the page: nothing is uploaded or stored. The only request it makes is for a URL you enter. To check, watch the Network tab in your browser's developer tools while you load a file, or run the strict build offline.

## Run it

Requires Node.js 20 or later.

```bash
npm install
npm run dev            # http://localhost:5173
npm test
npm run build          # hosted build: dist/index.html, one self-contained file
npm run build:strict   # strict build: no usability recording, runs offline from disk
npm run build:cli      # offline check: dist-cli/dtsanity-check.mjs, one file
npm run serve          # serve the strict build at http://127.0.0.1:4173, this machine only
```

The built page also opens straight from disk. Some browsers, Brave for one (seen on macOS), can't read a folder dragged from Finder onto a page opened that way (`file://`): files drop fine, and the same folders drop fine on a page with a web address. `npm run serve` serves the strict build at `http://127.0.0.1:4173`, to this machine only and with nothing sent anywhere. Add `-- dist` to serve the hosted build instead.

The offline check prints the same report as the page's findings report, for a folder of token files. It only reads the files and sends nothing. It exits with 1 while findings remain, so a script, CI or an assistant can check its own changes:

```bash
node dist-cli/dtsanity-check.mjs path/to/tokens --summary
```

## More

- [Features in detail](docs/features.md)
- [Development: project layout](docs/development.md)
- [Plan](PLAN.md)
- [Sample token sets](samples/README.md) from ten open-source design systems, for testing

Created by [Avin Vadas](https://avinvadas.com).
