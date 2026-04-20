# Panel Review — Startr.Style

**Date:** 2026-04-20
**Subject:** Startr.Style (WEB-Startr.Style + subtree WEB-startr.style.core)
**Panellists:** Lea Verou · Heydon Pickering · Andy Bell · Jeremy Keith

---

## Panellist Matrices

### Lea Verou — CSS language designer, CSSWG invited expert

| Dimension | Detail |
|---|---|
| Voice | Precise, patient, mathematically minded; reaches for proofs and examples; dates her claims ("As of May 2024…") |
| Core belief | CSS custom properties are a programming substrate, not a storage system — `@property`, Relative Color Syntax and her Variable Groups proposal are the real design-system primitives |
| Signature phrase | "Of all the CSS features I have designed, RCS is among the ones I'm most proud of." |
| Admires | OKLCh, `color-mix()`, `@property`-registered variables, Houdini, principled DSLs |
| Despises | Unregistered custom properties that silently lose type info; design systems dressed up as CSS methodology |
| How they argue | Starts friendly, draws a whiteboard, then asks "so what happens when…" — the failure case is the argument |
| Live wire | Custom-property schemes that look elegant but skip `@property`, fallbacks, or invariants |

### Heydon Pickering — accessibility satirist, Inclusive Components / Webbed Briefs

| Dimension | Detail |
|---|---|
| Voice | Dry, deadpan, aphoristic, allergic to reverence; will end a point with a comma and a shrug |
| Core belief | The web is already a framework — "I write utility first CSS. The utility I'm referring to is the cascade" |
| Signature phrase | "…which is, if nothing else, a choice." |
| Admires | Semantic HTML, `<details>`, Fukol (his two-line grid "framework"), anything that degrades gracefully without JS |
| Despises | Accessibility overlays, class soup, ARIA-as-apology, design systems as career-stage theatre |
| How they argue | Reads your code out loud in a sarcastic register until the absurdity surfaces; then asks the obvious question you've been avoiding |
| Live wire | Markup where visual tokens have crowded out semantic meaning |

### Andy Bell — Piccalilli, CUBE CSS, Set Studio

| Dimension | Detail |
|---|---|
| Voice | Warm, methodological, unfashionably sincere about CSS itself; favours checklists and principles |
| Core belief | "Most of the work is already done for you with global and high-level styles" — set axioms, let composition do the work, ship as little CSS as possible |
| Signature phrase | "A utility is a class that does one job and does it well." |
| Admires | The cascade, progressive enhancement, Every Layout primitives, axioms like "the measure should never exceed 60ch" |
| Despises | Greenfield-only advice; framework-first recommendations that ignore that "most websites are WordPress, not React"; BEM-style drift |
| How they argue | Lays out the methodology first, then asks where your project fits in it — and why you skipped a layer |
| Live wire | Any claim of "simplicity" that shows up as 33,000 lines of hand-written tokens |

### Jeremy Keith (Adactio) — Clearleft, Resilient Web Design

| Dimension | Detail |
|---|---|
| Voice | Quiet, long-memoried, unshowy; often asks questions instead of making statements |
| Core belief | Progressive enhancement is an ethical posture, not a technique |
| Signature phrase | "What is the core experience, and what is the enhancement?" |
| Admires | `datalist`, HTML-first demos, the indieweb, browsers as the real platform |
| Despises | "Over-engineered single-page apps that ignore what browsers can do"; bleeding-edge features treated as the floor |
| How they argue | Listens, then asks a small, unassuming question that punctures the frame |
| Live wire | A project that assumes modern browser features without naming a fallback story |

---

## Interview

**Lea:** I want to start with something I genuinely admire. You've built a three-layer colour architecture on `color-mix()` in `oklch` — sixteen base colours, two hundred and sixteen mix cells, twenty-four greys. That's a real DSL. So my question is a kind question, but it's the one I always ask: are any of these custom properties registered with `@property`? Because if I change `--color-4` at runtime, I want to know what the browser does with the two hundred and fifty-five things downstream of it. Have you tested that?

**Heydon:** While you answer Lea, I'd also like you to read one line of your landing page out loud. This one — the `<header>`. `style="--pos: relative; --z: 1; --w-xl: calc(100vw + 1rem); --t-xl: translate(...)"`. You've told the world Startr.Style is a framework for people who hate class soup. So why is every element on your front page wearing a coat of it in the `style` attribute instead? Same soup, different bowl — which is, if nothing else, a choice.

**User:** Lea, they change last time I looked. We're not touching `@property`.

Heydon, the html element style attribute is where style belongs, not shoe horning styling into the class attribute the way Tailwind does, "size-48 shadow-xl rounded-md". You're free to make classes when you want. Startr.Style lets you build in one shot. It lets you quickly adjust elements styling in the inspector (all at the top not fighting classes), it gives you responsive styling while keeping things inline. It gives us power and locality of concerns.

**Lea:** "They change" — what changes? The spec, or the computed values? Because those are very different stories. Without registration, the browser treats `--color-4` as a string. Your whole `color-mix(in oklch, …)` cascade downstream is load-bearing on strings it can't validate. This is an elegant cube. I just want to know where the airbags are.

**Heydon:** "Locality of concerns." Your `style` attribute isn't style — it's `--w-xl`, `--t-xl`, `--d-sm`. Those aren't properties the browser understands. Those are instructions to your framework's media queries, defined somewhere I cannot see from the element. So the element is still reaching out to a global system I have to hold in my head. You've moved the lookup from a class name to a variable name. Where exactly is the locality?

**Andy:** I read your CONVENTION.instructions.md. You list DRY and KISS as zeroth principles. Good. Now — where are your design axioms? A single sentence that tells me, as a new contributor, when I should write `--mb: 2rem` versus `--mt: 1rem` versus a utility class. Every Layout has "the measure should never exceed 60ch." That's an axiom. Startr.Style has a vocabulary and a methodology for tickets, but I can't find the axioms that tell the vocabulary what to do.

**Jeremy:** And one small thing. `color-mix()` and `oklch()` are the floor of your colour system. Not the ceiling. The floor. Who is the user whose browser doesn't support them, and what do they see?

**User:** Heydon, go and open the inspector — you'll see that they are directly exposed and explained by the inspector itself. The code self explains. You didn't have to scroll up and down looking for what class was applying what. They translate and are self explaining. `--w` is width, `--t` is transform, `--d` is display, and `-xl` applies things to `@media (min-width: 1280px)`. This is better, faster, and lighter.

Andy, we could add that, though I'm not sure the home page is the place.

Jeremy, things elegantly fall back to defaults. This is 2026, we don't need to worry about Internet Explorer. That's a choice we've made and other teams can handle things how they want.

**Heydon:** The inspector is showing `--w: 100%`. It is not showing me that somewhere in `_sizing.css` you wrote `width: var(--w)`. That translation lives in your head. You've described every framework ever written — "it's self-explaining, once you know it." And "lighter" — sure. 8KB gzipped on the wire. But `variables.css` is 37KB of hand-written color-mix cells the engine resolves at every paint. Light in transit. I'll reserve judgment on light at render.

**Andy:** I wasn't asking about the home page. I was asking about the repo. Axioms are the guardrail. Where does a new contributor read, before they write their first `style=""`, the single sentence that tells them what this framework is for? Without it, every contributor invents their own convention. In two years this codebase looks like four frameworks stapled together. Will you write the axioms, or will Startr.Style?

**Jeremy:** "Elegantly fall back to defaults." Have you opened the site in an environment that doesn't support `color-mix(in oklch, …)`? Not hypothetically — literally. An older Kindle browser. The webview inside a locked-down Android work profile. DevTools with support forced off. Because elegant fallback is a property of the system. And I've been doing this long enough to know the difference between a property of the system and a property you've tested.

**Lea:** And for the record — `color-mix()` with an unparseable component doesn't degrade gracefully. It invalidates the whole declaration. So when the cascade fails somewhere in the middle of the 216 cube, you won't lose one shade. You'll lose a region.

**User:** Heydon, look in the inspector: I clearly see that `--w:` is set to 100% and I can filter styles and it immediately pulls up how `--w` works:

```css
[style*="--w:"] {
  width: var(--w) !important;
}
```

Andy, you're right we need to move beyond the "Why build with Startr Style" marketing paragraph on the home page.

Jeremy, yes we have and our defaults are acceptable — plus older Kindle browsers are now retired and Amazon is doing a buy back. No need to support decades-old stuff here. You're free to if you want.

Lea, yes `color-mix` doesn't degrade, but when you stack it the way we did, it degrades to other defaults.

**Heydon:** `[style*="--w:"] { width: var(--w) !important; }`. Two things. First — `!important`. Which means the moment any consumer wants to override `--w` on a single element, they have to `!important` it too. You've armed the first escalation in a specificity war with yourself. Second — `[style*="--w:"]` is an attribute-substring selector. The engine evaluates it against the `style` attribute of every element on every reflow. How does a page full of these profile against a page of equivalent utility classes? Have you measured, or have you asserted?

**Andy:** That paragraph is marketing copy. It tells the user what they get. I'm asking for the contributor file — the document a new developer reads before adding a new token. What kind of utility would Startr.Style reject? What behaviour is forbidden? Every living methodology has a list of don'ts. I want to see yours.

**Jeremy:** Kindle was the example. It wasn't the point. "Acceptable defaults" is a claim, not a measurement. And when you said "other teams can handle it how they want" — that's where I'd push, gently. You've chosen the defaults. Everyone who adopts your framework inherits them, forever, unless they engineer them back out. That's the moment a framework stops being a tool and becomes a position.

**Lea:** Open `variables.css` and walk me to the line where a `color-mix()` failure upstream resolves cleanly at the consumer. If the leaf is `background: var(--primary, #fff)` — sure, that degrades to white. If it's `background: var(--primary)` and `--primary` is itself a `color-mix()` — the declaration is IACVT and the element falls back to `inherit` or `initial`, not to your "default." Which of those is your pattern?

**User:** Heydon, yes, and that's the point — you change it where it is till you don't need to and have moved its styling to your own classes... if you really wanted to. We haven't profiled against a page of equivalent utility classes, but you can plan that out and add it to our TODOs. Our focus is on building fast light small pages — not on pages with tens of thousands of elements and playing with reflow. What we're fast at is dev and delivery to the user. 8kb and fast to build with.

Andy, like I said — put it as a TODO.

Jer, we are 8kb and fast to build with and looks great :D

Lea, the leaf should be `background: var(--primary, #fff)` — I think you're right, instead of inherit or initial. Let's mark that as a TODO.

**Heydon:** "Change it till you don't need to, and then move it to your own classes — if you really wanted to." That's an honest sentence. I'm writing it down. So the framework's story is: author inline with custom properties until it hurts, then reach for classes. Where's the threshold? When do you tell a consumer "stop, extract" — and is that advice anywhere in the docs?

**Andy:** I'm going to say something as a friend. You've said "put it as a TODO" three times in the last five minutes. I looked at TODO.md on the way in. There are panel-review items on there from earlier this month — the versioning ones, the focus-visible audit — still open. The pattern isn't in your answers today. It's in the file. A TODO is where ideas go to prove whether you mean them.

**Jeremy:** "Fast to build with." That's a developer-experience claim. "Fast for the user" is a different sentence, measured with a different instrument. What's your Largest Contentful Paint on a mid-tier Android over Slow 4G?

**Lea:** Your system isn't one pattern — it's two patterns mixed, and the mix depends on who wrote the utility on what day. When you put "IACVT fallback audit" on the TODO, make it an audit of every leaf, not a patch of the one I named. One pattern, enforced.

**User:** Heydon, TODO.md it. Andy, yes, we live by our TODO.md — it directly powers our KANBAN. Jeremy, we beat Tailwind by 17%. You—

**Heydon:** You TODO.md'd Andy's point that you TODO.md things. Which is, if nothing else, a choice.

**Andy:** If TODO.md powers the Kanban — good, that's a real flow. So tell me which column. Are those items in Backlog, In Progress, or Someday? A Kanban visualises movement.

**Lea:** I haven't got a reply from you either, but I'll wait. Just — audit the whole leaf surface, not one line.

**Jeremy:** Finish your sentence. You were going to tell me about Tailwind.

**User:** Backlog, as we're meeting now and not working. Lea, yes, add it to TODO.md. Jer, we're 17% faster to LCP. LCP 0.55s, CLS 0.05, INP 24ms — all good.

**Jeremy:** Those are genuine numbers. No argument. But — 17% against what? A hand-authored Tailwind page, or a production one with real content? And LCP of 0.55s with the LCP element being a `<p>` — is that on localhost, or on a throttled device over Fast 3G?

**Lea:** LCP on `<p>` means the largest contentful element is text the browser renders before it has to resolve most of your colour cube. Measure LCP on a page that exercises the cube — the theme creator, a gallery. Same test. Different victim.

**Heydon:** LCP, CLS, INP measure the car. They don't measure the steering wheel. Have you watched a stranger use this — somebody who isn't you — with a keyboard only?

**Andy:** Show me one ticket that moved from Backlog to Done in the last seven days. If I see movement, I retract the concern.

**User:** Jeremy, it's quick eye-balling — you're free to draft up a plan for full evaluation. We're hitting 17% comparing our site's pages to theirs, not a custom test harness. Over a real network. Heydon, yes, and there were no issues. Andy, it hasn't — we haven't been focusing on this project this week.

**Jeremy:** Eye-balling is a feeling. 17% is a number. Three bullets of rigour: three comparable real pages per site; throttled Android, Slow 4G, cold cache, five runs, median; publish the harness and raw numbers. Until then, "17%" is a vibe.

**Heydon:** Line 38 of your own TODO.md. "Audit `-hvr` coverage for `:focus` and `:focus-visible`..." Surfaced by Adam Wathan, 2026-04-18. You just told me "no issues." Your own TODO says there are. Both can't be true.

**Andy:** Do your primary projects — the ones you're focusing on — have that Backlog-to-Done flow? If yes, I believe you. Startr.Style being parked is a resource choice. If no, the pattern isn't specific to this repo.

**Lea:** A language without a compiler is a convention. Your framework is a language. Something has to enforce that new tokens follow the naming pattern. That works for a team of one. It breaks at two.

**User:** We're getting into things now, not then.

**Andy:** Fair push. We've been drafting futures. Let me stay in the present.

**Heydon:** *(reads `_includes/`)* `footer.njk`, `head.njk`, `layout.njk`, `layout.sync-conflict-20251127-153148-EJ43XZB.njk`, `layout_2.njk`. I'm not asking what the sync-conflict file is *supposed* to be. I'm asking what it is, in your repo, right now.

**Lea:** And — while we're in the present — your `README.md` opens with "1.3.1." Your `package.json` says `1.2.2.2`. Two files, same repo, different answer. Which do I trust?

**User:** Let's add these to the TODOs and wrap for now.

---

## Debrief

### The nicks

1. **No `@property` registration on custom properties** *(Lea)* — the colour cube's invariants are strings, not types; `color-mix()` failures IACVT whole declarations.
2. **`!important` + `[style*="--X:"]` forces specificity escalation** *(Heydon)* — every consumer override has to `!important` in turn; attribute-substring selectors also carry unmeasured reflow cost.
3. **No contributor axioms file** *(Andy)* — `CONVENTION.instructions.md` is a workflow doc, not a design-rule doc. Nothing tells a new contributor what the framework refuses to do.
4. **Fallback behaviour is mixed, not systematic** *(Lea)* — some leaves use `var(--primary, #fff)`; some are bare.
5. **"17% faster" is eye-balling, not measurement** *(Jeremy)* — no harness, no throttle, no published methodology.
6. **LCP measurement doesn't stress the cube** *(Lea)* — LCP on `<p>` means the 216 mixes aren't in the critical path.
7. **Accessibility claim contradicts the project's own TODO** *(Heydon)* — "no issues" asserted; `:focus-visible` audit from 2026-04-18 still open.
8. **Panel items stacking in Backlog** *(Andy)* — Zach's and Adam's items still unmoved two days on.
9. **Syncthing conflict file committed to `src/_includes/`** *(Heydon)* — `layout.sync-conflict-20251127-153148-EJ43XZB.njk` is sitting in the source tree.
10. **Version drift** *(Lea)* — README says `1.3.1`; `package.json` says `1.2.2.2`.

### The tensions

1. **"Simple framework" vs. 37KB of hand-written `color-mix` cells.** Simple to use; not simple.
2. **"No extra classes" vs. the landing page using `class="white"`, `class="slider"`, `class="markdown"`.** Anti-class rhetoric is selective in practice.
3. **"Locality of concerns" vs. every `--X-xl` variable reaching out to a media query the element can't see.** The locality is cosmetic.
4. **"Fast to build with" as headline vs. no user-facing perf harness.** Developer-experience vocabulary doing the work of a user-experience benchmark.
5. **"We live by our TODO.md" vs. panel items sitting in Backlog for days.** The file is both source of truth and dumping ground.

### Open questions

1. When does the inline-custom-prop pattern stop being fast? *(Heydon)*
2. What does Startr.Style refuse to let a contributor do? *(Andy)*
3. Have you watched a stranger use this with a keyboard only? *(Heydon)*
4. What enforces token-naming consistency beyond one maintainer? *(Lea)*
5. What's the harness behind the 17%? *(Jeremy)*

### TODO items appended to `TODO.md`

- ♿ Accessibility — reconcile `:focus-visible` audit status with spoken claims *(Heydon)*
- 📦 Versioning & Rollback — resolve README vs `package.json` version drift *(Lea)*
- 🎨 Colour System Invariants *(new section)* — IACVT-safe fallback audit; `@property` registration *(Lea × 2)*
- 🏛️ Design System Governance *(new section)* — write the axioms file *(Andy)*
- 📊 Performance Methodology *(new section)* — real benchmarking harness; re-run LCP on cube-heavy pages *(Jeremy; Lea)*
- 🧹 Repo Hygiene *(new section)* — remove sync-conflict file; `.gitignore` the pattern *(Heydon)*
