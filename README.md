# Startr.Style Core

**A complete Utility First CSS Framework in about 76 KB minified (13.5 KB gzipped)**

Startr.Style CSS is a super lightweight, fully responsive, utility first framework. All you need to build beautifully crafted web interfaces with ease.

Utility-first, largely classless CSS framework with a 3-layer color architecture: 16 base colors cascade into named colors and framework tokens. Change 16 values and the whole theme follows. Any cell of the 6×6×6 color cube is one prop away (`--mix: 314`), and any tint or grey is `--tone: N`; both are computed on the element that asks, not shipped as 256 tokens.

## Quick start

```bash
bun install
bun run build    # → dist/startr.min.css
bun run serve    # → localhost:3000
bun run watch    # rebuild on save
```

## Color architecture

```text
Layer 3: Framework tokens    --primary, --background, --text-main, ...
Layer 2: Named colors        --black, --red, --purple, --white, ...
Layer 1: Base 16             --color-0..15
On demand:                   --mix: RGB → --mixed    --tone: N (+ --tone-of) → --toned
```

Dark mode swaps named colors via `[data-theme="dark"]` — all derived
values auto-update.

## Checks

```bash
bun run parity   # the build against the published 1.x sheet (test/fixtures/published-1.3.2.css)
bun test scripts # bands, states, motion, colour, button hover, manifest, parity
bun run ingest <draft.html|.css>   # how a design maps onto the kit, rule by rule
```

Every build writes `props.json` beside `startr.css`: every prop, tier, state and token the sheet defines. Lint against it; an unknown prop does nothing.

## Ingesting a design

[docs/design-ingest.md](docs/design-ingest.md) is the runbook for turning a design example into inline props and one behaviour script per component: the buckets, the token map, when a gap becomes a new prop, and the checks.

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
`index.html` locally for the component showcase and `theme-creator.html` for the interactive theme generator.
