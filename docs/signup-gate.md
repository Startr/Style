# signup-gate

Medium-style time-delayed membership gate. A free registration wall (not a
paywall) that appears at the bottom of articles after a configurable number
of days. The reader sees the lede + a couple of paragraphs, the rest fades
out, and the gate sits over the fade so signing up feels like "stepping
past" content that visibly continues behind it.

## What you get

- **`src/_includes/signup-gate.njk`** — the gate component (Nunjucks include
  with inline `<style>` + `<script>`).
- **`src/_includes/whats-included.njk`** — sibling value-prop panel rendered
  below the gate.
- **`src/_data/signup-gate.yaml`** — reference config template. Copy into
  your consumer site's `_data/` and override the brand-specific fields.

## Architecture (TL;DR)

```
              ┌─────────────────────────────────────────┐
              │  consumer eleventy site (sage.is, ...)  │
              │                                         │
   reader ──► │  /resources/some-article/               │
              │                                         │
              │  full article in HTML (crawlers happy)  │
              │  + signup-gate.njk include              │
              │  + JSON-LD with isAccessibleForFree     │
              │     when gateEligible=true              │
              │                                         │
              └───────────────────┬─────────────────────┘
                                  │ JS reveals gate on
                                  │ data-gate-eligible="true"
                                  │ AND no localStorage[storageKey] entry
                                  │
                                  ▼ POST {email, source}  (no credentials)
              ┌─────────────────────────────────────────┐
              │  PocketBase: pb_hooks/gate_unlock.pb.js │
              │                                         │
              │  upserts subscribers record,            │
              │  mints PocketBase-native JWT,           │
              │  returns { ok, token, email } in body   │
              │  (no Set-Cookie, no per-origin CORS)    │
              └─────────────────────────────────────────┘
                                  │
                                  ▼ on 200
                          JS writes localStorage[storageKey] =
                            { token, email, unlocked_at }
                          then location.reload()
```

The read path is **localStorage-only** — the consumer site never calls
PocketBase on page load. A PocketBase outage at read time never blocks
existing members. An outage at signup-write time returns 503 "try again in
a moment".

**Why localStorage instead of an HttpOnly cookie:** the gate runs on the
consumer-site origin while the membership backend runs on a different
origin (e.g. `sage.is` and `pb.sage.is`). A cookie flow needs per-origin
`Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`
+ `Domain=` on a registrable parent — that's a lot of edge-layer config to
get right under any host (Cloudflare, Netlify, self-host) and it forces
the backend onto the same registrable domain as every consumer. The
token-in-body flow works under any vendor with plain `*` CORS, scales to
unrelated consumer domains, and survives moving the backend. The cost is
that the token is XSS-readable. That's fine when the gate guards CONTENT —
an attacker with XSS already has page-content access. It's not fine for
payments or sensitive account actions; for those, run the unlock endpoint
behind a same-origin proxy and switch to HttpOnly cookies.

## Integration steps (Eleventy consumer)

### 1. Copy the files

```
# from your consumer site root
cp ~/Documents/Projects/GitHub/WEB-Startr.Style/src/_includes/signup-gate.njk    src/_includes/
cp ~/Documents/Projects/GitHub/WEB-Startr.Style/src/_includes/whats-included.njk src/_includes/
cp ~/Documents/Projects/GitHub/WEB-Startr.Style/src/_data/signup-gate.yaml       src/_data/
```

> **Naming note.** Eleventy 3 sometimes camelCases hyphenated data filenames
> and sometimes doesn't, depending on the project's convention. If
> `_data/signup-gate.yaml` doesn't resolve as `signupGate` in templates,
> rename to `_data/signup_gate.yaml` and access as `signup_gate`. The
> include uses `{%- set g = signup_gate %}` — match that.

### 2. Override the YAML

Edit `src/_data/signup-gate.yaml`. At minimum override:

- `brand` — your brand name as it appears in copy
- `unlockEndpoint` — your PocketBase URL (e.g. `https://pb.example.com/api/sage/gate-unlock`)
- `socialProof.audienceLabel` — honest member count
- `socialProof.testimonial` — real customer quote (or remove the block)
- `availableOn` — channel logos for podcasts/RSS/etc, or leave `[]`

### 3. Add `buildDate` to your Eleventy config

`src/eleventy.config.js`:

```js
eleventyConfig.addGlobalData("buildDate", () => new Date().toISOString());
```

Used by the cascade in step 4. Stable per build — refire via a daily
rebuild cron so threshold-crossing articles flip on time.

### 4. Add `gateEligible` to your article-data file

`src/resources/resources.11tydata.js` (or equivalent for your article
collection):

```js
function resolveThreshold(data, gate) {
  if (data.gateAfterDays !== undefined && data.gateAfterDays !== null) {
    return data.gateAfterDays;
  }
  const url = (data.page && data.page.url) || "";
  const bySection = gate && gate.thresholdsBySection;
  if (bySection && url) {
    let match = null, matchLen = -1;
    for (const prefix in bySection) {
      if (url.indexOf(prefix) === 0 && prefix.length > matchLen) {
        match = bySection[prefix];
        matchLen = prefix.length;
      }
    }
    if (match !== null) return match;
  }
  const byType = gate && gate.thresholdsByContentType;
  const ct = data.contentType || "blog";
  if (byType && Object.prototype.hasOwnProperty.call(byType, ct)) {
    return byType[ct];
  }
  return (gate && gate.defaultThresholdDays) || 60;
}

function isGateEligible(threshold, articleDate, buildDateIso) {
  if (threshold === "never" || threshold === false ||
      threshold === null || threshold === undefined) return false;
  if (threshold === 0) return true;
  const days = Number(threshold);
  if (!Number.isFinite(days) || days < 0) return false;
  if (!articleDate) return false;
  const build = buildDateIso ? new Date(buildDateIso) : new Date();
  const age = (build - new Date(articleDate)) / (1000 * 60 * 60 * 24);
  return age >= days;
}

module.exports = {
  // ... your existing layout / tags / permalink ...
  eleventyComputed: {
    // ... your existing computed fields ...
    contentType: (data) => data.contentType || "blog",
    gateEligible: (data) => {
      const threshold = resolveThreshold(data, data.signup_gate);
      return isGateEligible(threshold, data.date, data.buildDate);
    }
  }
};
```

### 5. Wrap article body + include the gate

In your article template (e.g. `_includes/resource.njk`), wrap the content
in a `.gated-content` div and include the gate after it:

```njk
<div class="article-body gated-content">
  {{ content | safe }}
  {% include "signup-gate.njk" %}
</div>
{% include "whats-included.njk" %}
```

The `.gated-content` class is the SEO/JS hook. The whats-included panel is
a sibling so it doesn't get trimmed by the JS reveal.

### 6. Upgrade article JSON-LD for SEO

In your `base.njk` `<head>`, when emitting `Article` (or `NewsArticle`)
JSON-LD, conditionally include the paywall markup per
[Google's spec](https://developers.google.com/search/docs/appearance/structured-data/paywalled-content):

```njk
{
  "@context": "https://schema.org",
  "@type": "{{ articleType or 'Article' }}",
  ...
  {%- if gateEligible %},
  "isAccessibleForFree": false,
  "hasPart": {
    "@type": "WebPageElement",
    "isAccessibleForFree": false,
    "cssSelector": ".gated-content"
  }
  {%- endif %}
}
```

Crawlers still see the full body in HTML — the markup tells them which
part is gated, so they don't penalize you.

### 7. Backend: PocketBase

The endpoint that mints the membership token is a custom hook. See
`WEB-DB-sage-pb/pb_hooks/gate_unlock.pb.js` and
`WEB-DB-sage-pb/pb_migrations/003_subscribers.js`. The hook returns the
token in the JSON body — no `Set-Cookie`, no per-origin CORS — so a single
PocketBase instance can serve any number of consumer domains.

CORS: PocketBase's default `Access-Control-Allow-Origin: *` is sufficient
because the gate's fetch does NOT use `credentials: 'include'`. You can
optionally narrow it with the `--origins` flag for defense-in-depth, but
the token flow does not depend on it:

```
pocketbase serve --origins=https://your-brand.com,https://www.your-brand.com
```

## Customizing the gate

### Theme it

The gate's outer `<aside>` carries the entire palette as inline custom
properties:

```
--c-ink:           darkest text (headings, primary actions, input text)
--c-text:          body text
--c-body:          medium body text
--c-muted:         secondary text, audience label
--c-fade:          fineprint
--c-cream:         gate background, submit button color
--c-cream-hover:   provider button hover
--c-white:         input + channel-row background
--c-border-light:  outer gate border
--c-border-medium: divider, input border
--c-gold:          rating stars
--c-error:         error message
```

Edit the values inline (one line each, all in the same place) and every
child element updates via CSS custom-prop inheritance.

### Tune the teaser

The JS keeps the first N paragraphs visible before fading. Default N=3.
Search `PARAGRAPHS_TO_TEASE` in `signup-gate.njk` to change it.

The fade is a CSS `mask-image: linear-gradient(...)` on the `<section>`
containing the last kept paragraph. The 50% in the gradient is what
controls fade aggressiveness — lower for a longer, more gradual fade.

The gate overlap is `--mb: -50%` set inline on that same section by JS.
-50% is relative to the section's containing-block width. Increase
(e.g. `-75%`) for more dramatic overlap, decrease (`-25%`) for less.

## Known issues

### `--fs` is NOT font-size

A startr.style footgun: `--fs` binds to `font-style` AND `flex-shrink`,
NOT font-size. Canonical is `--size`. The gate components use `--size`
correctly. If you copy patterns from these files, copy that — Tailwind
muscle memory will steer you wrong.

### Form-control color/bg/b workaround

`<input>` and `<button>` use UA system colors (`FieldText`, `ButtonText`)
that beat the framework's `--c` attribute binding. The gate's CSS uses
`color: var(--c) !important` to defeat them. If you build new form
controls in inline-prop style, expect to do the same.

### Brand "gradient text" effect

If your host site has a site-wide `h1-h5, button, strong { background-clip:
text; -webkit-text-fill-color: transparent; }` rule (common as a brand
marketing default), the gate's heading + submit button + the
whats-included headings/titles will render invisible. The gate's CSS opts
out via:

```css
background-image: none;
background-clip: border-box;
-webkit-text-fill-color: currentColor;
```

A `.text-flat` utility class is queued in this framework's TODO.

## Phase trajectory

- **Phase 1 (current):** email-only signup. PocketBase mints a JWT in the response body; the gate writes it to localStorage and reloads.
- **Phase 2:** OAuth providers (Google, GitHub, Apple, Facebook) via
  PocketBase's native OAuth2. Mautic mailing-list sync inside the hook.
  Existing-member sign-in surface.
- **Phase 3:** PocketBase's full auth (passwords + magic-link). Cross-
  domain SSO across consumer brand domains.
- **Phase 4:** Multi-locale consumer sites (per-locale gate copy via
  `_data/<locale>/signup-gate.yaml`).
- **Phase 5:** PDF lead-magnet flow — signed PocketBase file token.

## See also

- Original plan: `~/.claude/plans/a-growing-number-of-jiggly-cherny.md`
- Refined plan: `~/.claude/plans/are-you-able-to-twinkly-pike.md`
- Reference consumer integration: `WEB-Sage.is` (`src/_includes/signup-gate.njk`,
  `src/_includes/whats-included.njk`, `src/_data/signup_gate.yaml`,
  `src/_includes/resource.njk`, `src/resources/resources.11tydata.js`,
  `src/_includes/base.njk`, `src/eleventy.config.js`)
- Backend reference: `WEB-DB-sage-pb` (`pb_hooks/gate_unlock.pb.js`,
  `pb_migrations/003_subscribers.js`, `Dockerfile`)
