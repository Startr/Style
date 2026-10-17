# startr.style.core TODO

## 🚧 High Priority

- [ ] **🔥 `--br` sets border-radius and border-right: a rounded, bordered element loses its right border** #bug #critical — dossier: docs/board-dossiers.md
  - [x] Workaround: `--radius` is radius-only; props.json flags `--br` as a collision and docs/design-ingest.md routes consumers to `--radius` (2026-10-16)
  - [x] 1.x keeps the binding: AI-UI (Interface.svelte:431/437/444, Images.svelte:552, ModelEditor.svelte:583), Sage.is hardware/index.njk:285 and Style layout_2.njk:39 use `--br` as border-right (2026-10-16)
  - [ ] 2.0: keep `--br` = border-radius, rename border-right (`--b-rt`? `--bri`? one side set with `--bt/--bl/--bb`), ship a migration table the manifest lint can name
  - [ ] Same 2.0 call on `--bs` (border-style/box-shadow), `--td` (text-decoration/transition-delay), `--fs` (font-style/flex-shrink), `--cr` (column-rule/clear); props.json flags all five
  - [x] Core generates the published sheet (Alexander, 2026-10-16: converge, then extend 1.x); proof: `bun run parity` → PARITY OK against test/fixtures/published-1.3.2.css. Core had the `-pt` tier all along (src/mixins.css)

- [ ] **Publish 1.x from core: 1.4.0 is live (2026-10-16); the pinned /v*/ URLs wait on a Cloudflare rule** #release
  - [x] Core merged to master through PR #1 (e027981, 2026-10-16)
  - [x] Startr/Style: 1.3.2 pinned as served, subtree pulled, `bun install` in src/style-core (2026-10-16)
  - [x] Startr/Style: `make core_publish`, release v1.4.0, deploy; live /style.css b845cff…, /props.json, /startr.css (2026-10-16)
  - [ ] [MANUALLY] Cloudflare, not Netlify: a redirect rule on the startr.style zone sends /v1.3.2/ and /v1.4.0/ to image.startr.cloud; narrow it to numeric WxH (Startr/Style TODO.md)
  - [x] `/startr.css` kept: `make core_publish` writes it into static/ (2026-10-16)
  - [x] Trellis vendors 1.4.0, pinned by hash, and lints template props (feature/frontend-ux a27f6c3, 2026-10-16); the re-cut follows there

## 📋 Backlog

- [ ] **Lint two silent pairings** (ingest and Trellis kit_lint): `--text-grad` with a `--bg-*` state (the shorthand resets background-clip, so the text vanishes on hover or on), and a `*-hover` effect helper with `--boxs`/`--t` on one element (the helper is not `!important` and never shows)
- [ ] `--gutter-sm..xl` are never defined (src/helpers/_layout.css:12-21), so the `.wrapper` tier gutters do nothing
- [ ] **Size: the 1.x extension costs +2.35 KB gzip against a 2 KB budget** (11.65 → 14.0 KB, both minified by cssnano, 2026-10-16); no size gate yet
  - [ ] Levers: helper focus copies −200 B, in-hover focus copies −92 B, `--bgc`/`--bc` states −140 B, `--cur` hover −12 B; the focus copies serve keyboard users
- [ ] **Dark mode: core's neutral #1F/#E6 against the published blue-black** — 1.x keeps the published values; switching restyles every consumer's dark mode (decision)
- [ ] `--grad-top` reads `var(--grad-bottom)` (src/utilities/_background.css:11; the published sheet's line 797 too) #bug
- [ ] Reduced motion: a spinner on `--anim` freezes (essential-motion opt-out?); `--sb` smooth scroll still animates
- [ ] `--bdf` ships no `-webkit-backdrop-filter` (autoprefixer targets); Safari before 18 needs it
- [ ] `--mix`/`--tone` hue guards rely on Chrome's powerless-hue rule; test in Safari and Firefox
- [ ] No `:focus-within` state: a card holding a focused link shows nothing (the runbook says to make the link the card)
- [ ] Tier plus state names (`--bg-hover-md`) are not modelled; the manifest warns `combo-name`
- [ ] Ingest: flag hex inside inline `style` attributes; turn `MANIFEST_STRICT` on by default
- [ ] CI: run `bun test scripts` and `bun run parity` in .github/workflows (builddist.yml only builds)
- [ ] CI: builddist.yml cannot push dist/ (403: the workflow token lacks contents:write, failing since 2026-08); grant it or drop the auto-commit, which also commits as a stale author
- [ ] snapshot-version.sh pins no props.json, and `make release` skips `version_snapshot` (both in Startr/Style)
- [ ] src/base/_links.css is imported by no build and holds SCSS-isms; prune it

## ✅ Done

- [x] **1.x extension: states, motion, colour by math, effects, manifest, parity, ingest runbook** (2026-10-16) — proof: `bun test scripts` 670 pass, 1 skip, 0 fail (8 suites); `bun run parity` PARITY OK
  - [x] build.ts combines media queries in their own pass (every tier rule had shipped as a literal `$(var)-sm`)
  - [x] States `-hover`, `-focus`, `-active`, `-on`, `-in-on`, `-in-hover` on the paint set; the ladder is held by scripts/bands.test.ts
  - [x] `--anim`, the st-* keyframes and the reduced-motion guard; `--text-grad`, `--bdf`, `--glow`; `--button-hover` wired
  - [x] Colour by math: `--mix`, `--tone`; the 245-token palette is gone (−1.6 KB gzip); 216 cells within 2.3e-5
  - [x] props.json and its test; docs/design-ingest.md; `bun run ingest`
