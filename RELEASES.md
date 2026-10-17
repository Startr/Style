# Release Notes

## Version 1.4.2 - 2026-10-17

### 🐛 Bug Fixes

*   **Button hover, again**: 1.4.1's fix held against a class reset but not against Tailwind's preflight (`button { background-color: transparent }`), so AI-UI's icon buttons still filled `--primary` on hover. Each hover selector now carries exactly its base rule's specificity (`button:where(:hover)` and kin), so whatever overrides a button's background at rest overrides it on hover too. Checked against AI-UI's real pages with the core's `probe:hover --sheet` before this release: 0 unasked fills, against 45 on 1.4.1.

## Version 1.4.1 - 2026-10-17

### 🐛 Bug Fixes

*   **Button hover painted over a consumer's own reset**: 1.4.0's `button:hover` rule outranked a class reset such as Tailwind's `.bg-transparent`, so transparent icon buttons filled solid `--primary` on hover (AI-UI: 34 of 50 buttons in the chat shell). The rule is now `:where(button, …):hover`, one class of specificity, so a consumer sheet loaded after the kit wins the tie. Unset `--button-hover` still means "unchanged on hover".
*   **A gate for this class of bug**: `bun run probe:hover <url>` in the core forces hover on every button in a page and flags any that fills without asking. It runs in seconds.

## Version 1.4.0 - 2026-10-16

### ✨ New Features & Enhancements

*   **The core builds the sheet**: `style.css` now comes from Startr/WEB-startr.style.core through `make core_publish`. A parity check proves it matches 1.3.2 before anything is copied, and `props.json` lists every prop, tier, state and token at `/props.json`.
*   **States**: `--bg-hover`, `--oe-focus` (keyboard focus), `--bg-active` and `--bg-on` style an element in that state; `--c-in-on` and `--c-in-hover` style a direct child of an element in that state. They work on bg, bgc, c, b, bc, boxs, op, t and oe. "On" means `aria-current`, `aria-selected`, `aria-pressed` or `aria-expanded`, `[open]`, `:checked`, or `data-on`.
*   **Motion**: `--anim` with the `st-fade`, `st-rise`, `st-slide-in` and `st-pop` keyframes; `--ease-*` and `--dur-*` tokens. Reduced motion stops kit animations and transitions.
*   **Colour by math**: `--mix: RGB` gives any cell of the 6x6x6 cube and `--tone: N` gives a tint or grey, computed on the element. Tint tokens `--primary-tint`, `--good-bg`, `--warn-bg` and `--bad-bg`.
*   **Effects**: `--text-grad` (gradient text), `--glow: N`, `--bdf` (backdrop-filter), `--oo` (outline-offset), `--font-sans` and `--font-mono`.
*   **Pinned versions**: `/v1.3.2/` and `/v1.4.0/` serve fixed bytes.

### 🐛 Bug Fixes

*   **Hover props work**: `--hvr-bg` and the other hover props now beat their base prop. They stay as aliases of the new `--x-hover` names.
*   **`--maxw-sm` is back**: 1.3.2 switched it off for a presentation; `/v1.3.2/` keeps it off.
*   **`--ttf`**: the transition timing prop was misspelt `-ttf` and never worked.
*   **`--button-hover`** now sets the button hover colour; unset, buttons look the same as before.

### Notes

*   The rolling `/style.min.css` stays at its 1.3.2 bytes for now. It had drifted from `style.css`; `/v1.4.0/style.min.css` is the current minified build.

## Version 1.2.2.2 - 2025-06-25

### 🐛 Bug Fixes

*   **Dependency**: Added `bunx` to the dependencies in `package.json` to ensure scripts that rely on it run correctly.

## Version 1.2.2.1 - 2025-06-25

### 🐛 Bug Fixes

*   **Dependency Management**: Removed `package-lock.json` in favor of `bun.lockb` to streamline dependency management with Bun.

## Version 1.2.2 - 2025-06-25

### ✨ New Features & Enhancements

*   **Cloudflared Integration**: Added a new `online` script to `package.json` to easily start the application and expose it to the internet using a `cloudflared` tunnel. This simplifies sharing and testing the development server.
*   **Improved Layout**: Made adjustments to the layout for better responsive behavior, add TODO for the aside (sidebar) has a max-height of 100vh and scrolls on smaller screens.

## Version 1.2.1 - 2025-06-25

### 🐛 Bug Fixes & Dependency Updates

*   **Switched to Bun**: Migrated the project from Yarn to Bun for package management to improve performance and development speed. This includes replacing `yarn.lock` with `bun.lockb`.

## Version 1.2.0 - 2025-06-25

### ✨ New Features & Enhancements

*   **Enhanced Design Philosophy Pages**: Added comprehensive practical examples to Brutalism, Modernism, and Experimentalism pages to better showcase the design principles in action.
*   **New Tutorial System**: Introduced a step-by-step tutorial system covering basic utilities, responsive layouts, and interactive components, making it easier for users to learn and adopt the styles.
*   **Expanded Use Cases Documentation**: Added a new section with practical, real-world examples, including login forms, navigation bars, image galleries, and pricing cards.
*   **Improved Navigation**: The main navigation has been updated to include a "Learning" section with quick links to the new Tutorials and Use Cases. A "Design Styles" section has also been added for easier exploration.
*   **Completed Component Inventory**: A comprehensive scan of existing components was completed, identifying over 25 components ready for inclusion in the upcoming component gallery. This sets the foundation for a robust component library.
