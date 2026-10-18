# Board dossiers

Narration cut from TODO.md cards, kept verbatim. Each section names its card.

## `--br` collision (moved 2026-10-16)

The card as it stood before the 2026-10-16 register pass:

- [ ] **🔥 Resolve the `--br` shorthand collision** — `src/utilities/_border.css` binds `--br` to both `border-radius` (line 6) and `border-right` (line 10). Because `border-right` is a shorthand and its rule lands after `border: var(--b)` in the built sheet, any element using `--b` + `--br` loses its right border (`border-right-style` resets to `none`). Confirmed live on build.sage.education cards; consumer worked around it by swapping to the `--radius` alias (2026-08-26). Second consumer hit 2026-09-18 — WEB-Sage.is `/plans/sage-ai-office-automation/` authored with `--radius` throughout after the audit; two consumers now route around the same binding. #bug #critical
  - [ ] Proposed fix (NOT settled — needs team review before shipping): drop the `border-right, --br` binding; keep `--br` = border-radius since every known consumer and doc uses it that way; give border-right a new name (`--b-rt`? `--bri`? mirror across `--bt/--bl/--bb` for a consistent side set?). Renaming is a breaking change for any consumer that used `--br` as border-right — audit first.
  - [ ] Same review should rule on the sibling dual bindings: `--bs` (border-style vs box-shadow), `--td` (text-decoration vs transition-delay), `--fs` (font-style vs flex-shrink), `--cr` (column-rule vs clear). Value-disjoint today, so they work by luck; each is one valid-in-both value away from a silent failure (`--bs:none` already collides). Consumers are already routing around the DSL: build.sage.education wrote plain `flex-shrink:0` instead of `--fs:0` on 2026-08-27 to dodge the `--fs` pair.
  - [ ] After the naming call: rebuild and redeploy `startr.style/style.css` — the live sheet carries the collision (border-radius line 823, border-right line 839).
  - [ ] Decide whether `WEB-Startr.Style/src/static/style.css` should be regenerated from core instead of hand-maintained. Evidence the two forked: `--fs` definition order is flipped between repos, and core has no print (`-pt`) tier while main carries ~120 `-pt` props.

## Register pass 2026-10-18

Lines as they stood before the split; line numbers are the old ones.

- L12: - [ ] **Publish 1.x from core: 1.4.0 is live (2026-10-16); the pinned /v*/ URLs wait on a Cloudflare rule** #release
- L24: - [ ] **`--text-muted` and `--text-bright` fail AA on white** (Lighthouse on Trellis, 2026-10-17): muted is black 40% (~#a8a8a8, 2.4:1), bright is 60% (~#7d7d7d, 4.0:1), under 4.5:1 for small text; consumers now write `color-mix(in srgb, var(--text-main) 70%, var(--background))` (~5.7:1) by hand. Decide: recalibrate the tokens (every consumer's look shifts) or ship a `--text-dim` at 70%
