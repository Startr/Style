# Design ingest

## In short

Turn a design example into inline props and one behaviour script per component. Keep the visual language in the kit: no per-component stylesheet, no classes and no third visual language. Work in the consumer repo. Map the design, then verify it against the example.

The path at a glance. Each step has its own section under The path.

0. [WE] Build the kit and its `props.json` into a scratch folder.
1. [WE] Capture the draft in the consumer's `docs/`, with phone (390px) and desktop (1280px) screenshots.
2. [WE] Inventory: `bun run ingest <draft>` puts every rule in a bucket and suggests the prop.
3. [WE] Map colours and fonts to kit tokens. A new colour or face goes to Alexander [MANUALLY].
4. [WE] Decide each gap: an existing prop, a server variant, a restructure or a behaviour script, in that order.
5. [MANUALLY] then [WE]: a general gap becomes an upstream prop in core, behind six gates and a versioned release.
6. [WE] Re-cut the page: inline props, template macros and one script per component, mobile first.
7. [WE] Verify: the lint is clean, the consumer's gates pass, the screenshots match, and keyboard, touch and reduced motion are checked.
8. [WE] Record the counts and decisions on the consumer's board. [MANUALLY] Commit and release.

## When to use it

Use this runbook when a design example arrives and the kit's vocabulary does not cover it yet. The input may be an HTML mockup, CSS draft or screenshot with CSS. Map what is there rather than redesigning it.

## Words

- Core: this repo, `WEB-startr.style.core`. It builds the sheet.
- The published sheet: the 1.x sheet that Startr/Style serves, at `src/static/style.css` there. Startr/Style embeds core as a git subtree at `src/style-core/`. Never hand-edit the published sheet.
- Consumer: a site or app that vendors the sheet and styles itself with `style` attributes. The Trellis CRM, AI-UI and Sage.is are consumers.
- Prop: a custom property in a `style` attribute that the sheet maps to a CSS property, as in `[style*="--bg:"] { background: var(--bg) !important }`. Every kit prop rule is `!important`.
- Tier: a width suffix. `-sm` is 640px, `-md` 768px, `-lg` 1024px, `-xl` 1280px, and `-pt` is print. All are `min-width` queries. A few grid props also have `-xs` (440px).
- State: a whole-word suffix: `-hover`, `-focus`, `-active`, `-on`, `-in-on`, `-in-hover`.
- Helper: a prop that runs a formula, such as `--glow`, `--tone`, `--mix` or `--text-grad`.
- Behaviour script: one small JS file per component. It toggles attributes and writes inline geometry. It never toggles classes and never holds styles.
- Manifest: `props.json`, which `build.ts` writes from the finished sheet. The schema is documented at the top of `scripts/manifest.ts`.
- Parity: `scripts/parity.ts` diffs the sheet core builds against the published sheet. It fails on any difference that has no allowlist entry.

## Inputs and ground rules

Inputs:

- An HTML mockup with its own `<style>` blocks.
- A design draft with its own CSS files.
- A screenshot plus its CSS. The CSS is the source of truth, and the screenshot is the visual check. A screenshot without CSS is not an input. Ask for the CSS.
- Tailwind markup. AI-UI's `tools/tw2startr` converts the classes first. It writes suffix states (`hover:bg-…` becomes `--bgc-hover`) only where the kit defines them, and leaves any other state as a class for review. Its `dark:` output (`--dark-bgc`) is not a kit prop and does nothing: in the kit, dark mode comes from tokens that flip under `[data-theme="dark"]`. Treat each `--dark-*` as a token decision (step 3).

Ground rules:

- Use fixture data only. Never read a gitignored `mockups/` folder because it can hold real client data.
- Keep zero egress. The page requests nothing from another origin, including Google Fonts, CDN scripts, remote images and analytics.
- Work in the consumer repo, one folder per page and one component at a time. Touch core only to propose a prop.
- Map the design. Log each difference as a decision.
- Never edit the consumer's vendored sheet or hand-edit `dist/`. The build writes `dist/`.
- Add the task to the repo's `TODO.md` before starting. Follow the Startr convention: plan, document, execute, verify.
- Keep fonts self-hosted.
- Write markup with inline props in `style` attributes and one behaviour script per component.
- Make scripts toggle `aria-*` or `data-on`, never classes. Scripts set attributes and inline geometry, never styles.
- Start with base values for the smallest viewport. Add `-sm`, `-md`, `-lg` or `-xl` only when layout changes. Never repeat a base value in a tier.

## The buckets

Give each rule one bucket. When a rule has several needs, the hardest need wins. Rank them G, B, C, D, F, E, A-var, A′, A. `bun run ingest` applies this order. The table lists buckets in the tool's display order.

| Bucket | The draft has | Write it as | Watch for |
| --- | --- | --- | --- |
| A. Existing prop | a plain property the kit already owns: display, gap, padding, colour, width, radius | the prop from `props.json`: `--d:flex; --g:.5rem; --p:.5rem .75rem; --size:.9rem; --weight:600; --radius:.5rem` | look the name up, never guess: `--opacity` and `--list-style` are not props (`--op` and `--lis` are). Use `--radius`, never `--br`: `--br` also sets border-right. A rule that only descends (`.card h2`) is still A: put the props on that element |
| A-var. Server variant | a rule keyed on a data attribute the server renders, such as `[data-st="done"]` | a template macro that emits the prop string for the state: `style="{{ chip(task.state) }}"`. Keep the data attribute for scripts and tests; no rule reads it | one shared partial holds the macros. AI-UI's `_workshop.html` is the pattern: named prop strings like `{% set card_s = "--fb:18rem; --fg:0; ..." %}`, used as `style="{{ ws.card_s }}"`. It predates the `--radius` rule: copy the pattern, not its `--br` |
| A′. SVG | rules for `svg` and `path`: fill, stroke, width, caps | attributes on the element: `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"` plus `width` and `height`. Or markup | `stroke="currentColor"` lets the element's `--c` and its states drive the icon |
| B. Own state | `:hover`, `:focus-visible`, `:active`, and current, selected or open on the element itself | suffix props in the paint set (bg, bgc, c, b, bc, boxs, op, t, oe): `--bg-hover`, `--oe-focus` (keyboard `:focus-visible`), `--bg-active`, `--bg-on`. Scripts toggle `aria-*` or `data-on` | the paint set is closed: no weight state (it reflows; render it on the server), no text-decoration state. Hover works only where the device can hover, and it also fires on keyboard focus. Add `--tn` to animate the change. See the on list and the ladder |
| C. Parent state | a rule that changes a child when its parent is hovered, on or open: `.nav .on svg`, `.row:hover .chev`, `[open] > summary`. Or a `::before` or `::after` | `--c-in-on`, `--bg-in-on`, `--c-in-hover` and kin, on the child. They reach direct children only. Anything deeper: restructure the markup. A pseudo-element becomes a real element | colour inherits: a child with no `--c` of its own already follows the parent's `--c-on`. Use `--c-in-on` when the child has its own colour |
| D. Motion | transitions and keyframes | `--tn:background var(--dur-1) var(--ease-out)`. Tokens `--ease-out`, `--ease-spring`, `--dur-1`, `--dur-2`, `--dur-3`. Entrance: `--anim:st-rise var(--dur-3) var(--ease-out) calc(var(--i, 0)*45ms) both`, keyframes `st-fade`, `st-rise`, `st-slide-in`, `st-pop`. The kit handles reduced motion. JS springs live in the behaviour script | write `--i` with a fallback: an unset `--i` voids the whole `--anim` shorthand, and nothing runs, silently. `--op` beats the opacity keyframe: do not set `--op` on a fading element. A keyframe the four do not cover is a gap |
| E. Primitives | gradient text, glow, blur behind, tints, mixed colours | `--text-grad:linear-gradient(135deg, var(--blue), var(--purple))` with `--c:transparent` (or `--c-in-on:transparent`). `--glow:6; --glow-c:var(--primary)`. `--bdf:blur(8px)`. `--tone:8; --tone-of:var(--green); --bg:var(--toned, var(--good-bg))`. `--mix:314; --bg:var(--mixed, var(--primary))`. Tokens `--primary-tint`, `--good-bg`, `--warn-bg`, `--bad-bg` | `--mix` is an integer of three digits, each 0 to 5 (red, green, blue). It has no in-between cells: `--mix:3.5` falls to 0. `--tone` is a number from 0 to 100. `--mixed`, `--toned` and `--tone-of` do not inherit: an element that reads `var(--toned)` or `var(--mixed)` needs its own `--tone` or `--mix`. Always write a fallback |
| F. Platform | `env()`, `dvh`, sticky, ellipsis, `max-width` media queries | values pass straight through: `--pl:max(16px, env(safe-area-inset-left, 0px))`, `--h:100dvh`, `--pos:sticky; --top:0`, `--line-clamp:1`. A `max-width` query is rewritten mobile first: the narrow values are the base, the wide values go on `-md` | never write a `max-width` query. Snap an odd draft breakpoint (719 or 720px) to a kit tier. A script that reads `matchMedia` uses the same px as the tier. `--maxw-sm` is off in the pinned 1.3.2 sheet and back from 1.4.0 |
| G. Geometry | a measured thing: an SVG path, an indicator whose left and width come from the DOM, spring physics | one behaviour script per component. It sets attributes and inline geometry (`el.style.setProperty("--left", x + "px")`, an SVG `d`) and nothing else. Never a stylesheet | hook on data attributes. The page works with the script off: every row stays a plain link. A script that animates checks `prefers-reduced-motion` itself: the kit's guard cannot stop a script |
| Tokens | the draft's palette and fonts | kit tokens and the colour recipes (step 3) | no hex in templates. Fonts are self-hosted. A new brand colour or face is a branding decision, not a page decision |
| Gap | fits no row | an upstream proposal (step 5) | general or it does not go up: two or more consumers, or a framework-level gap |

An element is on when any of these holds:

- `aria-current` is present and is not `false` or empty. `aria-current="page"` counts.
- `aria-selected="true"`, `aria-pressed="true"` or `aria-expanded="true"` is present.
- The `open` attribute is present, as on `details` or `dialog`.
- The element is `:checked`.
- `data-on` is present and is not `"false"`. An empty `data-on` counts as on, so `toggleAttribute("data-on")` works. A script may set `data-on="false"` or remove the attribute. Both mean off.

State suffixes:

- `-hover` means hovered inside `@media (hover:hover)` or keyboard focus (`:focus-visible`).
- `-focus` means keyboard focus. It never fires for `:focus-within`.
- `-active` means pressed.
- `-on` means the element is on.
- `-in-hover` means a direct parent is hovered or has keyboard focus.
- `-in-on` means a direct parent is on.

Checked in a real browser on 2026-10-16:

- `--d:flex` on the content of a closed `<details>` keeps it showing because `!important` beats the browser's hide rule.
- A prop beats a plain declaration for the same CSS property in one style attribute.
- A clicked text input matches `:focus-visible`, so its `--bg-hover` stays on after the mouse leaves. Use `--bg-focus` there.
- A wrapper holding a link does not show `--bg-hover` when the link has keyboard focus. There is no `:focus-within`. Make the link the card.
- Parent state reaches the child, not the grandchild.
- `setViewport(width, height, true)` turns touch on and `(hover:hover)` off. Test hover with touch off.

## The path

- `[WE]` means an agent session runs the step from the CLI.
- `[MANUALLY]` means a person does it: approvals, git writes, releases, publishing, third-party UIs.

### 0 Prepare [WE]

- Build the sheet and manifest into a scratch folder, never `dist/`. Use the build block in Commands.
- Run `bun install` once per clone.
- Lint against the manifest for the sheet the page will ship with.
- Build a manifest from a consumer's vendored sheet to see what it can use today. Use the manifest block in Commands.
- The Trellis vendored 1.x sheet has 160 props, no states and no `--anim`. That consumer cannot use `--bg-hover` until a release ships and it re-pins.

### 1 Capture [WE]

- Copy the draft as received into the consumer's `docs/` folder, one folder per page.
- Check that the copy holds fixture data only.
- Capture phone screenshots at 390px and desktop screenshots at 1280px through CDP device metrics.
- Avoid headless Chrome's plain `--screenshot` flag. It clamps layout to 500px and crops narrower requests. Use the screenshot snippet in Commands.
- Write a state sheet for each component. List the hover, focus, active, current, selected, open, disabled, empty and loading looks.
- Record what moves, how long it takes and what easing it uses.
- Record where the layout changes width.
- Note behaviour that is not CSS, including clicks, timers, observers and what must work with JS off.

### 2 Inventory [WE]

Fast path:

- Run `bun run ingest <file>`. Commands has the usage and the report shape.
- Read the summary first. Then read the rule lines, the flags and the lint findings.
- The tool reads a `.css` file whole. It reads any other input as HTML: the `<style>` blocks, the `<script type="text/plain">` code blocks whose `data-path` or `data-name` ends in `.css`, and every inline `style="..."`. It skips Jinja `{{ }}`, `{% %}` and `{# #}`.
- On HTML the count columns are `all`, `code` and `style`. `code` holds the code blocks the dev team would ship. `style` holds the demo's own `<style>` blocks, which are page chrome. Count the `code` column as the production rules. A `.css` input has `all` and `css`.
- Each rule gets its hardest bucket, ranked as in The buckets. A `:root` block of custom properties is listed under tokens and left out of the counts.
- Each rule line shows the bucket, the selector, `file:line` and a suggestion: the props to write, the suffix state, or what to restructure.
- Each flag shows `file:line` and a fix. The kinds are `max-width-media`, `off-origin`, `color-literal`, `font-literal`, `class-selector` and `important`.
- The lint kinds are `unknown`, `deprecated`, `collision`, `tier-state` and `plain`. A name that a `var()` reads, that the CSS defines or that a script sets counts as a page variable and passes. The tool does not report `--i`.

Fallback by hand, when the fast path does not fit:

- Make one table row per rule: source selector, declarations, bucket, prop or props, note.
- Look up each name with the lookup snippet. Lint the style attributes with the lint snippet. Find the flagged constructs with the flags grep. All three are in Commands.

Then:

- Count the rules per bucket. The counts go on the board in step 8.

### 3 Map tokens [WE], a new colour or face [MANUALLY]

- Write a small mapping table: the draft value, the kit token or recipe, how it is written.
- Work down this table. Take the first row that fits.

| The draft has | Write it as |
| --- | --- |
| A grey, ink or hairline | A token (`--text-main`, `--text-bright`, `--text-muted`, `--border`) or `--tone:N`. `--tone:N` mixes N percent of `--tone-of` (default `--text-main`) into `--background`. Low N is pale and high N is dark. It follows dark mode. |
| A pale tint of the brand or of a status colour | `--primary-tint`, `--good-bg`, `--warn-bg`, `--bad-bg`, or `--tone:8; --tone-of:var(--green)` |
| Any cell of the 6x6x6 colour cube | `--mix:RGB`, an integer of three digits, each 0 to 5 |
| A surface, an accent or a status colour | `--background` or `--background-alt`. `--primary` or `--secondary`. `--green`, `--orange` or `--red` |
| A typeface | `--font-sans` or `--font-mono`. On an element write `--ff:var(--font-mono)`. A new face needs a self-hosted file and a branding decision. |
| Nothing fits | A branding decision [MANUALLY]. Do not put a hex in a template. |

- Treat the `color-literal` and `font-literal` flags as pointers to a token or recipe.
- Keep fonts self-hosted. Never load a face from another origin. Map the draft's face to `--font-sans` or `--font-mono` first. A face the kit lacks goes to Alexander as a branding decision [MANUALLY].
- Set a button's hover colour once with `--button-hover`, on `:root` or on any ancestor. Every button below it takes that colour on hover. Unset, hover keeps the button's own background.
- Tokens flip with `[data-theme="dark"]`, so a page that uses tokens needs no dark-mode rules of its own. Dark mode keeps the published 1.x values.
- `--white` and `--black` flip in dark mode. For a white or black that never flips, use the base tokens `--color-7` and `--color-0`. Text on `--primary` wants `--color-7`.
- `--mixed` and `--toned` need `color-mix()` and `@property` (Safari 16.4, Firefox 128). `--mixed` also needs `round()` and `mod()` (Chrome 125). Where those are missing, the variable is invalid and the `var()` fallback applies.
- Always write a fallback: `var(--toned, #hex)`. Prefer a nearby token when it gives the same look, such as `var(--toned, var(--text-muted))`. Otherwise use the hex the formula gives. This fallback is the one place a literal hex may sit in a template.
- Give every element that reads `--toned` or `--mixed` its own `--tone` or `--mix`. The variables are registered with `inherits:false`. A browser without `@property` lets them inherit instead, so never rely on inheritance.
- Find tokens in `src/variables.css` (base 16 `--color-0` to `--color-15`, named colours, framework tokens, tints) and in the `tokens` list of `props.json`. Find the colour helpers in `src/helpers/_color.css`.

### 4 Decide each gap [WE], approvals [MANUALLY]

- Apply the hardest-need rank from The buckets to every rule that is not A, A-var or A′.
- Try these in order before you propose a prop:
  1. An existing prop or state.
  2. A server variant (A-var).
  3. A restructure: flatten the markup, make the link the card, turn a pseudo-element into an element.
  4. One behaviour script (G).
- Call a rule that still fits no row a gap.
- Send a gap upstream only if it is general: two or more consumers, or a framework-level gap. Keep a one-page quirk on the page.
- Write each decision on one line: rule, bucket, choice, reason.
- [MANUALLY] A change to the visual language (palette, face, gradient) is Alexander's call, not a page decision.

### 5 Upstream a prop when needed

- [MANUALLY] Alexander approves before anyone edits Startr/Style. The change goes in core, never in the published sheet. Add a card to `TODO.md` first.
- [WE] Make the change in core. It is one mixin line:
  - A tiered prop goes in the matching `src/utilities/_*.css`: `@mixin svar-mq <css-property>, --<name>;`.
  - A prop with no tiers uses `@mixin svar`.
  - A new prop that needs states gets one line in each state group of `src/utilities/_states.css`, plus an entry in the paint table in `scripts/bands.test.ts`.
  - A formula helper is a `[style*="--x:"]` rule in `src/helpers/_*.css`. `src/helpers/_effects.css` is the model.
  - A new keyframe goes in `src/helpers/_motion.css`. A new token goes in `src/variables.css`.
  - Import every new file from `src/builds/*.css`.
  - Give a helper its own fixture page in `test/fixtures/` and its own test, as `--anim` and `--mix` have.
- [WE] Example, not in the kit: a tiered `aspect-ratio` prop is one line, `@mixin svar-mq aspect-ratio, --ar;`, in `src/utilities/_layout.css`.
  - On a scratch copy on 2026-10-16 it cost +330 bytes minified and +75 bytes gzip.
  - It added six parity rules: the base rule and five tiers.
  - It passed every gate and needed no parity fragment.
- [WE] Pass the six gates:
  1. Build: `bun run build` succeeds.
  2. Parity: `bun run parity` prints `PARITY OK`.
  3. Manifest test: `props.json` and the sheet agree both ways, with no new collision and no warnings.
  4. Band test: every state rule keeps its band's specificity, shape and source order.
  5. Browser tests: states, motion, colour and button-hover, in headless Chrome.
  6. Size budget: the gzip size the build prints.
- [WE] Parity details:
  - A purely additive rule needs no entry. That means a new rule whose selectors all end in a `[style*="--x:"]` attribute selector, a new `@keyframes` or `@property`, or a new `:root` custom property.
  - A change to an existing rule of the published sheet needs an entry in `parity-allow.d/<stream>.json`. Keep one fragment per stream.
  - An entry is `{ "kind": "missing" | "extra" | "changed" | "order", "selector": regex, "media": regex (optional), "prop": regex (optional), "value": regex (optional), "reason": text }`. The reason is required.
  - A new declaration on an existing selector is kind `extra`, not `changed`.
  - Exit codes: 0 clean, 1 an unallowed difference, 2 a setup error.
- [WE] Size details:
  - The build prints `startr.css: <raw>KB → <min>KB min → <gz>KB gz`.
  - Build before and after into two scratch folders. Put the gzip delta in the proposal.
  - The 1.x plan set the budget: states at most 0.7 KB gzip, colour helpers at most 0.3 KB, the whole 1.x extension at most 2 KB. No automated size gate exists yet.
- [MANUALLY] A versioned release ships it. While Startr/Style's Makefile sets `HOLD_MIN`, the rolling `/style.min.css` keeps that version's bytes and the current min ships as `/startr.css`; `make core_publish` and `make version_snapshot` both follow it.
- [MANUALLY] A person snapshots the sheet under an immutable version path with `scripts/snapshot-version.sh` in Startr/Style, then commits, tags and deploys.
- Until the release ships, a consumer can bridge a simple prop with the plain CSS property in the same style attribute, such as `aspect-ratio:16/9`. Swap it for the prop after the release.
- Hover, focus, motion and parent state have no bridge. That component waits for the release.

### 6 Re-cut [WE]

- Replace classes and stylesheet rules with inline props, one component at a time and mobile first.
- Move variant logic into a template macro (A-var).
- Flatten parent state deeper than a direct child.
- Turn pseudo-elements into elements.
- Write one behaviour script per component and hook it on data attributes.
- Keep the page working with the script off.
- Make a script that reads `matchMedia` use the same width as its tier, such as 768px for `-md`.
- Delete the draft's `<style>` blocks, font links and class names as each component lands.
- Use these examples for states, motion, variants, geometry and responsive behaviour.

A row uses hover, current, keyboard focus and an animated change. Current wins over hover:
```html
<a href="/crm/leads/" aria-current="page"
   style="--d:flex; --ai:center; --g:.5rem; --p:.5rem .75rem; --radius:.5rem;
          --bg-hover:var(--primary-tint); --bg-on:var(--primary); --c-on:var(--color-7);
          --oe-focus:2px solid var(--primary); --oo:2px;
          --tn:background var(--dur-1) var(--ease-out)">Leads</a>
```
Checked: with `aria-current="page"` the background is `--primary`, the text is white, and hover changes nothing. Without `aria-current`, hover gives `--primary-tint`. Keyboard focus draws a 2px primary outline.

Parent state drives gradient text. The label is muted at rest and gradient when its parent is current. The icon follows its parent's colour through `currentColor`:
```html
<a href="/crm/tasks/" aria-current="page"
   style="--d:flex; --fd:column; --ai:center; --g:.25rem; --c:var(--text-muted); --c-on:var(--primary)">
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>
  <span style="--size:.72rem; --weight:600; --c:var(--text-muted); --c-in-on:transparent;
               --text-grad:linear-gradient(135deg, var(--blue), var(--purple))">Tasks</span>
</a>
```

A staggered entrance uses `--i` as the author's index, with a fallback of 0:
```html
<li style="--i:2; --anim:st-rise var(--dur-3) var(--ease-out) calc(var(--i, 0)*45ms) both">
```
Checked: `--i:2` gives a 0.09s delay. Without `--i`, the fallback gives 0s. Without the fallback, `calc(var(--i)*45ms)` makes the animation name `none`.

A Jinja variant macro renders `done` as green, `blocked` as red and any other state as the primary pair:
```jinja
{% macro chip(state) -%}
{% set tone = {"done": "--c:var(--green); --bg:var(--good-bg)", "blocked": "--c:var(--red); --bg:var(--bad-bg)"} -%}
--size:.74rem; --p:2px 8px; --radius:999px; --ws:nowrap; {{ tone.get(state, "--c:var(--primary); --bg:var(--primary-tint)") }}
{%- endmacro %}

<span data-st="{{ task.state }}" style="{{ chip(task.state) }}">{{ task.state }}</span>
```

A pane slides in on a phone and always shows from `-md`. Its parent split holds `data-on` while detail is open on a narrow screen:
```html
<section data-split-pane
         style="--t:translateX(100%); --t-md:none; --t-in-on:none; --tn:transform var(--dur-2) var(--ease-out)">
```
Checked at 390px: the pane sits one width to the right. With `data-on` on its parent it is `none`. At 900px it is `none` with or without `data-on`.

The split behaviour script toggles `data-on` and nothing else:
```js
// split.js: one script for the split view.
const split = document.querySelector("[data-split]");
const wide = matchMedia("(min-width: 768px)"); // the same width as the -md tier
const open = (on) => split.toggleAttribute("data-on", on && !wide.matches);
split.addEventListener("click", (e) => { if (e.target.closest("[data-split-row]")) open(true); });
wide.addEventListener("change", () => open(false));
```
Checked: a click on a row sets `data-on` at 390px and does not at 900px. Widening the window clears it.

Rewrite a `max-width` query from desktop first to mobile first. The draft rule:
```css
.pane { transform: none; }
@media (max-width: 719px) { .pane { transform: translateX(100%); } }
```
becomes `--t:translateX(100%); --t-md:none`. The 719px breakpoint snaps to 768px. Use 768px for the script's `matchMedia` too.

### 7 Verify [WE]

- Build core into a scratch folder.
- Run `bun run ingest` on the re-cut page or lint its inline props against `props.json`. The lint findings should be empty.
- As of 2026-10-16 the ingest lint does not flag a hex inside a `style` attribute. Run the flags grep from Commands on the re-cut page too. The only hex it should find is a fallback in `var(--toned, #hex)` or `var(--mixed, #hex)`. It should find no `class="` and no absolute URL.
- Run the consumer's gates from its `AGENTS.md`.
- Run Trellis's `make kit_check`. It checks that the pins match and that the vendored kit has no `@import` and no off-origin `url()`. A props lint inside it is planned.
- Compare the re-cut page with the draft screenshots at phone and desktop widths through CDP device metrics.
- Turn touch off for hover checks.
- Check hover and keyboard focus with Tab.
- Check a current item that is hovered and focused.
- Check a parent that is on.
- Check reduced motion by emulating `prefers-reduced-motion: reduce`.
- Check the page with JS off in a real browser.
- Use `test/fixtures/states.html`, `motion.html` and `color.html` as models.
- Use `scripts/cdp.ts` as the harness. It has `launch`, `newPage`, `setViewport`, `forcePseudoState`, `press`, `hover`, `click`, `style`, `eval` and `send`.
- Startr/Style runs axe accessibility audits on its own pages.

### 8 Record on the board

- [WE] Add a card to the consumer's `TODO.md` with one short claim line, about 350 characters at most.
- [WE] Add a sub-checklist to the card.
- [WE] Put bucket counts, decisions and proposals in the sub-checklist or a file under the consumer's `docs/` linked from the card.
- [WE] Give an upstream proposal its own card. Record the approval, gzip delta and release it waits on.
- [MANUALLY] Commit, push and release. Agents never run git writes.

## Naming and precedence rules for new props

Naming:

- Name a new prop `--` plus a short lowercase name. Use the initials of its CSS property (`--bg`, `--bgc`, `--oo`, `--bdf`) or a short helper word (`--anim`, `--glow`, `--text-grad`, `--mix`, `--tone`).
- Give one CSS property to one name. A helper may set several from one value.
- Never reuse a name another prop owns. The manifest test fails on a new collision.
- Five known collisions wait for 2.0: `--br` (border-radius and border-right), `--bs` (border-style and box-shadow), `--cr` (clear and column-rule), `--fs` (flex-shrink and font-style), and `--td` (text-decoration and transition-delay).
- Use `@mixin svar-mq` for tiered props. They get `-sm`, `-md`, `-lg`, `-xl` and `-pt`.
- Use `@mixin svar` for props with no tiers.
- Use whole-word states. Only paint props get states: bg, bgc, c, b, bc, boxs, op, t and oe.
- Do not add weight state, which reflows, or text-decoration state, which collides, until 2.0.
- Get Alexander's approval for a new state word because it changes grammar. Edit `src/mixins.css`, `src/utilities/_states.css`, the `STATES` list in `scripts/manifest.ts` and the band tests.
- To give another prop states, add it to each state group in `src/utilities/_states.css` and to the paint table in `scripts/bands.test.ts`. Ask first whether the server can render the state as a variant (A-var).
- Never combine a tier and state in one name. `--bg-hover-md` does not exist, and the manifest warns `combo-name`. A state applies at every width.
- Treat old `--hvr-*` and `*-hvr` names as deprecated aliases. `props.json` names each replacement. New code never uses them.
- Start keyframes with `st-`. Use `--ease-*` for easing, `--dur-*` for duration and `--font-*` for font tokens.
- Treat helper inputs (`--tone-of`, `--glow-c`) and author's own variables (`--i`) as non-props. The manifest lists helper inputs under `reads`.
- Make a formula a helper, not a pass-through prop. Give it a fixture page and test.
- Register numeric helper inputs (`--mix`, `--tone`) with `@property` and `inherits:false`. Bad input then shows a devtools warning instead of failing silently.

Precedence:

- Every kit prop rule is `!important`. Specificity decides first, then source order.
- Use this ladder: base < tier < in-hover < hover < in-on < on < focus < active.
- Band A has specificity (0,1,0). It holds the base rule, then its tiers.
- Band B has specificity (0,2,0). It holds in-hover, then hover. Hover rules sit inside `@media (hover:hover)`. Their `:focus-visible` copies sit outside, so keyboard users get hover looks by default.
- Band C has specificity (0,3,0). It holds in-on, on, focus and active.
- A state beats a tier.
- A current item ignores hover.
- Focus always shows (WCAG 2.4.7).
- Keep each focus copy a separate rule. One unknown pseudo-class drops a whole selector list.
- Read `src/mixins.css` for the bands. `src/utilities/_states.css` emits rules by state in ladder order. `scripts/bands.test.ts` keeps them in place.
- Helpers such as `--levitate`, `--shadow` and `--glow` are not `!important`. Hover helpers and `--boxs-hover` can take over. Decide per helper.
- A prop beats a plain declaration for the same CSS property in one style attribute.

## Anti-patterns

- Adding a per-component stylesheet "just this once", or a `<style>` block in a template.
- Using classes for look or state, or toggling classes from a script. Hook on data attributes.
- Using `--br`. Use `--radius`. The same family (`--bs`, `--td`, `--fs`, `--cr`) feeds two properties each. Write the plain CSS property in the style attribute instead of the prop, never both.
- Writing desktop first: `max-width` queries, or a suffix that repeats the base value.
- Putting a hex in a template, or loading a font, script or image from another origin.
- Guessing a prop name. An unknown name is a silent no-op: `--opacity`, `--ov-x` and `--list-style` do nothing. Lint every page.
- Using `--x-hover` as the only affordance. Touch devices never see it. Put what matters on on, focus or active.
- Putting `--x-hover` on a text input. It stays on while typing. Use `--x-focus`.
- Putting `--x-hover` on a wrapper that holds a link. Make the link the card.
- Aiming parent state at a grandchild, or keeping a pseudo-element. Restructure instead.
- Reading `--toned` or `--mixed` in a child that holds no `--tone` or `--mix` of its own. Skipping the fallback. Writing `--mix:3.5`.
- Writing `--anim` with `--i` unset and no fallback. Setting `--op` on an element that fades with `--anim`.
- Setting `--d:` on the content of a `<details>`. `!important` keeps it showing when closed.
- Adding a weight state. Render weight on the server.
- Writing colours from a script, toggling classes, or animating without checking reduced motion.
- Choosing a new brand colour or face on a page.
- Editing Startr/Style, the published sheet or `dist/` without approval.
- Redesigning during ingest, filing a rule under its easiest need, or proposing a prop for a one-page quirk.

Footguns:

- `--br` also sets border-right. Workaround: use `--radius`. Fix: a 2.0 rename is on core's `TODO.md`.
- `--bs`, `--td`, `--fs` and `--cr` each feed two properties. Workaround: write the plain CSS property in the style attribute. Fix: 2.0 renames with a migration table.
- Hover-only states miss touch devices. Workaround: put essentials on on, focus or active. Fix: none, by design.
- Silent typos do nothing. Workaround: lint against `props.json`. Fix: the manifest ships with the sheet. Consumer gate lint is planned.
- An unversioned CDN sheet is a risk. Workaround: vendor the sheet with a checksum pin. Fix: versioned URLs from `scripts/snapshot-version.sh` in Startr/Style.
- Old browsers may lack `color-mix()` and `@property`. Workaround: always write a fallback. Fix: none, by design.
- `--text-grad` with a `--bg-*` state loses the gradient: `background` is a shorthand, so on hover or on it resets the image and `background-clip`, and with `--c:transparent` the text disappears. Workaround: on an element with `--text-grad`, use `--bgc-*` states, which set only the colour. Fix: a lint, on core's `TODO.md`.
- The effect helpers' hover twins (`--shadow-hover`, `--levitate-hover`, the `--translate-hover` family) are not `!important`, so a `--boxs` or `--t` on the same element wins and the hover never shows. Workaround: do not mix the two families on one element. Fix: a lint, on core's `TODO.md`.
- `--x-in-on` never fires under `:checked`: inputs have no children. Workaround: put `--x-on` on the input itself, or make the state an attribute on a parent (`data-on`).
- `--gutter-sm` to `--gutter-xl` are never defined, so the `.wrapper` tier gutters do nothing. Workaround: set the padding with `--px` and its tiers. Fix: on core's `TODO.md`.

## Commands cheat-sheet

Run these commands from the core repo root. Commands were checked on 2026-10-16. Use output shapes, not fixed numbers.

Build into a scratch folder:
```bash
export STARTR_DIST=$(mktemp -d)
bun run build
ls "$STARTR_DIST/props.json"
```

- The build prints `props.json: <n> props (<h> helpers), <t> tokens`, then `startr.css: <raw>KB → <min>KB min → <gz>KB gz`, then `Build complete!`.
- It builds four sheets: startr, startr-base, startr-helpers and startr-utilities. Only `startr` gets a `props.json`.
- The first line of `startr.css` and `startr-base.css` is the font banner `@import url('/fonts/Nunito-Sans.css');`. Keep it byte-identical. Consumers that vendor the sheet find the font faces through it, as Trellis does in `scripts/vendor_kit.py`.

Print only the size line:
```bash
STARTR_DIST=$(mktemp -d) bun run build | grep '^startr.css:'
```

Build a manifest for any sheet, such as a consumer's vendored sheet:
```bash
bun scripts/manifest.ts <sheet.css> <out.json>
```
With no second argument, it prints to stdout. For the same sheet, its output equals the build's `props.json`.

Look up names. `null` means no such name:
```bash
PROPS="$STARTR_DIST/props.json" bun -e '
import { resolveName } from "./scripts/manifest.ts";
const m = await Bun.file(process.env.PROPS!).json();
for (const name of Bun.argv.slice(1)) console.log(name.padEnd(14), JSON.stringify(resolveName(m, name)));
' -- --bg-hover --oe-focus --c-in-on --opacity
```
Output: `--bg-hover {"base":"--bg","state":"hover"}`, `--oe-focus {"base":"--oe","state":"focus"}`, `--c-in-on {"base":"--c","state":"in-on"}`, `--opacity null`.

Lint style attributes by hand:
```bash
PROPS="$STARTR_DIST/props.json" bun -e '
import { resolveName } from "./scripts/manifest.ts";
const m = await Bun.file(process.env.PROPS!).json();
const reads = new Set(Object.values(m.props).flatMap((p: any) => p.reads ?? []));
const html = await Bun.file(Bun.argv[1]).text();
const seen = new Set<string>();
for (const [, style] of html.matchAll(/style="([^"]*)"/g))
  for (const [, name] of style.matchAll(/(--[\w-]+)\s*:/g)) seen.add(name);
for (const name of [...seen].sort()) {
  const hit = resolveName(m, name);
  if (!hit && !reads.has(name)) console.log("unknown:", name);
  else if (hit && m.props[hit.base].deprecated) console.log("deprecated:", name, "->", m.props[hit.base].deprecated);
  else if (hit && m.props[hit.base].collision) console.log("collision:", name, m.props[hit.base].collision.join(" / "));
}
' -- page.html
```

- On a test file holding `--opacity`, `--ov-x`, `--list-style`, `--hvr-bg` and `--i`, it prints `deprecated: --hvr-bg -> --bg-hover` and `unknown:` for `--i`, `--list-style`, `--opacity` and `--ov-x`.
- `--i` is the author's own variable, so `unknown: --i` is expected.
- Helper inputs (`--tone-of`, `--glow-c`) are not reported.
- The snippet reads double-quoted `style="..."` attributes only.

Find flagged constructs by hand. Expect false hits, such as an id like `#add`:
```bash
grep -nE '@media[^{]*max-width|https?://|#[0-9a-fA-F]{3,8}\b|class="' page.html
```

Capture a screenshot and computed style at phone width:
```bash
PAGE=file:///abs/path/page.html WIDTH=390 OUT=shot.png bun -e '
import { launch } from "./scripts/cdp.ts";
const chrome = await launch();
const page = await chrome.newPage(process.env.PAGE!);
await page.setViewport(Number(process.env.WIDTH ?? 390), 844);
console.log(await page.style("#row", "background-color"));
const shot = await page.send("Page.captureScreenshot", { format: "png" });
await Bun.write(process.env.OUT!, Buffer.from(shot.data, "base64"));
await chrome.close();
'
```
It prints the computed colour of `#row` and writes a PNG exactly `WIDTH` wide. `setViewport(width, height, touch)` takes a third argument. `true` turns touch on and hover off. Chrome is found through `CHROME_BIN` or the usual install paths.

Check parity against the default published sheet, `test/fixtures/published-1.3.2.css`, a byte copy of the sheet startr.style served on 2026-10-16:

- `bun run parity` builds core into a temp dir, diffs against the published sheet, prints a summary by kind and fragment, then `PARITY OK` and exit 0.
- `bun run parity --json` prints the same as JSON.
- `bun run parity --all` lists every item, including allowed ones.
- `bun run parity --max N` sets lines shown per kind. Default is 60.
- `bun run parity --c <built startr.css>` skips the build and uses a built sheet.
- `bun run parity --p <file>` compares against another published sheet. Or set `PARITY_P`.
- `--keep` keeps the temp build dir. `--allow-dir DIR` reads fragments from another folder.

Run tests:

- `bun test scripts` runs every suite: bands, button-hover, color, ingest, manifest, motion, parity and states. On 2026-10-16 it reported 670 pass, 1 skip, 0 fail, 671 tests in 8 files, about 31 seconds. The skip is a placeholder skipped when Chrome is present.
- Run one suite with `bun test scripts/bands.test.ts`. Likewise use `ingest`, `manifest`, `parity`, `states`, `motion`, `color` or `button-hover`.
- Browser suites (states, motion, color, button-hover) skip with a warning when Chrome is absent. `CHROME_BIN` points at a browser, but `color.test.ts` reads `CHROME`.
- `STARTR_REQUIRE_CHROME=1` makes the motion suite fail instead of skip.
- `MANIFEST_DIST=<dir>` makes the manifest suite read a built sheet and skip the build.
- `MANIFEST_STRICT=1` fails when a deprecated name's replacement is missing.
- Every suite builds into its own temp dir. None writes `dist/`.

The ingest tool is the fast path for the inventory step. `package.json` maps `bun run ingest` to `scripts/ingest.ts`:

```bash
bun run ingest <file.html|file.css>
bun run ingest <file.html|file.css> --manifest "$STARTR_DIST/props.json"
bun run ingest <file.html|file.css> --json
bun run ingest --help
```

- The first form builds core into a temp dir and reads its `props.json`. The report's `kit` line then says `built from this checkout`.
- `--manifest <props.json>` uses that manifest and skips the build. The manifest can come from any sheet.
- `--json` prints the same report as one JSON object on stdout. Its keys are `version`, `input`, `kit`, `summary`, `rules`, `tokens`, `flags`, `lint` and `warnings`.
- `--help` prints the tool's header comment. It documents the buckets, the flags and the lint kinds.
- Exit 0 means the tool produced the report. Exit 2 means a setup error: bad arguments, a missing file or manifest, CSS that does not parse, or a failed build.
- The report opens with a `kit` line (props and tokens counted) and an `input` line (what the tool read: `<style>` blocks, CSS, template blocks, scripts).
- Then come `RULES` with counts by bucket, `FLAGS` counts and `LINT (inline props)` counts.
- Then come one line per rule (bucket, selector, `file:line`, suggestion), each flag (kind, `file:line`, detail, fix) and each lint finding.
- On an HTML input the count columns are `all`, `code` and `style`. On a `.css` input they are `all` and `css`.
- Run on the three Trellis drafts on 2026-10-16, it exited 0 and counted 194 rules in the `code` column.

Check the consumer gate. Run this in the Trellis repo:

```bash
make kit_check
```

It prints `ok  pin`, `ok  no-import` and `ok  no-egress` lines for the vendored kit. It exits non-zero on a failure.

## The worked example in brief: the 2026-10 CRM drafts

- The input was three standalone drafts in the Trellis CRM repo at `crm/docs/design-drafts/`: navigation, leads and tasks. A `HANDOFF.md` sat beside them.
- Each draft was one HTML file with its own `<style>` blocks, Google Fonts links, hex colours and classes.
- Each also carried code panels with templates, CSS (`split.css`, `tasks.css`) and JS (`split.js`). Those were what the dev team would ship. The navigation panel covered desktop only.
- The draft asked for one stylesheet and one script per component beside the vendored kit. At that time the kit had hover props (`--hvr-bg` and kin), but they never beat a base prop, because base rules were `!important` and hover rules were not. Keyboard focus, keyframes, parent state and the mobile slide had no props at all.
- The production rules are the rules in the code panels. There were 194 across the drafts. The demo `<style>` blocks added 437 more rules of page chrome, which the runbook ignores.
  - The hand survey of 2026-10-16 found 91 rules that use existing props (A), 16 server-rendered variants (`data-st`, `data-pdot`) that Jinja can write as inline props (A-var), and 7 SVG attributes or markup (A′). That is 114 of 194. The other 80 needed new words or a restructure.
  - `bun run ingest` on the same drafts (2026-10-16), `code` column: A 109, A-var 14, A′ 6, B 14, C 19, D 14, E 7, F 8, G 3. That is 194 again.
  - The two splits differ. The tool applies one fixed order to every rule, so a rerun gives the same counts each time. Use the tool's counts when you rerun.
- The gaps exposed keyboard focus, ARIA and open state, parent state, an animation prop, reduced motion, gradient text, backdrop blur and font tokens.
- Core grew to cover them with state suffixes, `--anim` and `st-fade`, `st-rise`, `st-slide-in` and `st-pop`, the reduced-motion guard, `--text-grad`, `--bdf`, `--glow`, tint tokens, `--mix`, `--tone`, `--font-sans`, `--font-mono`, a valid `--ttf`, `--oo`, and manifest and parity gates.
- The planned re-cut is not shipped yet. The drafts in the repo are its input. It maps them like this:
  - Rows become `--bg-hover` and `--bc-on`.
  - The pane slide becomes `--t:translateX(100%); --t-md:none; --t-in-on:none`.
  - Nav icons become `--c-in-on`.
  - The cascade becomes `--anim` plus `--i`.
  - `data-st` and `data-pdot` become Jinja prop-string macros, following AI-UI's `_workshop.html`.
  - `::before` separators become markup.
  - `max-width:719px` becomes the base plus `-md`. The 719px snaps to 768px.
  - The `ops/_row_actions.html` styling moves into that partial's own inline props.
  - `split.js` sets `data-on` only while the screen is narrow. It resyncs when the width crosses 768px. It replaces `data-open`, `data-swapping` and `data-show` with `data-on`.
- The remaining behaviour is `split.js`, `nav-dock.js` and `nav-tiers.js`. No component stylesheets remain.
- Two decisions stayed with a person: the drafts' gradient and typefaces (Sora and IBM Plex Mono) against "no third visual language", and the choice of navigation.
- The drafts pulled fonts from Google, which `make kit_check` forbids. Production self-hosts fonts or uses the kit's faces.
