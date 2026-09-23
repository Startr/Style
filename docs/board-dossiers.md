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
  - `swap:before`, `swap:navigate`, `swap:after`, `swap:error` — all on the region, bubbling,
    cancelable. Cancelling `swap:navigate` is how a host takes the address bar back.
  - **Regions nest, so sub-swaps cost no syntax at all.** A pager inside a region updates that
    region and leaves the page alone, declaring nothing. A sub-swap region does need an `id`,
    because the response has to be able to name the piece coming back.
  #ContentExcellence #docs

- [ ] **🎪 Build the demo: two static pages linking to each other, and nothing else.** The whole
  integration is a `<script defer>` tag and one word of markup, and the gallery should show
  exactly that rather than a framework tour. AI-UI proves this with a fixture pair
  (`cypress/fixtures/swap/a.html`, `b.html`) plus a third page — `none.html` — that loads the
  script, declares no region, and **carries a `<main>` on purpose**. Port all three; the third is
  the interesting one, see below. #ContentExcellence

- [ ] **🪤 Carry these three findings into the docs — every consumer will hit them.** Each cost
  real time to find, and each is silent when wrong.
  1. **There is no `<main>` default, deliberately.** The first version claimed `<main>` when no
     region was declared. Any document can end up running this file — a host application that
     adopts a fetched page's scripts adopts this one too — and a `<main>` default would then take
     over every link in a document that never asked for it. In AI-UI it did not fire *only*
     because that SPA renders no `<main>` at all. Working by luck. **A region must be declared.**
  2. **The click listener CAPTURES; the submit listener does not.** A single-page router binds its
     own document-level click listener at boot, so in the bubble phase it always wins — it takes
     the click, finds the address is not one of its routes, and does a full page load. Capture puts
     a declared region ahead of a generic router. Submit stays in the bubble phase on purpose,
     because attribute-driven libraries bind submits on the FORM, and an element listener runs
     after a document capture — capturing would take their submits away from them.
  3. **A POST that redirected must push history; a POST that answered in place must not.**
     Post/Redirect/Get lands on a plain address a reader can reload and share. A POST that answered
     in place has an address that only accepts POST, so pushing it hands the reader a reload that
     405s. `res.redirected` is the exact signal. Get this wrong and the content swaps to the page
     you asked for while the address stays on the one you left.
  #docs #footgun

- [ ] **🌱 Employ it here.** This site is the obvious first consumer: it is a static Eleventy build
  of many small documentation pages, which is precisely the shape the library is for. Adopting it
  is also the honest test of the docs above — if the gallery cannot be wired from its own
  documentation, the documentation is wrong. #dogfood
