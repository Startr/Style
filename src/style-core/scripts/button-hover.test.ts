import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, type Chrome, type Page } from "./cdp";

// --button-hover is read by the button hover rule in helpers/_effects.css,
// falling back to the button's own background. Unset, hover must look exactly
// like rest; set anywhere up the tree, hover takes it; a page that changes
// --primary or --element-bg must keep its own colour on hover.

const root = join(import.meta.dir, "..");
const VARIANTS = ["startr.css", "startr.min.css"];
const suite = findChrome() ? describe : describe.skip;

const RED = "rgb(255, 0, 0)";
const CRIMSON = "rgb(220, 20, 60)";
const TEAL = "rgb(0, 128, 128)";
const INK = "rgb(1, 2, 3)";
const CLEAR = "rgba(0, 0, 0, 0)";

const page = (sheet: string) => `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="${sheet}">
<style>/* a consumer sheet, loaded after the kit, as Tailwind's is in AI-UI */ .bg-transparent { background-color: transparent; }</style></head>
<body>
  <button id="plain">Plain</button>
  <a id="link" class="button" href="#">Link button</a>
  <input id="submit" type="submit" value="Submit">
  <div style="--button-hover: ${RED}"><button id="set">Set</button></div>
  <button id="crimson" style="--element-bg: ${CRIMSON}">Crimson</button>
  <div style="--primary: ${TEAL}"><button id="teal">Teal</button></div>
  <button id="prop" style="--bg: ${INK}">Prop</button>
  <button id="tw" class="bg-transparent">Tailwind reset</button>
  <div style="--button-hover: ${RED}"><button id="twset" class="bg-transparent">Tailwind reset under a token</button></div>
</body></html>`;

suite("--button-hover", () => {
  let dist = "";
  let chrome: Chrome;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "startr-button-hover-"));
    const build = Bun.spawn([process.execPath, "run", "build.ts"], {
      cwd: root,
      env: { ...process.env, STARTR_DIST: dist },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`The build failed (${code}).\n${out}\n${err}`);
    for (const variant of VARIANTS) writeFileSync(join(dist, `button-hover.${variant}.html`), page(variant));
    chrome = await launch();
  }, 120_000);

  afterAll(async () => {
    await chrome?.close();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  describe.each(VARIANTS)("in %s", (variant) => {
    let tab: Page;

    beforeAll(async () => {
      tab = await chrome.newPage(`file://${join(dist, `button-hover.${variant}.html`)}`);
      await tab.setViewport(1024);
    }, 30_000);

    afterAll(async () => {
      await tab?.close();
    });

    /** Background at rest and while hovered, after the button's transition settles. */
    async function restAndHover(selector: string): Promise<[string, string]> {
      const rest = await tab.style(selector, "background-color");
      await tab.forcePseudoState(selector, ["hover"]);
      try {
        await Bun.sleep(300);
        return [rest, await tab.style(selector, "background-color")];
      } finally {
        await tab.forcePseudoState(selector, []);
        await Bun.sleep(300);
      }
    }

    test.each(["#plain", "#link", "#submit"])("unset: %s looks the same hovered as at rest", async (selector) => {
      const [rest, hover] = await restAndHover(selector);
      expect(hover).toBe(rest);
    });

    test("set on an ancestor: hover takes it", async () => {
      const [rest, hover] = await restAndHover("#set");
      expect(rest).not.toBe(RED);
      expect(hover).toBe(RED);
    });

    test("--element-bg: hover keeps the button's own colour", async () => {
      expect(await restAndHover("#crimson")).toEqual([CRIMSON, CRIMSON]);
    });

    test("--primary changed on an ancestor: hover follows it, not the root's primary", async () => {
      expect(await restAndHover("#teal")).toEqual([TEAL, TEAL]);
    });

    test("a consumer class reset keeps its background on hover, with or without a token (1.4.0 painted it --primary)", async () => {
      expect(await restAndHover("#tw")).toEqual([CLEAR, CLEAR]);
      expect(await restAndHover("#twset")).toEqual([CLEAR, CLEAR]);
    });

    test("an inline --bg prop still wins on hover", async () => {
      expect(await restAndHover("#prop")).toEqual([INK, INK]);
    });
  });
});
