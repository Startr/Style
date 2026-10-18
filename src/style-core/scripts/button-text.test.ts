import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, type Chrome, type Page } from "./cdp";
import { contrast, over, parseRgba, type RGB } from "./wcag";

// Button text on its fill, in both themes. The dark block makes --white a near-black, and the button
// fallback used to read --white, so a plain button had dark text on --primary in dark mode (about 1.5:1).
// The fallback is now --button-text, the base white, which the dark block does not touch. --btn-c
// overrides (.white, .grey, .transparent, .black, or an inline value) still win.

const root = join(import.meta.dir, "..");
const VARIANTS = ["startr.css", "startr.min.css"];
const suite = findChrome() ? describe : describe.skip;
const AA = 4.5;

const WHITE = "rgb(255, 255, 255)";

// One block of buttons, repeated in a light container and a dark one (a nested [data-theme="dark"]).
const buttons = `
  <button id="def">Default</button>
  <input id="submit" type="submit" value="Submit">
  <a id="link" class="button" href="#">Link</a>
  <button id="primary" class="primary">Primary</button>
  <button id="secondary" class="secondary">Secondary</button>
  <button id="green" class="green">Green</button>
  <button id="blue" class="blue">Blue</button>
  <button id="orange" class="orange">Orange</button>
  <button id="red" class="red">Red</button>
  <button id="black" class="black">Black</button>
  <button id="whitebtn" class="white">White</button>
  <button id="grey" class="grey">Grey</button>
  <button id="transparent" class="transparent">Transparent</button>
  <button id="outline" class="outline">Outline</button>
  <button id="inline" style="--btn-c: rgb(1, 2, 3)">Inline --btn-c</button>
  <button id="token" style="--button-text: rgb(9, 8, 7)">Own --button-text</button>`;

const page = (sheet: string) => `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="${sheet}"></head>
<body style="margin:0">
  <section id="light" style="background-color:var(--background);padding:8px">${buttons.replace(/ id="/g, ' id="l-')}</section>
  <section id="dark" data-theme="dark" style="background-color:var(--background);padding:8px">${buttons.replace(/ id="/g, ' id="d-')}</section>
</body></html>`;

type Sample = { color: string; bg: string; page: string };

suite("button text, both themes", () => {
  let dist = "";
  let chrome: Chrome;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "startr-button-text-"));
    const build = Bun.spawn([process.execPath, "run", "build.ts"], {
      cwd: root,
      env: { ...process.env, STARTR_DIST: dist },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`The build failed (${code}).\n${out}\n${err}`);
    for (const variant of VARIANTS) writeFileSync(join(dist, `button-text.${variant}.html`), page(variant));
    // Teeth: the sheet as it was before, with the white fallback back in the two button rules.
    const old = readFileSync(join(dist, "startr.css"), "utf8").replace(/var\(--btn-c,\s*var\(--button-text\)\)/g, "var(--btn-c, var(--white))");
    writeFileSync(join(dist, "startr-old.css"), old);
    writeFileSync(join(dist, "button-text.old.html"), page("startr-old.css"));
    chrome = await launch();
  }, 120_000);

  afterAll(async () => {
    await chrome?.close();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  /** What a button paints: its text, its fill and the page under it, read from the computed style. */
  async function sample(tab: Page, id: string): Promise<Sample> {
    return tab.eval<Sample>(`(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor, page: getComputedStyle(el.parentElement).backgroundColor };
    })()`);
  }
  /** Contrast of the text on the fill, the fill painted over the page when it is translucent. */
  const ratio = (s: Sample) => {
    const pageRgb = parseRgba(s.page).slice(0, 3) as RGB;
    const fill = over(parseRgba(s.bg), pageRgb);
    return contrast(over(parseRgba(s.color), fill), fill);
  };

  describe.each(VARIANTS)("in %s", (variant) => {
    let tab: Page;
    const get = (theme: "l" | "d", name: string) => sample(tab, `${theme}-${name}`);

    beforeAll(async () => {
      tab = await chrome.newPage(`file://${join(dist, `button-text.${variant}.html`)}`);
      await tab.setViewport(1024);
    }, 30_000);

    afterAll(async () => {
      await tab?.close();
    });

    test("the two containers really are a light and a dark theme", async () => {
      const light = await get("l", "def");
      const dark = await get("d", "def");
      expect(light.page).toBe(WHITE);
      expect(dark.page).not.toBe(WHITE);
    });

    test.each(["def", "submit", "link", "primary"])("%s: white text on --primary, AA, in light and dark", async (name) => {
      for (const theme of ["l", "d"] as const) {
        const s = await get(theme, name);
        expect(s.color).toBe(WHITE);
        expect(ratio(s)).toBeGreaterThanOrEqual(AA);
      }
    });

    test.each(["secondary", "green", "blue", "orange", "red"])("%s: the text is the same white in dark as in light", async (name) => {
      const light = await get("l", name);
      const dark = await get("d", name);
      expect(light.color).toBe(WHITE);
      expect(dark.color).toBe(light.color);
      expect(dark.bg).toBe(light.bg);
    });

    test("black flips with the theme and stays readable in both", async () => {
      const light = await get("l", "black");
      const dark = await get("d", "black");
      expect(light.color).toBe(WHITE);
      expect(dark.color).not.toBe(WHITE);
      expect(ratio(light)).toBeGreaterThanOrEqual(AA);
      expect(ratio(dark)).toBeGreaterThanOrEqual(AA);
    });

    test.each(["whitebtn", "transparent"])("%s: --btn-c keeps its text readable in both themes", async (name) => {
      for (const theme of ["l", "d"] as const) {
        const s = await get(theme, name);
        expect(s.color).not.toBe(WHITE);
        expect(ratio(s)).toBeGreaterThanOrEqual(AA);
      }
    });

    // .grey has its own dark-mode fault, older than this change: its fill (--grey) is light grey in dark
    // mode and --btn-c is --text-main, which is light too, so the text is about 1.5:1. Light mode is fine.
    // The test pins that this change leaves it exactly as it was.
    test("grey: readable in light; in dark it is the same pair as before (a known fault, not this change's)", async () => {
      const light = await get("l", "grey");
      expect(light.color).not.toBe(WHITE);
      expect(ratio(light)).toBeGreaterThanOrEqual(AA);
      const dark = await get("d", "grey");
      const textMain = await tab.eval<string>(
        "(() => { const i = document.createElement('i'); i.style.color = 'var(--text-main)'; document.getElementById('dark').appendChild(i); return getComputedStyle(i).color; })()",
      );
      expect(dark.color).toBe(textMain);
    });

    test("an inline --btn-c wins in both themes", async () => {
      for (const theme of ["l", "d"] as const) expect((await get(theme, "inline")).color).toBe("rgb(1, 2, 3)");
    });

    test("--button-text is the token to set for every button under it", async () => {
      for (const theme of ["l", "d"] as const) expect((await get(theme, "token")).color).toBe("rgb(9, 8, 7)");
    });

    test(".outline fills with --primary on hover and the text stays white in dark mode", async () => {
      for (const theme of ["l", "d"] as const) {
        const id = `${theme}-outline`;
        await tab.forcePseudoState(`#${id}`, ["hover"]);
        try {
          await Bun.sleep(300);
          const s = await sample(tab, id);
          expect(s.color).toBe(WHITE);
          expect(ratio(s)).toBeGreaterThanOrEqual(AA);
        } finally {
          await tab.forcePseudoState(`#${id}`, []);
        }
      }
    });
  });

  test("teeth: with the white fallback back in the rules, a dark-mode button is unreadable", async () => {
    const tab = await chrome.newPage(`file://${join(dist, "button-text.old.html")}`);
    try {
      await tab.setViewport(1024);
      const light = await sample(tab, "l-def");
      const dark = await sample(tab, "d-def");
      expect(ratio(light)).toBeGreaterThanOrEqual(AA);
      expect(dark.color).not.toBe(WHITE);
      expect(ratio(dark)).toBeLessThan(2);
    } finally {
      await tab.close();
    }
  });
});
