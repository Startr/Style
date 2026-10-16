// The state props, in a real browser.
//
// Builds the sheet into a temp dir, opens test/fixtures/states.html next to it in headless Chrome and
// reads computed styles. Hover, active and :focus-visible are forced the way DevTools forces them
// (CSS.forcePseudoState) except where the test says it uses the real keyboard or the real mouse.
// The suite runs against startr.css and startr.min.css: the minifier must not change what a rule means.
// It skips itself when there is no Chrome. Set CHROME_BIN to point at one.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, type Chrome, type Page } from "./cdp";

const root = join(import.meta.dir, "..");
const VARIANTS = ["startr.css", "startr.min.css"];
const suite = findChrome() ? describe : describe.skip;

let dist = "";
let chrome: Chrome;

const rgb = (r: number, g: number, b: number) => `rgb(${r}, ${g}, ${b})`;
const WHITE = rgb(255, 255, 255);
const BLACK = rgb(0, 0, 0);

suite("state props", () => {
  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "startr-states-"));
    const build = Bun.spawn([process.execPath, "run", "build.ts"], {
      cwd: root,
      env: { ...process.env, STARTR_DIST: dist },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`The build failed (${code}). Another stream may be mid-edit.\n${out}\n${err}`);
    const fixture = readFileSync(join(root, "test/fixtures/states.html"), "utf8");
    for (const variant of VARIANTS) {
      writeFileSync(join(dist, `states.${variant}.html`), fixture.replace("../../dist/startr.css", variant));
    }
    chrome = await launch();
  }, 120_000);

  afterAll(async () => {
    await chrome?.close();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  describe.each(VARIANTS)("in %s", (variant) => {
    let page: Page;

    beforeAll(async () => {
      page = await chrome.newPage(`file://${join(dist, `states.${variant}.html`)}`);
      await page.setViewport(1024);
    }, 30_000);

    afterAll(async () => {
      await page?.close();
    });

    // A state forced in one test must not leak into the next.
    afterEach(async () => {
      await page.clearForcedStates();
    });

    // --- helpers -------------------------------------------------------------------------------

    /** Force pseudo-classes on an element for the length of fn, then clear them. */
    async function forced<T>(selector: string, states: string[], fn: () => Promise<T>): Promise<T> {
      await page.forcePseudoState(selector, states);
      try {
        return await fn();
      } finally {
        await page.forcePseudoState(selector, []);
      }
    }
    const bg = (selector: string) => page.style(selector, "background-color");
    const lab = (html: string) => page.eval(`document.querySelector('#lab').innerHTML = ${JSON.stringify(html)}`);
    /** Make the keyboard the last input and start Tab from a known place. */
    const tabFrom = async (anchor: string) => {
      await page.eval(`document.querySelector(${JSON.stringify(anchor)}).focus()`);
      await page.press("Tab");
    };
    const active = () => page.eval<string>("document.activeElement.id");

    // --- the simple cases ----------------------------------------------------------------------

    test("--bg-hover shows on hover and not before", async () => {
      expect(await bg("#hover")).toBe(WHITE);
      expect(await forced("#hover", ["hover"], () => bg("#hover"))).toBe(rgb(0, 128, 0));
      expect(await bg("#hover")).toBe(WHITE);
    });

    test("the old --hvr-bg now beats --bg on hover", async () => {
      expect(await bg("#legacy")).toBe(WHITE);
      expect(await forced("#legacy", ["hover"], () => bg("#legacy"))).toBe(rgb(0, 0, 255));
    });

    test("a tier plus a state: the state wins; the tier still beats the base", async () => {
      await page.setViewport(1024);
      expect(await bg("#tier")).toBe(rgb(2, 0, 0));
      expect(await forced("#tier", ["hover"], () => bg("#tier"))).toBe(rgb(3, 0, 0));
      await page.setViewport(500);
      expect(await bg("#tier")).toBe(rgb(1, 0, 0));
      expect(await forced("#tier", ["hover"], () => bg("#tier"))).toBe(rgb(3, 0, 0));
      await page.setViewport(1024);
    });

    test("--bg-active shows while the real mouse button is held", async () => {
      expect(await bg("#press")).toBe(WHITE);
      expect(await forced("#press", ["active"], () => bg("#press"))).toBe(rgb(9, 9, 9));
      const { x, y } = await page.eval<{ x: number; y: number }>(
        "(() => { const r = document.querySelector('#press').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()",
      );
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      expect(await bg("#press")).toBe(rgb(9, 9, 9));
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      await page.hover("#rh-away");
      expect(await bg("#press")).toBe(WHITE);
    });

    test("--c-in-hover follows a really hovered parent", async () => {
      await page.hover("#rh-away");
      expect(await page.style("#rh-child", "color")).toBe(BLACK);
      await page.hover("#rh-parent");
      expect(await page.style("#rh-child", "color")).toBe(rgb(0, 0, 200));
      await page.hover("#rh-away");
      expect(await page.style("#rh-child", "color")).toBe(BLACK);
    });

    // --- the keyboard ----------------------------------------------------------------------------

    test("--oe-focus and --oo show on keyboard focus", async () => {
      await tabFrom("#kbd-anchor");
      expect(await active()).toBe("kbd-focus");
      expect(await page.style("#kbd-focus", "outline-color")).toBe(rgb(0, 0, 255));
      expect(await page.style("#kbd-focus", "outline-style")).toBe("solid");
      expect(await page.style("#kbd-focus", "outline-width")).toBe("3px");
      expect(await page.style("#kbd-focus", "outline-offset")).toBe("2px");
    });

    test("keyboard users get the hover look: --c-hover shows on :focus-visible", async () => {
      expect(await page.style("#kbd-hover", "color")).toBe(BLACK);
      await tabFrom("#kbd-focus");
      expect(await active()).toBe("kbd-hover");
      expect(await page.style("#kbd-hover", "color")).toBe(rgb(200, 0, 0));
    });

    test("a current item that is also hovered and focused: focus shows, hover does not", async () => {
      // current alone: --bg-on. Hover does not change it.
      expect(await bg("#kbd-both")).toBe(rgb(2, 2, 2));
      expect(await forced("#kbd-both", ["hover"], () => bg("#kbd-both"))).toBe(rgb(2, 2, 2));
      // keyboard focus on top of it: --bg-focus
      await tabFrom("#kbd-hover");
      expect(await active()).toBe("kbd-both");
      expect(await bg("#kbd-both")).toBe(rgb(3, 3, 3));
      expect(await forced("#kbd-both", ["hover"], () => bg("#kbd-both"))).toBe(rgb(3, 3, 3));
      await page.eval("document.activeElement.blur()");
      expect(await bg("#kbd-both")).toBe(rgb(2, 2, 2));
    });

    test("focus is :focus-visible: a mouse click on a button does not draw --oe-focus", async () => {
      await page.eval("document.activeElement && document.activeElement.blur()");
      await page.click("#click-me");
      expect(await active()).toBe("click-me");
      expect(await page.eval("document.activeElement.matches(':focus-visible')")).toBe(false);
      expect(await page.style("#click-me", "outline-color")).not.toBe(rgb(0, 0, 255));
      await page.eval("document.activeElement.blur()");
    });

    // --- on and in-on ----------------------------------------------------------------------------

    // [attribute text, is it on?]
    const ON: Array<[string, boolean]> = [
      ['aria-current="page"', true],
      ['aria-current="true"', true],
      ['aria-current="step"', true],
      ['aria-current="location"', true],
      ['aria-current="date"', true],
      ['aria-current="time"', true],
      ['aria-current="false"', false],
      ['aria-current=""', false],
      ["", false],
      ['aria-selected="true"', true],
      ['aria-selected="false"', false],
      ['aria-pressed="true"', true],
      ['aria-pressed="false"', false],
      ['aria-pressed="mixed"', false],
      ['aria-expanded="true"', true],
      ['aria-expanded="false"', false],
      ["data-on", true],
      ['data-on=""', true],
      ['data-on="true"', true],
      ['data-on="false"', false],
    ];

    test.each(ON)("on: <div %s> is on = %p", async (attribute, isOn) => {
      await lab(`<div id="e" ${attribute} style="--op-on:0.5">x</div>`);
      expect(await page.style("#e", "opacity")).toBe(isOn ? "0.5" : "1");
    });

    test.each(ON)("in-on: a child of <div %s> follows = %p", async (attribute, isOn) => {
      await lab(`<div ${attribute}><span id="e" style="--op-in-on:0.25">x</span></div>`);
      expect(await page.style("#e", "opacity")).toBe(isOn ? "0.25" : "1");
    });

    test("on: [open] (details, dialog) and :checked (checkbox) count as on", async () => {
      await lab(`
        <details id="d1" open style="--op-on:0.5"><summary>x</summary></details>
        <details id="d2" style="--op-on:0.5"><summary>x</summary></details>
        <dialog id="g1" open style="--op-on:0.5">x</dialog>
        <input id="c1" type="checkbox" checked style="--op-on:0.5">
        <input id="c2" type="checkbox" style="--op-on:0.5">`);
      expect(await page.style("#d1", "opacity")).toBe("0.5");
      expect(await page.style("#d2", "opacity")).toBe("1");
      expect(await page.style("#g1", "opacity")).toBe("0.5");
      expect(await page.style("#c1", "opacity")).toBe("0.5");
      expect(await page.style("#c2", "opacity")).toBe("1");
      await page.eval("document.querySelector('#c2').checked = true; document.querySelector('#d2').open = true");
      expect(await page.style("#c2", "opacity")).toBe("0.5");
      expect(await page.style("#d2", "opacity")).toBe("0.5");
    });

    test("a state follows the attribute live: removing aria-current turns --bg-on off", async () => {
      await lab(`<a id="e" href="#e" aria-current="page" style="--bg-on:rgb(2,2,2)">x</a>`);
      expect(await bg("#e")).toBe(rgb(2, 2, 2));
      await page.eval("document.querySelector('#e').removeAttribute('aria-current')");
      expect(await bg("#e")).not.toBe(rgb(2, 2, 2));
      await page.eval("document.querySelector('#e').setAttribute('aria-current', 'false')");
      expect(await bg("#e")).not.toBe(rgb(2, 2, 2));
    });

    test("details[open] reaches a direct child, not a grandchild", async () => {
      const green = rgb(0, 128, 0);
      expect(await page.style("#det-child", "color")).toBe(green);
      expect(await page.style("#det-div", "color")).toBe(green);
      expect(await page.style("#det-grand", "color")).toBe(BLACK);
      // closed: nothing. Open it and the direct child follows.
      expect(await page.style("#det-shut-child", "color")).toBe(BLACK);
      await page.eval("document.querySelector('#det-shut').open = true");
      expect(await page.style("#det-shut-child", "color")).toBe(green);
      await page.eval("document.querySelector('#det-shut').open = false");
      expect(await page.style("#det-shut-child", "color")).toBe(BLACK);
    });

    test("parent state reaches direct children only, for hover too", async () => {
      await lab(`
        <div id="p"><div id="mid"><span id="grand" style="--c:rgb(0,0,0); --c-in-hover:rgb(0,0,200)">x</span></div>
        <span id="kid" style="--c:rgb(0,0,0); --c-in-hover:rgb(0,0,200)">y</span></div>`);
      await page.forcePseudoState("#p", ["hover"]);
      expect(await page.style("#kid", "color")).toBe(rgb(0, 0, 200));
      expect(await page.style("#grand", "color")).toBe(BLACK);
      await page.forcePseudoState("#p", []);
    });

    // --- the ladder ------------------------------------------------------------------------------

    test("the ladder: base < tier < in-hover < hover < in-on < on < focus < active", async () => {
      await page.setViewport(1024);
      const read = () => bg("#ladder");
      const steps: Array<[string, () => Promise<void>, number]> = [
        ["tier", async () => {}, 2],
        ["in-hover", () => page.forcePseudoState("#ladder-parent", ["hover"]), 3],
        ["hover", () => page.forcePseudoState("#ladder", ["hover"]), 4],
        ["in-on", () => page.eval("document.querySelector('#ladder-parent').setAttribute('data-on', '')"), 5],
        ["on", () => page.eval("document.querySelector('#ladder').setAttribute('data-on', '')"), 6],
        ["focus", () => page.forcePseudoState("#ladder", ["hover", "focus-visible"]), 7],
        ["active", () => page.forcePseudoState("#ladder", ["hover", "focus-visible", "active"]), 8],
      ];
      expect(await read()).toBe(rgb(2, 0, 0));
      for (const [name, apply, level] of steps) {
        await apply();
        expect([name, await read()]).toEqual([name, rgb(level, 0, 0)]);
      }
      // And back down, one state at a time, from the top.
      const down: Array<[string, () => Promise<void>, number]> = [
        ["active off", () => page.forcePseudoState("#ladder", ["hover", "focus-visible"]), 7],
        ["focus off", () => page.forcePseudoState("#ladder", ["hover"]), 6],
        ["on off", () => page.eval("document.querySelector('#ladder').removeAttribute('data-on')"), 5],
        ["in-on off", () => page.eval("document.querySelector('#ladder-parent').removeAttribute('data-on')"), 4],
        ["hover off", () => page.forcePseudoState("#ladder", []), 3],
        ["in-hover off", () => page.forcePseudoState("#ladder-parent", []), 2],
      ];
      for (const [name, apply, level] of down) {
        await apply();
        expect([name, await read()]).toEqual([name, rgb(level, 0, 0)]);
      }
      // Below the md tier only the base is left.
      await page.setViewport(500);
      expect(await read()).toBe(rgb(1, 0, 0));
      await page.setViewport(1024);
    });

    test("self beats parent when both are hover-like: hover over in-hover, in either input mode", async () => {
      const both = `style="--c:rgb(0,0,0); --c-in-hover:rgb(0,0,100); --c-hover:rgb(0,0,200)"`;
      await lab(`<div id="p"><a id="e" href="#e" ${both}>x</a></div>`);
      // parent hovered, child keyboard-focused: the child's own look wins (the case the @media (min-width:0) wrapper is for)
      await page.forcePseudoState("#p", ["hover"]);
      expect(await page.style("#e", "color")).toBe(rgb(0, 0, 100));
      await page.forcePseudoState("#e", ["focus-visible"]);
      expect(await page.style("#e", "color")).toBe(rgb(0, 0, 200));
      await page.forcePseudoState("#e", []);
      await page.forcePseudoState("#p", []);
      // parent keyboard-focused, child hovered: the child's own look wins
      await page.forcePseudoState("#p", ["focus-visible"]);
      expect(await page.style("#e", "color")).toBe(rgb(0, 0, 100));
      await page.forcePseudoState("#e", ["hover"]);
      expect(await page.style("#e", "color")).toBe(rgb(0, 0, 200));
      await page.forcePseudoState("#e", []);
      await page.forcePseudoState("#p", []);
    });

    test("the old --hvr-c ranks with --c-hover: --c-hover wins, --c-in-hover loses", async () => {
      await lab(`
        <div id="p"><span id="a" style="--c:rgb(0,0,0); --hvr-c:rgb(0,100,0); --c-hover:rgb(0,200,0)">x</span>
        <span id="b" style="--c:rgb(0,0,0); --hvr-c:rgb(0,100,0); --c-in-hover:rgb(0,0,200)">y</span></div>`);
      await page.forcePseudoState("#p", ["hover"]);
      await page.forcePseudoState("#a", ["hover"]);
      await page.forcePseudoState("#b", ["hover"]);
      expect(await page.style("#a", "color")).toBe(rgb(0, 200, 0));
      expect(await page.style("#b", "color")).toBe(rgb(0, 100, 0));
    });

    // --- every prop in every state ---------------------------------------------------------------

    // stem, the value written into the style attribute, the property read back, and the expected computed value
    const PAINT: Array<{ stem: string; value: string; read: string; want: string }> = [
      { stem: "bg", value: "rgb(11, 22, 33)", read: "background-color", want: rgb(11, 22, 33) },
      { stem: "bgc", value: "rgb(12, 23, 34)", read: "background-color", want: rgb(12, 23, 34) },
      { stem: "c", value: "rgb(13, 24, 35)", read: "color", want: rgb(13, 24, 35) },
      { stem: "b", value: "3px solid rgb(14, 25, 36)", read: "border-top-color", want: rgb(14, 25, 36) },
      { stem: "bc", value: "rgb(15, 26, 37)", read: "border-top-color", want: rgb(15, 26, 37) },
      { stem: "boxs", value: "rgb(16, 27, 38) 1px 2px 3px 0px", read: "box-shadow", want: "rgb(16, 27, 38) 1px 2px 3px 0px" },
      { stem: "op", value: "0.5", read: "opacity", want: "0.5" },
      { stem: "t", value: "translateX(10px)", read: "transform", want: "matrix(1, 0, 0, 1, 10, 0)" },
      { stem: "oe", value: "2px solid rgb(17, 28, 39)", read: "outline-color", want: rgb(17, 28, 39) },
    ];
    const STATES = ["hover", "in-hover", "in-on", "on", "focus", "active"] as const;
    const cases = PAINT.flatMap((paint) => STATES.map((state) => [paint.stem, state, paint] as const));

    test.each(cases)("--%s-%s sets its property when the state holds, and only then", async (stem, state, paint) => {
      const style = `--${stem}-${state}: ${paint.value}`;
      const attr = state === "on" ? "data-on" : "";
      await lab(
        state === "in-hover" || state === "in-on"
          ? `<div id="p" ${state === "in-on" ? "data-on" : ""}><span id="e" style="${style}">x</span></div>`
          : `<div id="e" ${attr} style="${style}">x</div>`,
      );
      const read = () => page.style("#e", paint.read);
      const before = await read();
      if (state === "on" || state === "in-on") {
        // These two hold from the markup. Take the state away to see the control value.
        await page.eval(`document.querySelector(${state === "on" ? "'#e'" : "'#p'"}).removeAttribute('data-on')`);
        expect(await read()).not.toBe(paint.want);
        await page.eval(`document.querySelector(${state === "on" ? "'#e'" : "'#p'"}).setAttribute('data-on', '')`);
        expect(await read()).toBe(paint.want);
        expect(before).toBe(paint.want);
        return;
      }
      expect(before).not.toBe(paint.want);
      if (state === "in-hover") {
        await page.forcePseudoState("#p", ["hover"]);
      } else {
        await page.forcePseudoState("#e", [state === "focus" ? "focus-visible" : state]);
      }
      expect(await read()).toBe(paint.want);
    });

    // --- touch: no hover, but the keyboard still counts ------------------------------------------

    test("on a device that cannot hover, :hover is ignored and :focus-visible still brings the look", async () => {
      await page.setViewport(400, 800, true);
      try {
        expect(await page.eval("matchMedia('(hover:none)').matches")).toBe(true);
        // --bg-hover, --hvr-bg: a sticky :hover after a tap changes nothing
        expect(await forced("#hover", ["hover"], () => bg("#hover"))).toBe(WHITE);
        expect(await forced("#legacy", ["hover"], () => bg("#legacy"))).toBe(WHITE);
        // ... but a keyboard focus still gives the hover look
        expect(await forced("#hover", ["focus-visible"], () => bg("#hover"))).toBe(rgb(0, 128, 0));
        // in-hover: the same two halves
        await page.forcePseudoState("#rh-parent", ["hover"]);
        expect(await page.style("#rh-child", "color")).toBe(BLACK);
        await page.forcePseudoState("#rh-parent", ["focus-visible"]);
        expect(await page.style("#rh-child", "color")).toBe(rgb(0, 0, 200));
        await page.forcePseudoState("#rh-parent", []);
        // focus and active have no hover in them
        expect(await forced("#ladder", ["focus-visible"], () => bg("#ladder"))).toBe(rgb(7, 0, 0));
        expect(await forced("#ladder", ["active"], () => bg("#ladder"))).toBe(rgb(8, 0, 0));
      } finally {
        await page.setViewport(1024, 800, false);
      }
      expect(await page.eval("matchMedia('(hover:hover)').matches")).toBe(true);
    });

    // --- --ttf and --oo --------------------------------------------------------------------------

    test("--ttf sets the timing function; the old single-dash -ttf does nothing", async () => {
      await lab(`<div id="a" style="--ttf: linear">x</div><div id="b" style="-ttf: linear">y</div>`);
      expect(await page.style("#a", "transition-timing-function")).toBe("linear");
      expect(await page.style("#b", "transition-timing-function")).toBe("ease");
    });

    test("--oo sets outline-offset, with tiers", async () => {
      await lab(`<div id="a" style="--oo: 4px; --oo-md: 8px">x</div>`);
      await page.setViewport(500);
      expect(await page.style("#a", "outline-offset")).toBe("4px");
      await page.setViewport(1024);
      expect(await page.style("#a", "outline-offset")).toBe("8px");
    });

    // --- the hover helpers and their -hover twins ------------------------------------------------

    const HELPERS: Array<[string, string]> = [
      ["levitate", "5"],
      ["shadow", "5"],
      ["translate", "10px"],
      ["translatex", "10px"],
      ["translatey", "10px"],
      ["scale", "1.5"],
      ["rotate", "45deg"],
      ["skew", "10deg"],
    ];

    const look = (selector: string) =>
      page.eval<[string, string]>(
        `(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)})); return [s.transform, s.boxShadow]; })()`,
      );

    for (const [name, value] of HELPERS) {
      test(`--${name}-hover and the deprecated --${name}-hvr look the same on hover and on keyboard focus`, async () => {
        await lab(`
          <div id="old" style="--${name}-hvr: ${value}">old</div>
          <div id="new" style="--${name}-hover: ${value}">new</div>`);
        const rest = await look("#new");
        expect(await look("#old")).toEqual(rest);
        for (const trigger of ["hover", "focus-visible"]) {
          const old = await forced("#old", [trigger], () => look("#old"));
          const twin = await forced("#new", [trigger], () => look("#new"));
          expect(twin).toEqual(old);
          expect(twin).not.toEqual(rest);
        }
      });
    }

    test("when an element gives both the old and the new name, the new one wins", async () => {
      await lab(`
        <div id="both" style="--shadow-hvr: 5; --shadow-hover: 10">both</div>
        <div id="new" style="--shadow-hover: 10">new</div>
        <div id="old" style="--shadow-hvr: 5">old</div>`);
      const both = await forced("#both", ["hover"], () => look("#both"));
      expect(both).toEqual(await forced("#new", ["hover"], () => look("#new")));
      expect(both).not.toEqual(await forced("#old", ["hover"], () => look("#old")));
    });

    test("old and new transform names compose on one element", async () => {
      await lab(`<div id="mixed" style="--translate-hvr: 10px; --scale-hover: 1.5">x</div>`);
      expect(await forced("#mixed", ["hover"], () => page.style("#mixed", "transform"))).toBe("matrix(1.5, 0, 0, 1.5, 10, 0)");
      expect(await page.style("#mixed", "transform")).toBe("none");
    });

    test("a -hover helper does not fire on a device that cannot hover, but does on keyboard focus", async () => {
      await lab(`<div id="e" style="--translate-hover: 10px">x</div>`);
      await page.setViewport(400, 800, true);
      try {
        expect(await forced("#e", ["hover"], () => page.style("#e", "transform"))).toBe("none");
        expect(await forced("#e", ["focus-visible"], () => page.style("#e", "transform"))).toBe("matrix(1, 0, 0, 1, 10, 0)");
      } finally {
        await page.setViewport(1024, 800, false);
      }
    });
  });
});
