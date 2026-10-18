import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, type Chrome, type Page } from "./cdp";

// An svg is 1.2em tall unless it says otherwise. The kit's rule used to be `svg { height: 1.2em }`, which
// beat the element's own height attribute, so a 22px icon beside a small label shrank to 12px. The rule is
// now svg:where(:not([height])): the attribute is honoured, and the specificity stays one element, so a
// consumer's `svg { height }` after the kit still wins, as it did.

const root = join(import.meta.dir, "..");
const VARIANTS = ["startr.css", "startr.min.css"];
const suite = findChrome() ? describe : describe.skip;

const icon = (attrs: string, extra = "") => `<svg ${attrs} viewBox="0 0 10 10" ${extra}><rect width="10" height="10"/></svg>`;

const page = (sheet: string) => `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="${sheet}">
<style>/* a consumer sheet, loaded after the kit: an element-level svg rule, as a reset or a component sheet writes it.
  :where() keeps the wrapper out of its specificity, so it is one element, like the kit's own svg rule. */
  :where(#consumer-wrap) svg { height: 31px; }</style></head>
<body>
  <p style="font-size:10px">
    <span id="w-bare">${icon('id="plain"')}</span>
    <span id="w-attr">${icon('id="attr22" height="22"')}</span>
    <span id="w-attrs">${icon('id="attr22w" width="22" height="22"')}</span>
    <span id="w-widthonly">${icon('id="widthonly22" width="22"')}</span>
    <span id="w-pct">${icon('id="pct" height="100%"')}</span>
    <span id="consumer-wrap">${icon('id="consumer"')}</span>
    <span id="w-inline">${icon('id="inline" style="height: 17px"')}</span>
  </p>
</body></html>`;

suite("svg height", () => {
  let dist = "";
  let chrome: Chrome;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "startr-svg-height-"));
    const build = Bun.spawn([process.execPath, "run", "build.ts"], {
      cwd: root,
      env: { ...process.env, STARTR_DIST: dist },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`The build failed (${code}).\n${out}\n${err}`);
    for (const variant of VARIANTS) writeFileSync(join(dist, `svg-height.${variant}.html`), page(variant));
    // Teeth, two ways. The rule as it was (the attribute loses), and the obvious fix (the consumer loses).
    const built = readFileSync(join(dist, "startr.css"), "utf8");
    if (!/svg:where\(:not\(\[height\]\)\)/.test(built)) throw new Error("the built sheet has no svg:where(:not([height])) rule");
    writeFileSync(
      join(dist, "startr-before.css"),
      built.replace(/svg:where\(:not\(\[height\]\)\)\s*\{\s*height:\s*1\.2em;?\s*\}/, "svg { height: 1.2em; }"),
    );
    writeFileSync(join(dist, "startr-notwhere.css"), built.replace("svg:where(:not([height]))", "svg:not([height])"));
    writeFileSync(join(dist, "svg-height.before.html"), page("startr-before.css"));
    writeFileSync(join(dist, "svg-height.notwhere.html"), page("startr-notwhere.css"));
    chrome = await launch();
  }, 120_000);

  afterAll(async () => {
    await chrome?.close();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  const height = (tab: Page, id: string) => tab.eval<number>(`document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().height`);

  describe.each(VARIANTS)("in %s", (variant) => {
    let tab: Page;

    beforeAll(async () => {
      tab = await chrome.newPage(`file://${join(dist, `svg-height.${variant}.html`)}`);
      await tab.setViewport(800);
    }, 30_000);

    afterAll(async () => {
      await tab?.close();
    });

    test("an svg with no height attribute is 1.2em tall", async () => {
      expect(await height(tab, "plain")).toBeCloseTo(12, 1); // font-size 10px
      expect(await height(tab, "widthonly22")).toBeCloseTo(12, 1);
    });

    test("an svg with a height attribute keeps it", async () => {
      expect(await height(tab, "attr22")).toBe(22);
      expect(await height(tab, "attr22w")).toBe(22);
    });

    test("a percentage height attribute is a height attribute", async () => {
      expect(await tab.eval<string>(`getComputedStyle(document.getElementById("pct")).height`)).not.toBe("12px");
    });

    test("a consumer's svg rule after the kit still wins over the 1.2em", async () => {
      expect(await height(tab, "consumer")).toBe(31);
    });

    test("an inline style wins over everything", async () => {
      expect(await height(tab, "inline")).toBe(17);
    });
  });

  test("teeth: the old rule overrode the attribute", async () => {
    const tab = await chrome.newPage(`file://${join(dist, "svg-height.before.html")}`);
    try {
      await tab.setViewport(800);
      expect(await height(tab, "attr22")).toBeCloseTo(12, 1);
    } finally {
      await tab.close();
    }
  });

  test("teeth: a bare svg:not([height]) outranks the consumer's svg rule; svg:where() does not", async () => {
    const tab = await chrome.newPage(`file://${join(dist, "svg-height.notwhere.html")}`);
    try {
      await tab.setViewport(800);
      expect(await height(tab, "consumer")).toBeCloseTo(12, 1);
    } finally {
      await tab.close();
    }
  });
});
