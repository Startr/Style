# Board dossiers

Full original text of TODO.md cards compressed by a register pass. Zero information loss; the board wins on conflict.

## 🔀 Startr Swap — the first JavaScript this project would ship (dossiered 2026-09-05)

## 🔀 Startr Swap — the first JavaScript this project would ship

Built and proven in `sage-is/AI-UI` on 2026-08-09 (`app/backend/sage_is_ai/pages/assets/startr-swap.js`).
It is written as a library from the first line — nothing in it names that application — but it
does not live here yet, it is not documented here, and it is not published. Full reasoning:
`WEB-AI--Sage-is-AI-UI/docs/decisions/2026-08-09-startr-swap-link-swapping.md`.

**What it is.** Same-origin links and forms swap in place instead of reloading, wrapped in a CSS
View Transition. Lineage is htmz (MIT, © Lean Rada), whose hash-names-the-target convention it
keeps — but **not** its hidden iframe. An iframe performs a REAL navigation, so scripts in the
response execute inside it, in the wrong document, and every swap re-requests the page's
stylesheets. On a static site that is a CDN hit per click. `fetch` + `DOMParser` parses inert.

- [ ] **⚖️ Settle which licence covers it — this blocks publishing and nothing else does.** This
  repo carries **three answers**: `LICENSE` is AGPL-3.0, `LICENSE.txt` is MIT (© 2023 OpenCo and
  Startr, © 2020 ciar4n), `package.json` says ISC. A stylesheet survives that ambiguity because
  nobody embeds a stylesheet in their own distribution; **a script meant to be dropped into other
  people's static sites does not.** AGPL rules out the use this was written for, MIT permits it.
  Pick one, and while in there resolve it against the README/package.json version drift already
  filed in the Backlog. #licence #critical

- [ ] **📏 Record the size diff and hold it.** `startr-swap.js` is **11,932 bytes raw / 5,343
  gzipped**. htmx, which it is designed to replace, is **50,917 / 16,367** — so it is roughly a
  fifth raw and a third gzipped, for the three attributes consumers actually use. AI-UI holds this
  with a gate (`make startr_swap_check`) whose ceiling is **half of htmx gzipped**, plus a
  self-test proving the gate can fail. Port the ceiling here when the file moves, or the number
  quietly stops being true. #perf #ratchet

- [ ] **📦 Publish at `/v1/swap.js` AND `/swap.js`, with SRI.** Same discipline as the CSS
  versioning item in the Backlog, and it matters MORE for script: an unversioned stylesheet that
  changes gives consumers a visual regression, an unversioned script URL is a live-code channel
  into every consumer's page. Consumers pin the versioned URL with `integrity`. **Sage.is AI-UI
  deliberately serves its own copy rather than the CDN** — zero third-party requests on the page,
  nothing to 5xx, air-gapped deployments behave the same — so the CDN build is for everyone else.
  #versioning #security

- [ ] **📚 Document the API. It is three attributes and four events, and that is the whole thing.**
  - `data-swap` on a region marks it; an optional value narrows link takeover to a path prefix,
    and nested regions inherit it.
  - `data-swap-target` on a control updates *that* region instead of the one the control lives in.
    It exists for exactly one case the nearest-ancestor rule cannot reach: a control that lives
    **outside** the region it updates, such as a search form above its own results.
  - `data-swap-off` on a control means never.
  - `swap:before`, `swap:navigate`, `swap:after`, `swap:error` — all on the region, bubbling, cancelable. Cancelling `swap:navigate` is how a host takes the address bar back.
  - **Regions nest, so sub-swaps cost no syntax at all.** A pager inside a region updates that region and leaves the page alone, declaring nothing. A sub-swap region does need an `id`, because the response has to be able to name the piece coming back.
  #ContentExcellence #docs

- [ ] **🎪 Build the demo: two static pages linking to each other, and nothing else.** The whole integration is a `<script defer>` tag and one word of markup, and the gallery should show exactly that rather than a framework tour. AI-UI proves this with a fixture pair (`cypress/fixtures/swap/a.html`, `b.html`) plus a third page — `none.html` — that loads the script, declares no region, and **carries a `<main>` on purpose**. Port all three; the third is the interesting one, see below. #ContentExcellence

- [ ] **🪤 Carry these three findings into the docs — every consumer will hit them.** Each cost real time to find, and each is silent when wrong.
  1. **There is no `<main>` default, deliberately.** The first version claimed `<main>` when no region was declared. Any document can end up running this file — a host application that adopts a fetched page's scripts adopts this one too — and a `<main>` default would then take over every link in a document that never asked for it. In AI-UI it did not fire *only* because that SPA renders no `<main>` at all. Working by luck. **A region must be declared.**
  2. **The click listener CAPTURES; the submit listener does not.** A single-page router binds its own document-level click listener at boot, so in the bubble phase it always wins — it takes a declared region ahead of a generic router. Submit stays in the bubble phase on purpose, because attribute-driven libraries bind submits on the FORM, and an element listener runs after a document capture — capturing would take their submits away from them.
  3. **A POST that redirected must push history; a POST that answered in place must not.**
     Post/Redirect/Get lands on a plain address a reader can reload and share. A POST that answered in place has an address that only accepts POST, so pushing it hands the reader a reload that
     405s. `res.redirected` is the exact signal. Get this wrong and the content swaps to the page you asked for while the address stays on the one you left. #docs #footgun

- [ ] **🌱 Employ it here.** This site is the obvious first consumer: it is a static Eleventy build of many small documentation pages, which is precisely the shape the library is for. Adopting it is also the test of the docs above — if the gallery cannot be wired from its own documentation, the documentation is wrong. #dogfood

## Register pass 2026-10-18

Lines as they stood before the split; line numbers are the old ones.

- L81: - [ ] Make the comments ASCII-only: 173 `─` rulers, 18 em dashes and one `…` (192 non-ASCII characters, none in code). A host that serves `.js` without a charset shows them as `â€¦` in the raw view; Netlify sends `charset=UTF-8`, the Eleventy dev server does not. Saves about 500 bytes raw. Same pin change as the header line, so ship both together.
- L96: - [ ] **Ship pinned and rolling CDN versions**: Currently unversioned — any change to Startr.Style hits every consumer (Sage.is, Sage.Education) instantly, with no rollback path. Publish `/v1/`, `/v2/`, and a rolling `/latest/`. Implementation approach: submodule structure where `v1/` is a submodule pointing to the project at the v1 tag, `v2/` at v2, etc. — versioned URLs serve from the pinned submodule, `latest/` serves from `master`.
- L98: - [ ] **Cache headers — versioned vs rolling**: `/v1/style.css`, `/v2/style.css`, etc. → `Cache-Control: public, max-age=31536000, immutable` (one year, immutable; the URL's contents never change by design). `/latest/style.css` → `Cache-Control: public, max-age=60, must-revalidate` (short TTL + revalidate so studio pushes propagate quickly and stale copies don't linger). *(Surfaced by Zach Leatherman, 2026-04-18.)*
- L99: - [ ] **Emit SRI integrity hashes for each pinned release**: Generate `sha384` integrity hashes at release time and publish them alongside the versioned URL so consumers can use `<link rel="stylesheet" href="/v1/style.css" integrity="sha384-..." crossorigin="anonymous">`. Gives consumers an integrity guarantee even though Startr.Style is on a separate origin. *(Surfaced by Zach Leatherman, 2026-04-18.)*
- L100: - [ ] **Resolve version drift between README and package.json**: `README.md` opens with `1.3.1`; `package.json` declares `1.2.2.2`. Pick one source of truth (conventionally `package.json`) and make the README read from it, or bump them in lockstep via `scripts/release.sh`. *(Surfaced by Lea Verou in a panel review of Startr.Style, 2026-04-20.)*
- L104: - [ ] **Give prop typos a failure mode**: An inline prop with no matching `[style*="--X:"]` rule fails silently — no error, no fallback, the declaration just sits inert. Two real hits in build.sage.education (2026-08-25, commit 3198f0b): `--ovx` written for `--ofx`, `--lst` written for `--lis`; both shipped broken layout and were caught only in a 360px visual pass. #dx #landmine
- L111: - [ ] **Shorthand dual bindings** (`--br` = border-radius AND border-right; `--bs`, `--td`, `--fs`, `--cr` value-disjoint pairs): the naming decision is filed in `WEB-startr.style.core/TODO.md` — resolve it there, then mirror the outcome here. Consumers are already routing around the DSL (build.sage.education writes plain `flex-shrink:0` to avoid `--fs`). #landmine
- L117: - [ ] **Reconcile `:focus-visible` audit status with spoken claims**: The `-hvr` coverage audit above has been open since 2026-04-18, yet a verbal claim of "keyboard accessibility tested, no issues" was made during the 2026-04-20 panel. Either close the audit with a landed commit, or retract the claim. Both states cannot be true at once. *(Surfaced by Heydon Pickering in a panel review of Startr.Style, 2026-04-20.)*
- L123: - [ ] **Register critical custom properties with `@property`**: Without registration, the browser treats colour and layout variables as untyped strings. Downstream `color-mix()` and `calc()` can silently IACVT when consumers pass malformed values. Register `--primary`, `--background`, `--text-main`, and the 216-cell cube entries so the browser can validate inputs and animate between them. *(Surfaced by Lea Verou in a panel review of Startr.Style, 2026-04-20.)*
- L140: - [ ] **Reset replaced elements to `display: block`**: Startr.Style ships `img { max-width: 100% }` but never resets `display` or `vertical-align`, so every `<img>` stays `display: inline` and sits on the text baseline. The line box reserves descender space *below* the baseline, which surfaces as a ~2–4px phantom gap under any image that's the tallest item in a flex/grid cell. Every consumer rediscovers this and patches it locally (Startr.ca card sections needed a per-image `--d: block`; a `--mb: -2px` magic-number was the tempting wrong fix). The conventional reset — shared by Tailwind Preflight, `sanitize.css`, `normalize.css` — is `img, svg, video, canvas, audio, iframe, embed, object { display: block; vertical-align: middle; }`. Decide whether to fold this into the framework's base reset. *(Surfaced while debugging the Startr.ca card layout, 2026-07-01.)*
- L141: - [ ] **Gauge blast radius before landing**: a global `img { display: block }` shifts any consumer that *intends* inline images flowed with text (icons mid-sentence, inline logos/badges, emoji-style glyphs). Before committing, `grep` the known consumers (`WEB-Sage.is`, `WEB-Sage.Education`, `WEB-startr`, `WEB-AI--Sage-is-AI-UI`) for inline-image usage; if the fallout is real, prefer `vertical-align: middle` alone (kills the descender gap while keeping images inline) over forcing `display: block`.
- L476: - [ ] **Framework `--c` / `--bg` / `--b` bindings should cover form controls + links**: `[style*="--c"] { color: var(--c) }` loses to UA defaults on `<input>`, `<button>`, `<select>`, `<textarea>`, `<a>` (system color keywords `ButtonText`/`FieldText` and `-webkit-link` win). Consumers have to pull `color: var(--c)` explicitly in component CSS, defeating the inline-primitive promise. Either (a) extend the framework's bindings with the form-control selector list, or (b) document the gotcha prominently. Surfaced 2026-06-08 during Sage.is signup-gate refactor — the unlock button rendered text in browser's default ButtonText (black) on a `--bg: var(--c-ink)` (black) pill despite inline `--c: var(--c-cream)`. Workaround applied at `WEB-Sage.is/src/_includes/signup-gate.njk` (CSS rule explicitly pulls `color: var(--c)` into `.signup-gate__submit` / `.signup-gate__input` / `.signup-gate__provider`).
- L478: - [ ] **Document the brand "gradient text" default + ship `.text-flat` opt-out utility**: The site-wide rule `h1, h2, h3, h4, h5, button, .button, strong { background-image: linear-gradient(...); background-clip: text; -webkit-text-fill-color: transparent; }` is a deliberate brand default (Sage.is keeps strong defaults to stay simple). It bites consumers who build custom components with solid backgrounds — the text fill is transparent and the gradient is hidden behind the solid bg, leaving invisible text. The three-property opt-out incantation (`background-image: none; background-clip: border-box; -webkit-text-fill-color: currentColor;`) is non-obvious. Action: (a) document the default behavior + the opt-out in startr.style docs alongside the framework primitives, and (b) ship a utility class — e.g. `.text-flat` or `.no-gradient-text` — that bundles the three-property opt-out so consumers can write `<button class="text-flat">` instead of remembering the recipe. **Smarter-defaults option to weigh:** drop `button, .button` from the selector list entirely — interactive controls almost always have a solid background that hides the gradient anyway, so the default does nothing useful there and only causes the invisible-text trap. Keep the gradient on `h1-h5, strong` where it actually reads. Surfaced 2026-06-08 during Sage.is signup-gate work — the submit button, h2 heading, and `<strong>` titles all needed the same three-line reset. Workaround currently lives in `WEB-Sage.is/src/_includes/signup-gate.njk` and `whats-included.njk`.
