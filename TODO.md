# Startr Style Project TODO: The Quest for Awesome!

Welcome, brave developer, to the Startr Style Project TODO list! This isn't just a list; it's a treasure map leading to a land of sleek design, stellar performance, and happy users. Let's get these gems polished!

## 🚧 High Priority — Blockers (Must Complete Before Other Work!)

### **Makefile Standardization Initiative**
- [x] **[Infrastructure] Standardize Makefile Across All Git Repositories** 
  - [x] Research current Makefile patterns across Startr repositories
  - [x] Design universal template with dynamic project title extraction supporting both:
    - `THE_OWNER/PROJECT` format (e.g., "Startr/Style") ✅ 
    - `project_owner/folder` format (e.g., "somma/my-project") ✅
  - [x] Test dynamic variable extraction: `git config --get remote.origin.url` parsing ✅
  - [x] Create standardized help command format showing "{OWNER}/{PROJECT} by Startr.Cloud" ✅
  - [x] Handle edge cases: SSH vs HTTPS URLs, GitLab/GitHub differences, local repos ✅
  - [x] Implement consistent command naming conventions (it_run, it_build, deploy, etc.) ✅
  - [x] Add standard variables for PROJECTPATH, PROJECT, OWNER, BRANCH, TAG, CONTAINER ✅
  - [ ] Create documentation for Makefile standardization guidelines
  - [ ] Test standardized Makefile in this repository first
  - [ ] Roll out to other Startr repositories
  - [ ] Step away from Netlify to Cloudflare or Self-host
  - [ ] Update CONVENTION.instructions.md with Makefile standards

**Why This is a Blocker**: Standardizing our build and deployment infrastructure across all repositories is critical for:
- Consistent developer experience across projects
- Automated CI/CD pipeline compatibility  
- Reduced onboarding time for new projects
- Easier maintenance and updates across the entire Startr ecosystem

## 📋 Backlog

- [ ]  📦 Versioning & Rollback

	- [ ] **Ship pinned and rolling CDN versions**: Currently unversioned — any change to Startr.Style hits every consumer (Sage.is, Sage.Education) instantly, with no rollback path. Publish `/v1/`, `/v2/`, and a rolling `/latest/`. Implementation approach: submodule structure where `v1/` is a submodule pointing to the project at the v1 tag, `v2/` at v2, etc. — versioned URLs serve from the pinned submodule, `latest/` serves from `master`. 
	- [ ] Consumers pin to a version in prod; `latest` is for the Startr studio itself. Migration plan needed for existing Sage.is / Sage.Education `<link>` tags currently pointing at the unversioned URL. *(Surfaced by Zach Leatherman in a panel review of Sage.is, 2026-04-18.)*
	- [ ] **Cache headers — versioned vs rolling**: `/v1/style.css`, `/v2/style.css`, etc. → `Cache-Control: public, max-age=31536000, immutable` (one year, immutable; the URL's contents never change by design). `/latest/style.css` → `Cache-Control: public, max-age=60, must-revalidate` (short TTL + revalidate so studio pushes propagate quickly and stale copies don't linger). *(Surfaced by Zach Leatherman, 2026-04-18.)*
	- [ ] **Emit SRI integrity hashes for each pinned release**: Generate `sha384` integrity hashes at release time and publish them alongside the versioned URL so consumers can use `<link rel="stylesheet" href="/v1/style.css" integrity="sha384-..." crossorigin="anonymous">`. Gives consumers an integrity guarantee even though Startr.Style is on a separate origin. *(Surfaced by Zach Leatherman, 2026-04-18.)*
	- [ ] **Resolve version drift between README and package.json**: `README.md` opens with `1.3.1`; `package.json` declares `1.2.2.2`. Pick one source of truth (conventionally `package.json`) and make the README read from it, or bump them in lockstep via `scripts/release.sh`. *(Surfaced by Lea Verou in a panel review of Startr.Style, 2026-04-20.)*

### ♿ Accessibility

- [ ] **Audit `-hvr` coverage for `:focus` and `:focus-visible`**: Every `[style*="--X-hvr:"]:hover` rule should be paired with `:focus, :focus-visible` so keyboard users get the same affordance as mouse users. `--shadow-hvr` covers `:focus` today; audit and enumerate the rest (`--hvr-bgc`, `--hvr-c`, `--hvr-bdc`, etc.). Land coverage systematically, not ad-hoc. *(Surfaced by Adam Wathan in a panel review of Sage.is, 2026-04-18.)*
- [ ] **Reconcile `:focus-visible` audit status with spoken claims**: The `-hvr` coverage audit above has been open since 2026-04-18, yet a verbal claim of "keyboard accessibility tested, no issues" was made during the 2026-04-20 panel. Either close the audit with a landed commit, or retract the claim. Both states cannot be true at once. *(Surfaced by Heydon Pickering in a panel review of Startr.Style, 2026-04-20.)*

### 🎨 Colour System Invariants

- [ ] **Audit every colour leaf for IACVT-safe fallbacks**: The 216-cell `color-mix(in oklch, …)` cascade in `src/style-core/src/variables.css` invalidates whole declarations when any component is unparseable. Every consumer leaf (e.g. `background: var(--primary)`) must resolve to `var(--primary, <literal-fallback>)`, not `inherit`/`initial`. Audit the whole leaf surface, not one line — otherwise the DSL has accents. *(Surfaced by Lea Verou in a panel review of Startr.Style, 2026-04-20.)*
- [ ] **Register critical custom properties with `@property`**: Without registration, the browser treats colour and layout variables as untyped strings. Downstream `color-mix()` and `calc()` can silently IACVT when consumers pass malformed values. Register `--primary`, `--background`, `--text-main`, and the 216-cell cube entries so the browser can validate inputs and animate between them. *(Surfaced by Lea Verou in a panel review of Startr.Style, 2026-04-20.)*

### 🏛️ Design System Governance

- [ ] **Write the Startr.Style axioms file**: Ship a contributor-facing `docs/axioms.md` stating, in short sentences, what the framework does and — crucially — what it refuses to do. Rule out patterns explicitly: "no utility token should require `!important` on the consumer side"; "every `[style*=\"--X-hvr:\"]:hover` rule must pair `:focus, :focus-visible`"; "every colour leaf must declare a non-mix fallback"; "token naming follows the `--{abbrev}{-breakpoint}` shape, no exceptions." Without axioms, every contributor (human or AI) invents their own convention and the framework drifts. *(Surfaced by Andy Bell in a panel review of Startr.Style, 2026-04-20.)*

### 📊 Performance Methodology

- [ ] **Replace the "17% faster than Tailwind" eye-balling with a real harness**: Pick three comparable pages per site (landing, docs, gallery/component showcase). Throttle to Slow 4G, mid-tier Android, cold cache, five runs, publish median. Publish the harness and raw numbers in `docs/benchmarks/`. Until then, the 17% claim is a vibe, not a metric — use it at parties, not in the README. *(Surfaced by Jeremy Keith in a panel review of Startr.Style, 2026-04-20.)*
- [ ] **Re-run LCP on a page that exercises the colour cube**: Current LCP of 0.55s has `<p>` as the LCP element, meaning the 216-cell `color-mix()` cascade is not in the critical render path of the tested page. Re-measure on `theme-creator.html` and the component gallery once it exists — pages that actually resolve the cube. *(Surfaced by Lea Verou in a panel review of Startr.Style, 2026-04-20.)*

### 🧹 Repo Hygiene

- [ ] **Remove Syncthing conflict file from `src/_includes/`**: `src/_includes/layout.sync-conflict-20251127-153148-EJ43XZB.njk` is a Syncthing merge-conflict leftover in the source tree. Decide whether canonical `layout.njk` or the conflict copy is the intended version, merge the divergence, delete the conflict file. Add `*.sync-conflict-*` to `.gitignore` to prevent recurrence. *(Surfaced by Heydon Pickering in a panel review of Startr.Style, 2026-04-20.)*

## 🎉 Done — Recent Accomplishments
- [x] **Enhanced Design Philosophy Pages** - Added comprehensive practical examples to Brutalism, Modernism, and Experimentalism pages
- [x] **Created Tutorial System** - Built step-by-step tutorials covering basic utilities, responsive layouts, and interactive components
- [x] **Added Use Cases Documentation** - Created practical real-world examples including login forms, navigation, galleries, and pricing cards
- [x] **Updated Navigation** - Added Learning section with links to Tutorials and Use Cases, plus Design Styles section
- [x] **Component Inventory Complete** - Scanned existing components and updated TODO with 15+ existing components ready for gallery inclusion

## 📋 Existing Components Found (Ready for Gallery)
- **Navigation**: Header navigation (layout.njk), footer with social icons (footer.njk)
- **Forms**: Text inputs, textareas, selects, validation states (fields.njk), login forms (use-cases)
- **Buttons**: All variations including colors, sizes, groups, icons, disabled states (buttons.njk)
- **Cards**: Pricing cards, product showcases (use-cases/index.njk)
- **Layout**: Grid systems, responsive layouts (tutorials/index.njk)
- **Tables**: Basic data tables (everything-else.njk)
- **Interactive**: Details/summary accordions (everything-else.njk)
- **Social**: Social media buttons and icons (footer components)
- **Typography**: Headings, paragraphs, blockquotes, lists, text formatting (typography.njk)
- **Media**: Responsive images, image galleries, avatars, icons (multiple files)
- **Loading**: Spinners, skeleton states, pulse animations (use-cases, working.html)

**Total: 25+ existing components identified across 12+ major categories**

## 🎯 TODO — Next Steps for Component Gallery
- [ ] **Create Gallery Landing Page** - Build main navigation for component categories
- [ ] **Extract Components** - Move existing components into dedicated gallery sections
- [ ] **Add Live Examples** - Enable copy-paste functionality and live preview
- [ ] **Organize by Category** - Group components logically (Forms, Buttons, Layout, etc.)
- [ ] **Add Documentation** - Include usage instructions and accessibility notes
- [ ] **Interactive Features** - Add search, filters, and component playground

## 🐛 Bugs — Known Issues
- [ ] **Inset shadows don't play well with other shadows** — When combining `--shadow-inset` with `--shadow` or `--shadow-hvr`, the rendering breaks or produces unexpected results. Discovered while building the sage.is/hardware configurator page. Needs investigation into how the CSS custom property shadow system composes inset and standard box-shadows together.

## 🚨 Done — Critical Priorities (All Hands on Deck!)
- [x] Fix server error handling #TechnicalFoundation
- [x] Perfect mobile responsiveness #UserExperience
- [x] Optimize loading speed #UserExperience (Note we are using Eleventy for static site generation and should set a medium priority for CDN updates)
- [x] Test across browsers #QualityAssurance
- [x] Audit accessibility #QualityAssurance
  - [x] Setup axe-cli for automated audit
- [x] Test mobile devices #QualityAssurance
- [x] Verify loading speeds #QualityAssurance

## 🔥 High Priorities - Fueling the Rocket!
- [x] Write clear examples for each design style #ContentExcellence
- [x] Create step-by-step tutorials #ContentExcellence
- [x] Add practical use cases for utilities #ContentExcellence
- [x] Keep things DRY (Don't Repeat Yourself) #ContentExcellence
  - [x] Refactor _includes to avoid duplication
  - [x] Created shared components: head.njk, theme-toggle.njk, navigation.njk, theme-scripts.njk
  - [x] Eliminated code duplication between layout.njk and layout_2.njk
  - [x] Consolidated footer content using footer.njk include
- [x] Document design principles clearly #ContentExcellence
- [ ] Max height for the aside on small screens should be 100vh or less, and the overflow should scroll vertically
- [ ] Write compelling copy for landing page #ContentExcellence
- [ ] Add interactive playground for utilities #ContentExcellence (note working system on pages: )

## 📝 TODO — Documentation & Development Guidelines #ContentExcellence
- [x] **Use Proper Highlight Shortcodes** - Always use `{% highlight "html" %}`, `{% highlight "css" %}`, or `{% highlight "text" %}` with `{% endhighlight %}` instead of hardcoded `<div class="highlight">` with `<pre>` tags
  - [x] Updated installation.njk to use proper shortcodes
  - [ ] **URGENT: Audit and fix hardcoded highlight blocks in the following files:**
    - [x] `/src/index.njk` - 1 hardcoded highlight div (line 86) ✅ COMPLETED
    - [x] `/src/docs/utilities.njk` - 1 hardcoded highlight div + pre tag (lines 45-47) ✅ COMPLETED
    - [x] `/src/docs/tutorials/index.njk` - 5 hardcoded highlight divs (lines 38, 46, 114, 121, 176) + pre tags (lines 39, 47, 115, 122, 177) ✅ COMPLETED
    - [x] `/src/docs/base-elements/buttons.njk` - 8 hardcoded highlight divs (lines 18, 37, 54, 69, 90, 113, 129, 143) + pre tags ✅ COMPLETED
    - [ ] `/src/docs/base-elements/everything-else.njk` - Multiple hardcoded pre tags (lines 47, 91, 108, 132)
    - [ ] `/src/docs/base-elements/typography.njk` - 2 hardcoded pre tags (lines 123, 166)
    - [ ] `/src/docs/helpers/shadows.njk` - 8 hardcoded highlight divs (lines 20, 45, 70, 95, 121, 147, 174, 201) + pre tags
    - [ ] `/src/docs/helpers/transform.njk` - 10 hardcoded highlight divs (lines 22, 48, 72, 98, 122, 148, 172, 198, 222, 248)
    - [ ] `/src/docs/helpers/position.njk` - 7 hardcoded highlight divs + pre tags (lines 22, 44, 66, 88, 110, 132, 154)
    - [ ] `/src/docs/helpers/background.njk` - 1 hardcoded pre tag (line 23)
  - [ ] **Total files needing cleanup: 11 files with ~45+ hardcoded blocks**
  - [ ] Create documentation guideline for contributors about highlight usage
- [ ] **Maintain Consistent Code Examples** - Ensure all code snippets follow the same formatting standards
- [ ] **Document Utility Patterns** - Create clear examples for common utility combinations
- [x] **[Infrastructure] Add bun run command for cloudflared tunneling** - Create a script to start the app and expose it via cloudflared. ✅

- [ ] Create component gallery with live examples #ContentExcellence
  - [ ] **Planning & Architecture**
    - [ ] Design component gallery structure and navigation
    - [ ] Create component categorization system (UI Elements, Layout, Forms, Navigation, etc.)
    - [ ] Plan interactive playground integration
    - [ ] Define component documentation template format
    - [ ] Plan responsive showcase for each component
    
  - [ ] **Navigation Components**
    - [x] Header/Navigation bars [/docs/] (layout.njk contains main navigation)
      - [x] Horizontal navigation with dropdown menus [/_includes/layout.njk] - Add to gallery
      - [ ] Mobile hamburger menu with slide-out drawer
      - [ ] Breadcrumb navigation
      - [ ] Tab navigation with active states
      - [ ] Sidebar navigation with nested items
    - [x] Footer components [/docs/]
      - [x] Simple footer with links [/_includes/footer.njk] - Add to gallery
      - [x] Multi-column footer with social icons [/_includes/footer.njk, /static/footer.html] - Add to gallery
      - [ ] Sticky footer layouts
    - [ ] Pagination components
      - [ ] Number-based pagination
      - [ ] Previous/Next pagination
      - [ ] Load more button
- [x] **Typography Components** [/docs/base-elements/typography.njk]
	- [x] Headings (H1-H6) [/docs/base-elements/typography.njk] - Add to gallery
	- [x] Paragraphs with inline elements [/docs/base-elements/typography.njk] - Add to gallery
	- [x] Blockquotes with citations [/docs/base-elements/typography.njk] - Add to gallery
	- [x] Text formatting (bold, italic, code, mark, small) [/docs/base-elements/typography.njk] - Add to gallery
	- [x] Links and link states [/docs/base-elements/typography.njk] - Add to gallery
- [ ] **Form Components**
	- [x] Input variations [/docs/base-elements/fields.njk]
	- [x] Text inputs with labels and validation states [/docs/base-elements/fields.njk] - Add to gallery
	- [ ] Search inputs with icons
	- [x] Number inputs with increment/decrement [/docs/base-elements/fields.njk] - Add to gallery
	- [x] Number sliders with live value display [/docs/base-elements/fields.njk] - Add to gallery
	- [ ] File upload with drag-and-drop styling
	- [x] Multi-line textarea components [/docs/base-elements/fields.njk] - Add to gallery
	- [x] Selection controls [/docs/base-elements/fields.njk]
  - [x] Custom checkboxes with various styles
	- [ ] Debug checkbox styles !!!
  - [ ] Radio button groups
  - [x] Toggle switches
  - [x] Multi-select dropdowns [/docs/base-elements/fields.njk] - Add to gallery
  - [ ] Autocomplete/typeahead inputs
- [x] Form layouts [/docs/use-cases/index.njk]
  - [ ] Inline forms
  - [ ] Stacked forms with proper spacing
  - [ ] Multi-step/wizard forms
  - [x] Form validation with error states [/docs/base-elements/fields.njk] - Add to gallery
  - [x] Login/registration form templates [/docs/use-cases/index.njk] - Add to gallery
	- [ ] Add spacing above and below the form in the preview
	- [ ] Update to the content of https://codepen.io/openco/pen/wBavPYx 

  - [ ] **Button Components**
    - [x] Button variations [/docs/base-elements/buttons.njk]
      - [x] Primary, secondary, tertiary button styles [/docs/base-elements/buttons.njk] - Add to gallery
      - [x] Icon buttons and icon + text combinations [/docs/base-elements/buttons.njk] - Add to gallery
      - [ ] Loading/spinner states
      - [x] Disabled states showcase [/docs/base-elements/buttons.njk] - Add to gallery
      - [x] Button sizes (small, medium, large, extra large) [/docs/base-elements/buttons.njk] - Add to gallery
    - [x] Button groups [/docs/base-elements/buttons.njk]
      - [x] Horizontal button groups [/docs/base-elements/buttons.njk] - Add to gallery
      - [ ] Vertical button groups
      - [ ] Segmented controls
      - [ ] Floating action buttons
    - [ ] Call-to-action components
      - [ ] Hero section CTAs
      - [ ] Newsletter signup buttons
      - [x] Social media share buttons [/_includes/footer.njk] - Add to gallery
  - [ ] **Card Components**
    - [x] Basic cards [/docs/use-cases/index.njk, /docs/tutorials/index.njk]
      - [ ] Simple content cards with image, title, description
      - [x] Product cards with pricing [/docs/use-cases/index.njk] - Add to gallery
      - [ ] User profile cards
      - [ ] Testimonial cards
      - [ ] Blog post preview cards
    - [ ] Interactive cards
      - [ ] Hover effects and transitions
      - [ ] Expandable/collapsible cards
      - [ ] Flip cards with front/back content
      - [ ] Card overlays with action buttons
    - [x] Card layouts [/docs/use-cases/index.njk]
      - [x] Card grids (responsive) [/docs/use-cases/index.njk] - Add to gallery
      - [ ] Card carousels/sliders
      - [ ] Masonry-style card layouts
      - [ ] Card lists with alternating layouts
  - [ ] **Layout Components**
    - [x] Grid systems [/docs/tutorials/index.njk, /docs/use-cases/index.njk]
      - [x] Basic grid layouts (2-column, 3-column, 4-column) [/docs/tutorials/index.njk] - Add to gallery
      - [x] Responsive grid breakpoints demonstration [/docs/tutorials/index.njk] - Add to gallery
      - [ ] Complex grid layouts (sidebar + main + aside)
      - [ ] CSS Grid showcase with named grid areas
    - [ ] Flexbox layouts
      - [ ] Flexible container examples
      - [ ] Centered content layouts
      - [ ] Space distribution examples
      - [ ] Flex direction and wrap demonstrations
    - [ ] Container components
      - [ ] Page containers with max-width
      - [ ] Section containers with background variations
      - [ ] Responsive containers
      - [ ] Full-width vs contained sections
  - [x] **Modal & Overlay Components**
    - [x] Modal dialogs based on https://believemy.com/en/r/creating-a-modal-window-without-using-javascript 
      - [x] Basic modal with backdrop
      - [x] Confirmation dialogs
      - [x] Form modals
      - [x] Image galleries in modals
      - [x] Modal sizes (small, medium, large, fullscreen)
    - [ ] Overlay components
      - [ ] Tooltip components with positioning
      - [ ] Popover menus
      - [ ] Dropdown menus
      - [ ] Toast notifications
      - [ ] Alert banners
  - [ ] **Media Components**
    - [x] Image components [Multiple files]
      - [x] Responsive images with aspect ratios [/docs/helpers/position.njk, /index.njk] - Add to gallery
      - [x] Image galleries with lightbox [/docs/use-cases/index.njk] - Add to gallery
      - [x] Avatar components (round, square, with badges) [/index.njk] - Add to gallery
      - [ ] Image carousels/sliders
      - [ ] Before/after image comparisons
    - [ ] Video components
      - [ ] Video players with custom controls
      - [ ] Video backgrounds
      - [ ] Video thumbnails with play buttons
    - [x] Icon systems [/_includes/footer.njk, /docs/base-elements/buttons.njk]
      - [x] Icon libraries integration [/_includes/footer.njk] - Add to gallery
      - [x] Icon sizes and variations [/docs/base-elements/buttons.njk] - Add to gallery
      - [x] Icon + text combinations [/docs/base-elements/buttons.njk] - Add to gallery
  - [ ] **Data Display Components**
    - [x] Table components [/docs/base-elements/everything-else.njk]
      - [x] Basic data tables with sorting [/docs/base-elements/everything-else.njk] - Add to gallery
      - [ ] Responsive tables with horizontal scroll
      - [ ] Tables with row selection
      - [ ] Tables with pagination
      - [ ] Pricing tables
    - [x] List components [/docs/base-elements/typography.njk]
      - [x] Simple lists with custom bullets [/docs/base-elements/typography.njk] - Add to gallery
      - [x] Numbered lists with custom styling [/docs/base-elements/typography.njk] - Add to gallery
      - [ ] Definition lists
      - [ ] Interactive lists with actions
    - [x] Progress indicators [/docs/use-cases/index.njk, /working.html, /prompting.html]
      - [ ] Progress bars with animations
      - [ ] Step indicators/progress steps
      - [x] Loading spinners [/working.html, /prompting.html, /worlds.html] - Add to gallery
      - [x] Skeleton loading states [/docs/use-cases/index.njk] - Add to gallery
  - [ ] **Interactive Components**
    - [x] Accordion/Collapsible [/docs/base-elements/everything-else.njk]
      - [ ] Single-item accordion
      - [ ] Multi-item accordion with smooth animations
      - [ ] FAQ-style accordions
      - [ ] Nested accordions
      - [x] Details/Summary elements [/docs/base-elements/everything-else.njk] - Add to gallery
    - [ ] Tabs
      - [ ] Horizontal tabs
      - [ ] Vertical tabs
      - [ ] Responsive tabs (convert to accordion on mobile)
      - [ ] Tabs with icons
    - [x] Slider/Range components [/docs/base-elements/fields.njk]
      - [x] Basic range sliders [/docs/base-elements/fields.njk] - Add to gallery
      - [x] Number sliders with live value display [/docs/base-elements/fields.njk] - Add to gallery
      - [ ] Dual-handle range sliders
      - [ ] Styled slider tracks
      - [x] Value display variations [/docs/base-elements/fields.njk] - Add to gallery
  - [ ] **Feedback Components**
    - [ ] Alert/Notification
      - [ ] Success, warning, error, info alerts
      - [ ] Dismissible alerts
      - [ ] Toast notifications with auto-dismiss
      - [ ] Notification center/inbox
    - [ ] Badge/Chip components
      - [ ] Status badges
      - [ ] Count badges on buttons/icons
      - [ ] Tag/chip components with removal
      - [ ] Category badges
  - [ ] **E-commerce Components**
    - [ ] Product showcases
      - [ ] Product detail layouts
      - [ ] Product comparison tables
      - [ ] Shopping cart components
      - [ ] Wishlist components
    - [ ] Pricing displays
      - [ ] Pricing cards/tables
      - [ ] Subscription plan comparisons
      - [ ] Price formatting examples
      - [ ] Discount/sale price displays
  - [ ] **Documentation & Implementation**
    - [ ] Component documentation
      - [ ] Write clear usage instructions for each component
      - [ ] Document all utility classes used
      - [ ] Provide copy-paste HTML examples
      - [ ] Include accessibility notes for each component
      - [ ] Add responsive behavior explanations
    - [ ] Interactive features
      - [ ] Add "View Code" toggle for each example
      - [ ] Implement live preview with editable code
      - [ ] Add copy-to-clipboard functionality
      - [ ] Create component search/filter system
    - [ ] Quality assurance
      - [ ] Test all components across different browsers
      - [ ] Verify mobile responsiveness of all examples
      - [ ] Validate HTML markup for accessibility
      - [ ] Ensure consistent styling across components
    - [ ] Gallery structure
      - [ ] Create main component gallery landing page
      - [ ] Build category navigation system
      - [ ] Implement component preview thumbnails
      - [ ] Add related components suggestions
      - [ ] Create component favorites/bookmarking system
- [ ] Add search functionality to documentation #UserExperience
- [ ] Add request logging #TechnicalFoundation
- [x] Optimize CSS delivery #TechnicalFoundation (using Eleventy and PostCSS)
- [x] Implement code splitting #TechnicalFoundation
  - [x] Use Eleventy for static site generation
  - [ ] Use PostCSS for CSS optimization when in Eleventy not just seperate repo
- [ ] Use service workers for caching #TechnicalFoundation
- [x] Implement HTTP/2 for faster loading #TechnicalFoundation
- [ ] Use a CDN for static assets #TechnicalFoundation
- [ ] Optimize font loading #TechnicalFoundation
- [ ] Compress images automatically #TechnicalFoundation
- [ ] Enable lazy loading for performance #TechnicalFoundation
- [x] Add touch-friendly interactions #UserExperience
- [ ] Improve navigation flow #UserExperience
- [ ] Add keyboard accessibility #UserExperience
- [ ] Test screen reader compatibility #UserExperience
- [ ] Write comprehensive style guide #DeveloperExperience
- [ ] Create component documentation #DeveloperExperience
- [ ] Add automated testing suite #DeveloperExperience
- [ ] Set up development workflow #DeveloperExperience
- [ ] Build utility reference #DeveloperExperience
- [ ] Set up CI/CD pipeline #Infrastructure
- [ ] Add deployment automation #Infrastructure
- [ ] Configure monitoring #Infrastructure
- [ ] Set up error tracking #Infrastructure
- [ ] Validate HTML semantics #QualityAssurance
- [ ] Check CSS performance #QualityAssurance
- [ ] Review code quality #QualityAssurance

## ✨ Medium Priorities - Adding Extra Sparkle!
- [ ] Expand modernism examples with real projects #ContentExcellence
- [ ] Enhance brutalism showcase with interactive demos #ContentExcellence
- [ ] Complete experimentalism section with cutting-edge techniques #ContentExcellence
- [ ] Add build process monitoring #TechnicalFoundation
- [ ] Update Eleventy to latest version #TechnicalFoundation
- [ ] Implement PostCSS optimizations #TechnicalFoundation
- [ ] Create smooth transitions #UserExperience
- [ ] Add progressive enhancement #UserExperience
- [ ] Create contribution guidelines #DeveloperExperience
- [ ] Add code examples library #DeveloperExperience
- [ ] Document best practices #DeveloperExperience
- [ ] Containerize with Docker #Infrastructure
- [ ] Add performance metrics #Infrastructure
- [ ] Create backup strategy #Infrastructure
- [ ] Plan scaling approach #Infrastructure
- [ ] Check SEO optimization #QualityAssurance
- [ ] Integrate Lighthouse for CI (low priority) #QualityAssurance

## 🧰 Backlog — TodoScope Alignment

- [ ] **Review `.todoscope-exclude.csv` paths**: Seeded with `node_modules`, `dist`, `.git`, `src/style-core` (vendored subtree), `bun.lockb`, `chat.json`, `.DS_Store`. Confirm nothing load-bearing got excluded; add `static/` or other generated trees if needed.
- [ ] **Migrate inline source comments to `TODO:` / `FIXME:` / `BUG:` tags**: Today, many source files use `// TODO`, `// FIXME`, or prose like "needs investigation" without the canonical prefix. Sweep `src/` and normalize so TodoScope picks them up as cards. `NOTE:` is documentation, not a work item — leave those alone.
- [ ] **Verify column mapping after first scan**: Run TodoScope against this repo and confirm items land in expected columns (In Progress, TODO, Backlog, Bugs, Done). If a topic H3 under `## 📋 Backlog` accidentally spawns its own column, adjust the skill's convention doc or flatten the H3s.
- [ ] **Add `*.sync-conflict-*` to `.gitignore`**: Paired with the Repo Hygiene item above — prevent Syncthing conflict copies from ever being committed again. *(Cross-referenced from panel-review 2026-04-20.)*
