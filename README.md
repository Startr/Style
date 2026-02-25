# Startr Style–less

**1.3.1**

Now with Print only `-pt` responsive utility shorthand!!!

## Why start with Startr Style – Simplifying CSS Frameworks is hard

- The pursuit of simplifying styling in CSS frameworks often leads to bulky, overcomplicated code.
- The web is built upon basic HTML elements and shouldn't require packaging large amounts of dependencies.
- Adding wrappers and CSS classes increases complexity, memory usage, and slows down style calculations.
- Embrace the elegance of simplicity by creating CSS frameworks that prioritize the basics.
- Allow for customization without the need for hyper-overriding styles.
- A framework that hinders creativity and innovation is not useful.

## Style Core (Subtree)

The CSS framework source lives in its own repo
([WEB-startr.style.core](https://github.com/Startr/WEB-startr.style.core))
and is embedded here as a **git subtree** under `src/style-core/`.

Unlike submodules, **subtree requires no extra steps after cloning** —
the `src/style-core/` directory is regular committed files.

```bash
# Pull latest from the core repo (maintainers only)
make style_core_update

# Push local subtree edits back to the core repo
make style_core_push
```

> `make style_core_add` was already run once to set up the subtree.
> New clones get the files automatically — no init required.

## Available Scripts

In the project directory, you can run:

### `bun run start`

Runs the app in the development mode using Eleventy.
Open [http://localhost:8080](http://localhost:8080) to view it in the browser.

The page will reload if you make edits.

### `bun run build`

Builds the app for production to the `dist` folder using Eleventy.

### `bun run audit:accessibility`

Runs an accessibility audit on the HTML files in the `src` directory using `axe-cli`.

### `bun run audit:accessibility:built`

Builds the site first, then runs an accessibility audit on the generated HTML files in the `dist` directory using `axe-cli`.

### `bun run audit:accessibility:live`

Runs an accessibility audit on the live development server at `http://localhost:8080` using `axe-cli`. Note: This tests only the main page. To test multiple pages, run the command for each page individually:

```bash
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" axe http://localhost:8080/brutalism/
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" axe http://localhost:8080/modernism/
```
