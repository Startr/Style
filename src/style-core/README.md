# Startr.Style Core

**A complete Utility First CSS Framework for less than 53 KB (8 KB Gzipped)**

Startr.Style CSS is a super lightweight, fully responsive, utility first 
framework. All you need to build beautifully crafted web interfaces with ease.

Utility-first, largely classless CSS framework with a 3-layer color
architecture: 16 base colors cascade through 216 `color-mix()` shades
and 24 grayscale steps into named colors and framework tokens. Change
16 values, get 256 colors.

## Quick start

```bash
bun install
bun run build    # → dist/startr.min.css
bun run serve    # → localhost:3000
bun run watch    # rebuild on save
```

## Color architecture

```
Layer 3: Framework tokens    --primary, --background, --text-main, ...
Layer 2: Named colors        --black, --red, --purple, --white, ...
Layer 1: 256 palette         --color-0..15, --mix-RGB, --gray-1..24
```

Dark mode swaps named colors via `[data-theme="dark"]` — all derived
values auto-update.

## Subtree integration

This repo is embedded into
[Startr.Style](https://github.com/Startr/Style/) as a
git subtree at `src/style-core/`. From that repo:

```bash
make style_core_add      # first-time import
make style_core_update   # pull latest
make style_core_push     # push edits back here
```

## Documentation

Visit [startr.style](https://startr.style) for full docs, or open
`index.html` locally for the component showcase and `theme-creator.html`
for the interactive 256-color theme generator.
