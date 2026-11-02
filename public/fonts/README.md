# Font assets

These are the same webfont families referenced by the original Salmon Isle templates:

- LXGW Bright — https://github.com/lxgw/LxgwBright (SIL Open Font License).
- PING FANG MENG MNEG DA / 平方萌萌哒 — original font package `@chinese-fonts/pfmmd`, by 平方造字; retain the original author's license terms.

Webfont subsets were obtained from public npm packages `@chinese-fonts/lxgwwenkaibright` and `@chinese-fonts/pfmmd` through jsDelivr. No glyph outlines were modified. `scripts/vendor-fonts.mjs` records the source stylesheet locations and reproduces the vendoring step. Font family names are retained in `fonts.css`.

The LXGW Bright upstream license is included in `OFL-LXGW.txt`.

The Chinese web font storage project's MIT packaging notice is included in
`LICENSE-FONT-PACKAGES.txt`. It does not replace either font author's terms.
These font assets are not relicensed under the program's GPL-3.0-only license.
