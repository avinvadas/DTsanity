# IBM Carbon

- Source: npm `@carbon/themes` (`tokens/`) and `@carbon/colors` (`tokens/colors.tokens.json`) — https://github.com/carbon-design-system/carbon
- Version: @carbon/themes 11.85.0, @carbon/colors 11.62.0
- License: Apache-2.0 (see `LICENSE` in this folder)
- Downloaded: 2026-11-12

Files are unmodified, in the packages' own layout, side by side as npm
installs them: `themes/tokens/` is `@carbon/themes/tokens/` and
`colors/tokens/` is `@carbon/colors/tokens/`. `themes/tokens/themes.resolver.json`
is Carbon's DTCG resolver: the palette plus one folder per theme (white, g10,
g90, g100). Theme tokens reach palette colors through `{alias}` references and
`$ref` pointers (`#/gray/50/$value/components`) into the resolved set. Left out:
the packages' README files.
