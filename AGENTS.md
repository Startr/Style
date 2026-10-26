# AGENTS.md

The startr.style site, the published CSS sheet, and Startr Swap. Eleventy builds it. Netlify deploys master.

Core changes land in [WEB-startr.style.core](https://github.com/Startr/WEB-startr.style.core). `src/style-core/` is a subtree copy of core. Never edit it here; changes arrive through a subtree pull.

## Commands

- `bun install`, then `bun run start` serves the site on :8080 (Eleventy default). AI-UI uses :8080 too, so stop one before starting the other.
- `bun run build` writes `dist/`.
- Use bun, not npm: `bun install`, `bun run <script>`, `bunx`, `bun add`, `bun remove`.
- `src/static/props.json` is the list of valid prop names, served at `/props.json`. Check every `--x` you write against it. An unknown name does nothing and raises no error.

## Release path

1. Land the core change in WEB-startr.style.core through a PR.
2. Here, start a git-flow `release/x.y.z` branch (`make minor_release`, `make patch_release`) or a hotfix (`make hotfix`).
3. Pull core into the subtree: `make style_core_update`.
4. `make core_publish`. It builds core, runs core's parity check, then writes `style.css`, `style.min.css`, `startr.css` and `props.json`. It refuses until the latest release has its snapshot.
5. `make version_snapshot V=x.y.z` pins `src/static/vx.y.z/`.
6. `git flow release finish` (`make release_finish` does that and pushes).
7. Push master, develop and the tag.

`HOLD_MIN` in the Makefile names a version whose minified bytes `/style.min.css` keeps serving while its consumers are checked. It is empty now. Set it only for a deliberate hold; `scripts/core-publish.sh` explains the guard.

Never run release or publish targets to test them.

## Pins are immutable

Pinned paths (`/vX.Y.Z/`, `/v1/swap.js`, `/v1.1/swap.js`) never change. A fix ships at a new path, with SRI in the docs. The snapshot scripts refuse to overwrite one.

## Startr Swap

- `make swap_check` gates the source: no application names, size under half of htmx gzipped, pins intact.
- `make swap_timing` checks that `swap:after` sees the new content, in headless Chrome.
- `make swap_snapshot V=n` freezes a pinned copy.

## Board

`TODO.md` commits straight to develop. Releases and everything else go through the release path.

## Workflow

- Add the task to `TODO.md` first, with a sub-checklist. Start significant work only with approval.
- Plan, document, execute, verify. Keep it DRY and KISS.
- Update the docs and `README.md` when behavior changes. Release notes live in `RELEASES.md`.

## Shared rules

The same block sits in every Sage.is and Startr repo's AGENTS.md; change it everywhere or nowhere.

- **Git.** Agents commit and push only when the person they work for says so in that session. Commits are authored as that person and carry an AI co-author trailer. Subjects read `type(scope): subject` (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`).
- **Design.** startr.style inline props in `style` attributes, never classes. Write the base (phone) value first; add an `-sm`/`-md`/`-lg`/`-xl` tier only where the layout changes, and never repeat the base value in a tier. New pages ship plain HTML first; never a third visual language. The kit's manual is [design-ingest.md](https://github.com/Startr/WEB-startr.style.core/blob/master/docs/design-ingest.md).
- **Browser checks are scripts.** `bun run probe:hover`, `probe:tap` and `probe:diff` run from a WEB-startr.style.core checkout and take seconds; they replace long agent sessions clicking through pages.
- **Steps.** A step in a runbook, run sheet or checklist is one command: `cd` to an absolute path, then commands joined with `&&` and broken with `\`, so it stops at its first failure and can later run unchanged as a Dockerfile `RUN` or a CI step. A step calls a make target, not inline logic. No inline `#` comments (interactive zsh runs them as commands), no pasted `set -e`, no heredocs; a step that needs a key touch, a password or `git add -p` stays its own [MANUALLY] step.
- **Board.** `TODO.md` sections are the kanban columns. Each card is one short claim line (under about 350 characters) with a sub-checklist; narration goes to `board-dossiers.md` in the docs folder. `KANBAN.canvas` is generated from `TODO.md`; never hand-edit it.
- **Names.** Tracked files name work paths, not people; only Alexander is named. Clients go by codename.
- **Secrets.** In the environment or the team vault; never in chat, a command line or a tracked file.
