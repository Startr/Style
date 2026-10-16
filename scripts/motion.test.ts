// Motion and effects: --anim and its keyframes, the reduced-motion guard,
// --text-grad, --bdf and --glow.
//
// The test builds the sheets into a temp dir (never dist/) and copies
// test/fixtures/motion.html to the same relative place in it, so the page's link
// to ../../dist/startr.min.css works. One headless Chrome runs it over
// scripts/cdp.ts. Reduced motion is emulated per page (Emulation.setEmulatedMedia),
// so the same page runs both ways.
//
// What it proves, and how it keeps from passing for nothing:
//   - Motion is real. A ten-second fade is read twice and has to move between
//     the reads. Keyframes are sampled by seeking. Hover transitions come from
//     the real mouse.
//   - The guard has teeth. Every reduced-motion check has a normal-motion twin
//     that shows the same probe moving. At the end the guard's own rules are cut
//     out of the sheet, and the page has to move again under reduced motion.
//   - The guard wins by specificity, not by position: the fixture adds a later
//     !important rule at (0,1,0) that moves two probes, and the guard still wins.
//   - The guard keeps up with the sheet. A browser-free check walks the built CSS
//     and fails when a --anim tier or a hover helper is missing from the guard.
//   - The glow fallback is cut the same way: with the @supports block removed
//     the shadow has to be the literal purple.
//
// No Chrome (see CHROME_BIN in scripts/cdp.ts): the browser tests skip with a
// warning, or fail when STARTR_REQUIRE_CHROME is set. The sheet check still runs.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import { findChrome, launch, type Chrome, type Page } from "./cdp";

setDefaultTimeout(30_000);

const root = join(import.meta.dir, "..");
const hasChrome = findChrome() !== null;
if (!hasChrome) {
  const message = "motion.test.ts: no Chrome found (set CHROME_BIN); the browser tests are skipped.";
  if (process.env.STARTR_REQUIRE_CHROME) throw new Error(message);
  console.warn(message);
}

// One width per breakpoint, each inside its band: base, sm 640, md 768, lg 1024, xl 1280.
const WIDTHS = { base: 400, sm: 700, md: 900, lg: 1100, xl: 1400 } as const;
type Tier = keyof typeof WIDTHS;
const TIERS = Object.keys(WIDTHS) as Tier[];

let work = "";
let chrome: Chrome;
let page: Page;
let css = ""; // startr.min.css, the shipped sheet
let sheet = ""; // startr.css, the same before minifying

const J = JSON.stringify;
const sleep = (ms: number) => Bun.sleep(ms);

/** Read until the value is wanted: an animation starts on the first frame, which a busy machine delays. */
async function until<T>(read: () => Promise<T>, wanted: (value: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (wanted(value) || Date.now() > end) return value;
    await sleep(50);
  }
}

/** Computed values of some properties of one probe (camelCase names). */
function cs(id: string, props: string[]): Promise<Record<string, string>> {
  return page.eval(
    `(() => { const c = getComputedStyle(document.getElementById(${J(id)})); return Object.fromEntries(${J(props)}.map((p) => [p, c[p]])); })()`,
  );
}

/** Pause a probe's animation at some time and read properties there. */
function seek(id: string, ms: number, props: string[]): Promise<Record<string, string>> {
  return page.eval(
    `(() => { const e = document.getElementById(${J(id)}); const a = e.getAnimations()[0]; a.pause(); a.currentTime = ${ms};
       const c = getComputedStyle(e); return Object.fromEntries(${J(props)}.map((p) => [p, c[p]])); })()`,
  );
}

/** What is animating a probe right now: [kind, property or name]. */
function running(id: string): Promise<[string, string][]> {
  return page.eval(
    `document.getElementById(${J(id)}).getAnimations().map((a) => [a.constructor.name, a.transitionProperty ?? a.animationName])`,
  );
}

/** A computed translate as [x, y]: "0px 3px", "0px" (Chrome drops a zero y) or "none". */
const pair = (value: string): number[] => {
  const [x = 0, y = 0] = value === "none" ? [] : value.split(" ").map(parseFloat);
  return [x, y];
};

/** Resize the viewport to one breakpoint's width. Media queries follow it. */
async function at(tier: Tier) {
  await page.setViewport(WIDTHS[tier], 900);
}

async function openFixture(reduce: boolean) {
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }],
  });
  await page.setViewport(WIDTHS.xl, 900);
  await page.goto("file://" + join(work, "test/fixtures/motion.html"));
  await page.send("Page.bringToFront");
}

/** Swap the built sheet for another text, in the same place in the cascade. */
function swapSheet(text: string) {
  return page.eval(
    `(() => { const link = document.querySelector('link[rel=stylesheet]'); link.disabled = true;
       const style = document.createElement('style'); style.textContent = ${J(text)}; link.after(style); })()`,
  );
}

/** A screenshot of the viewport, as a canvas context inside the page. Pixels come back through px(). */
async function snapshot(): Promise<void> {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  await page.eval(
    `(async () => { const blob = await (await fetch('data:image/png;base64,${data}')).blob();
       const bmp = await createImageBitmap(blob); const cv = new OffscreenCanvas(bmp.width, bmp.height);
       const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0); window.__shot = ctx; })()`,
  );
}

async function scrollTo(id: string) {
  await page.eval(`document.getElementById(${J(id)}).scrollIntoView({ block: 'center' })`);
}

const rect = (id: string): Promise<{ x: number; y: number; width: number; height: number }> =>
  page.eval(`(() => { const r = document.getElementById(${J(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);

/** The pixel at viewport x, y of the last snapshot: [r, g, b]. */
const px = (x: number, y: number): Promise<number[]> =>
  page.eval(`Array.from(window.__shot.getImageData(${Math.round(x)}, ${Math.round(y)}, 1, 1).data).slice(0, 3)`);

/** The non-white pixels in a box of the last snapshot, summed per third of its width. */
async function inkByThird(box: { x: number; y: number; width: number; height: number }) {
  return page.eval<{ r: number; b: number; n: number; dark: number }[]>(
    `(() => { const { x, y, width, height } = ${J(box)}; const out = [];
       for (let t = 0; t < 3; t++) {
         const x0 = Math.round(x + (width * t) / 3), w = Math.max(1, Math.round(width / 3));
         const d = window.__shot.getImageData(x0, Math.round(y), w, Math.round(height)).data;
         let r = 0, b = 0, n = 0, dark = 0;
         for (let i = 0; i < d.length; i += 4) {
           if (d[i] + d[i + 1] + d[i + 2] > 600) continue;
           r += d[i]; b += d[i + 2]; n++; if (d[i] + d[i + 1] + d[i + 2] < 270) dark++;
         }
         out.push({ r: n ? r / n : 0, b: n ? b / n : 0, n, dark });
       }
       return out; })()`,
  );
}

/** Parse a computed box-shadow into its layers: [r, g, b, alpha, blur] with channels 0..1. */
async function layers(id: string): Promise<number[][]> {
  const { boxShadow } = await cs(id, ["boxShadow"]);
  // Chrome serialises color-mix() as color(srgb r g b / a) and rgba() as rgba(r, g, b, a).
  const out: number[][] = [];
  const re = /(color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)|rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/g;
  for (const m of boxShadow.matchAll(re)) {
    const srgb = m[2] !== undefined;
    const [r, g, b] = srgb ? [m[2], m[3], m[4]].map(Number) : [m[6], m[7], m[8]].map((v) => Number(v) / 255);
    const alpha = srgb ? Number(m[5] ?? 1) : Number(m[9] ?? 1);
    out.push([r, g, b, alpha, Number(m[12])]);
  }
  return out;
}

async function moveAway() {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
}

/** Hover a probe with the real mouse and report what moves and what it shows. No wait: the read
 *  flushes style, so a transition has just begun and a slow machine cannot finish it first. */
async function hoverShows(id: string) {
  await scrollTo(id);
  await page.hover("#" + id);
  const state = await page.eval<{ moving: string[]; boxShadow: string; transform: string }>(
    `(() => { const e = document.getElementById(${J(id)}); const c = getComputedStyle(e);
       return { moving: e.getAnimations().filter((a) => a.constructor.name === 'CSSTransition').map((a) => a.transitionProperty).sort(),
                boxShadow: c.boxShadow, transform: c.transform }; })()`,
  );
  await moveAway();
  return state;
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "startr-motion-"));
  const build = Bun.spawn([process.execPath, "run", "build.ts"], {
    cwd: root,
    env: { ...process.env, STARTR_DIST: join(work, "dist") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, , stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
  if (code !== 0) throw new Error(`build failed (${code}):\n${stderr}`);
  css = readFileSync(join(work, "dist/startr.min.css"), "utf8");
  sheet = readFileSync(join(work, "dist/startr.css"), "utf8");
  if (!hasChrome) return;
  mkdirSync(join(work, "test/fixtures"), { recursive: true });
  copyFileSync(join(root, "test/fixtures/motion.html"), join(work, "test/fixtures/motion.html"));
  chrome = await launch();
  page = await chrome.newPage();
}, 120_000);

afterAll(async () => {
  await chrome?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

// The guard lists its selectors by hand, so this walks the built sheet and checks that
// it still covers every inline prop that starts or times motion. A new tier, or a new
// helper with a transition, fails here until the guard names it. No browser needed.
describe("the reduced-motion guard covers every motion prop in the sheet", () => {
  // transition-delay and transition-timing-function (--td, --ttf) cannot start motion
  // on their own, so the guard leaves them be.
  const TIMING = new Set(["transition-delay", "transition-timing-function"]);

  function scan() {
    const guarded = new Set<string>();
    const moving = new Map<string, string[]>(); // [style*="…"] value -> the motion properties it sets
    postcss.parse(sheet).walkRules((rule: Rule) => {
      const parent = rule.parent as AtRule | undefined;
      const inGuard = parent?.type === "atrule" && parent.name === "media" && /prefers-reduced-motion/.test(parent.params);
      const attrs = [...rule.selector.matchAll(/\[style\*="([^"]+)"\]/g)].map((m) => m[1]);
      if (inGuard) return void attrs.forEach((a) => guarded.add(a));
      const props: string[] = [];
      rule.walkDecls((d) => {
        const prop = d.prop.replace(/^-\w+-/, "");
        if (/^(animation|transition)(-|$)/.test(prop) && !TIMING.has(prop)) props.push(prop);
      });
      if (props.length) for (const a of attrs) moving.set(a, [...(moving.get(a) ?? []), ...props]);
    });
    return { guarded, moving };
  }

  // The guard names a whole family by its ending: -hvr: and -hover: (one leading dash).
  const covers = (guarded: Set<string>, name: string) =>
    guarded.has(name) || [...guarded].some((g) => !g.startsWith("--") && name.endsWith(g));

  test("every --anim, --tn, --tdn, --tp tier and every hover helper is in the guard", () => {
    const { guarded, moving } = scan();
    // The walk has to see what it should, or an empty list would pass for nothing.
    for (const name of ["--anim:", "--anim-xl:", "--tn:", "--tn-pt:", "--tdn-md:", "--tp-sm:", "--shadow-hvr:", "--shadow-hover:", "--translate-hover:"]) {
      expect([...moving.keys()]).toContain(name);
    }
    expect(moving.size).toBeGreaterThan(25);
    const missing = [...moving.keys()].filter((name) => !covers(guarded, name));
    expect(missing).toEqual([]);
  });

  test("the timing-only props are left out on purpose", () => {
    const { moving } = scan();
    expect([...moving.keys()].filter((n) => /^-{1,2}(td|ttf):|^--(td|ttf)-/.test(n))).toEqual([]);
  });
});

const suite = hasChrome ? describe : describe.skip;

suite("normal motion", () => {
  beforeAll(() => openFixture(false));

  test("the page is not in reduced motion, and has a mouse", async () => {
    const media = await page.eval<[boolean, boolean]>(
      "[matchMedia('(prefers-reduced-motion: reduce)').matches, matchMedia('(hover: hover)').matches]",
    );
    expect(media).toEqual([false, true]);
  });

  test("--anim applies st-rise, with the stagger inside the shorthand", async () => {
    // The durations come from the tokens, so read them from the page instead of
    // pinning their values here. A probe with the same tokens gives the normalised form.
    const tokens = await page.eval<{ animationDuration: string; animationTimingFunction: string }>(
      `(() => { const t = document.createElement('div');
         t.style.animationDuration = 'var(--dur-3)'; t.style.animationTimingFunction = 'var(--ease-out)';
         document.body.append(t); const c = getComputedStyle(t);
         const out = { animationDuration: c.animationDuration, animationTimingFunction: c.animationTimingFunction };
         t.remove(); return out; })()`,
    );
    expect(tokens.animationDuration).not.toBe("0s"); // the token exists
    const c = await cs("a-rise", [
      "animationName", "animationDuration", "animationDelay", "animationFillMode", "animationTimingFunction",
    ]);
    expect(c).toEqual({
      animationName: "st-rise",
      ...tokens,
      animationDelay: "0.135s", // calc(3 * 45ms)
      animationFillMode: "both",
    });
    expect(await running("a-rise")).toEqual([["CSSAnimation", "st-rise"]]);
    expect((await cs("a-none", ["animationName"])).animationName).toBe("none");
  });

  test("an animation really runs: a ten-second fade moves between two reads", async () => {
    const read = () =>
      page.eval<{ state: string; time: number; opacity: number }>(
        `(() => { const e = document.getElementById('a-live'); const a = e.getAnimations()[0];
           return { state: a.playState, time: a.currentTime ?? 0, opacity: Number(getComputedStyle(e).opacity) }; })()`,
      );
    const first = await until(read, (s) => s.time > 0);
    await sleep(300);
    const second = await read();
    expect(second.state).toBe("running");
    expect(second.time).toBeGreaterThan(first.time + 100);
    expect(second.opacity).toBeGreaterThan(first.opacity);
    expect(second.opacity).toBeGreaterThan(0);
    expect(second.opacity).toBeLessThan(0.5); // ten seconds, linear
  });

  test("--anim has a rule per breakpoint", async () => {
    const seen: Record<string, string> = {};
    for (const tier of TIERS) {
      await at(tier);
      seen[tier] = (await cs("a-tiers", ["animationDuration"])).animationDuration;
    }
    expect(seen).toEqual({ base: "10s", sm: "9s", md: "8s", lg: "7s", xl: "6s" });
    await at("xl");
  });

  test("st-fade runs from 0 to the element's own opacity", async () => {
    const props = ["opacity", "transform", "translate", "scale"];
    expect(await seek("k-fade", 0, props)).toMatchObject({ opacity: "0", transform: "none" });
    expect(await seek("k-fade", 5000, props)).toMatchObject({ opacity: "0.5" });
    expect(await seek("k-fade", 10000, props)).toMatchObject({ opacity: "1", transform: "none", translate: "none", scale: "none" });
  });

  test("st-rise moves up 6px into place", async () => {
    const props = ["opacity", "transform", "translate"];
    const from = await seek("k-rise", 0, props);
    expect(from.opacity).toBe("0");
    expect(pair(from.translate)).toEqual([0, 6]);
    expect(pair((await seek("k-rise", 5000, props)).translate)).toEqual([0, 3]);
    const to = await seek("k-rise", 10000, props);
    expect(to.opacity).toBe("1");
    expect(pair(to.translate)).toEqual([0, 0]);
    expect(from.transform).toBe("none"); // it moves through translate, not transform
  });

  test("st-slide-in starts at the inline end: right in LTR, left in RTL, right again in an LTR island", async () => {
    const ltr = pair((await seek("k-slide", 0, ["translate"])).translate);
    const rtl = pair((await seek("k-slide-rtl", 0, ["translate"])).translate);
    const island = pair((await seek("k-slide-island", 0, ["translate"])).translate);
    expect(ltr[0]).toBeGreaterThan(8);
    expect(rtl[0]).toBe(-ltr[0]);
    expect(island[0]).toBe(ltr[0]); // --st-dir does not inherit from the RTL parent
    for (const id of ["k-slide", "k-slide-rtl", "k-slide-island"]) {
      const to = await seek(id, 10000, ["opacity", "translate"]);
      expect(to.opacity).toBe("1");
      expect(pair(to.translate)).toEqual([0, 0]);
      expect((await seek(id, 0, ["opacity"])).opacity).toBe("0");
    }
  });

  test("st-pop scales up from .92", async () => {
    const props = ["opacity", "scale"];
    expect(await seek("k-pop", 0, props)).toEqual({ opacity: "0", scale: "0.92" });
    expect(await seek("k-pop", 5000, props)).toEqual({ opacity: "0.5", scale: "0.96" });
    const end = await seek("k-pop", 10000, props);
    expect(end.opacity).toBe("1");
    expect(end.scale === "none" ? 1 : Number(end.scale)).toBe(1);
  });

  test("a keyframe stacks on --t instead of replacing it", async () => {
    const before = (await seek("k-rise-stack", 0, ["transform", "translate"]));
    const after = (await seek("k-rise-stack", 10000, ["transform", "translate"]));
    expect(before.transform).toStartWith("matrix(0.98"); // rotate(10deg), untouched
    expect(after.transform).toBe(before.transform);
    expect(pair(before.translate)).toEqual([0, 6]);
    expect(pair(after.translate)).toEqual([0, 0]);
  });

  test("--op still beats a keyframe: the cascade ranks important rules above animations", async () => {
    expect((await seek("k-fade-op", 0, ["opacity"])).opacity).toBe("0.5");
  });

  test("a later (0,1,0) !important rule beats the kit when motion is allowed", async () => {
    // These two probes are the guard's worst case. Here they have to move, or the
    // reduced-motion check below would prove nothing.
    expect((await cs("l-anim", ["animationName", "animationDuration"]))).toEqual({ animationName: "st-pop", animationDuration: "7s" });
    expect((await cs("l-tn", ["transitionDuration"])).transitionDuration).toBe("6s");
  });

  test("the transition props set transitions", async () => {
    expect(await cs("x-tn", ["transitionProperty", "transitionDuration"])).toEqual({ transitionProperty: "opacity", transitionDuration: "10s" });
    expect((await cs("x-tdn", ["transitionDuration"])).transitionDuration).toBe("2s");
    expect(await cs("x-tp", ["transitionProperty", "transitionDuration"])).toEqual({ transitionProperty: "transform", transitionDuration: "2s" });
    expect(await cs("h-state", ["transitionProperty", "transitionDuration"])).toEqual({ transitionProperty: "background-color", transitionDuration: "10s" });
  });

  test("--tp picks the property, and component CSS keeps the duration", async () => {
    expect(await cs("x-tp-only", ["transitionProperty", "transitionDuration"])).toEqual({ transitionProperty: "opacity", transitionDuration: "5s" });
  });

  test("--tn has a rule per breakpoint", async () => {
    const seen: Record<string, string> = {};
    for (const tier of TIERS) {
      await at(tier);
      seen[tier] = (await cs("x-tiers", ["transitionDuration"])).transitionDuration;
    }
    expect(seen).toEqual({ base: "0s", sm: "9s", md: "8s", lg: "7s", xl: "6s" });
    await at("xl");
  });

  test("a changed property transitions through --tn and through --tp", async () => {
    await page.eval("document.getElementById('x-tn').style.opacity = '0'");
    expect(await running("x-tn")).toEqual([["CSSTransition", "opacity"]]);
    await page.eval("document.getElementById('x-tp').style.transform = 'scale(2)'");
    expect(await running("x-tp")).toEqual([["CSSTransition", "transform"]]);
    // It moves: opacity leaves 1 for 0 over ten seconds, so it is below 1 and above .5 a moment on.
    const opacity = await until(async () => Number((await cs("x-tn", ["opacity"])).opacity), (v) => v < 1);
    expect(opacity).toBeGreaterThan(0.5);
    expect(opacity).toBeLessThan(1);
  });

  test("the hover helpers transition, in both name families", async () => {
    for (const id of ["h-shadow-hvr", "h-levitate-hvr", "h-translate-hvr", "h-shadow-hover", "h-levitate-hover", "h-translate-hover"]) {
      expect(await cs(id, ["transitionProperty", "transitionDuration"])).toEqual({ transitionProperty: "all", transitionDuration: "0.6s" });
    }
    for (const id of ["h-shadow-hvr", "h-shadow-hover"]) {
      const shown = await hoverShows(id);
      expect(shown.moving).toEqual(["box-shadow"]);
    }
    for (const id of ["h-translate-hvr", "h-translate-hover"]) {
      expect((await hoverShows(id)).moving).toEqual(["transform"]);
    }
  });

  test("--text-grad clips a gradient to the text and leaves the colour alone", async () => {
    const c = await cs("g-text", ["backgroundClip", "webkitBackgroundClip", "backgroundImage", "color"]);
    expect(c.backgroundClip).toBe("text");
    expect(c.webkitBackgroundClip).toBe("text");
    expect(c.backgroundImage).toStartWith("linear-gradient(90deg");
    expect(c.color).toBe("rgb(10, 20, 30)"); // inherited, untouched
    // The author adds --c:transparent to show the gradient.
    expect((await cs("g-text-clear", ["color", "backgroundClip"]))).toEqual({ color: "rgba(0, 0, 0, 0)", backgroundClip: "text" });
  });

  test("--text-grad paints: red to blue across the glyphs with --c:transparent, dark glyphs without", async () => {
    await scrollTo("g-text");
    await snapshot();
    const clear = await inkByThird(await rect("g-text-clear"));
    expect(clear[0].n).toBeGreaterThan(50);
    expect(clear[0].r - clear[0].b).toBeGreaterThan(40); // red end
    expect(clear[2].b - clear[2].r).toBeGreaterThan(40); // blue end
    const plain = await inkByThird(await rect("g-text"));
    expect(plain[1].dark / plain[1].n).toBeGreaterThan(0.3); // its own dark colour shows through
    expect(plain[0].r - plain[0].b).toBeLessThan(40);
  });

  test("--bdf sets backdrop-filter, with a rule per breakpoint", async () => {
    expect((await cs("b-bdf", ["backdropFilter"])).backdropFilter).toBe("blur(6px) saturate(1.4)");
    const seen: Record<string, string> = {};
    for (const tier of TIERS) {
      await at(tier);
      seen[tier] = (await cs("b-tiers", ["backdropFilter"])).backdropFilter;
    }
    expect(seen).toEqual({ base: "blur(1px)", sm: "blur(2px)", md: "blur(3px)", lg: "blur(4px)", xl: "blur(5px)" });
    await at("xl");
  });

  test("--glow renders a coloured shadow of four layers, in --primary by default", async () => {
    const [primary] = [await cs("e-primary", ["color"])].map((c) => c.color.match(/\d+/g)!.map((v) => Number(v) / 255));
    const shadow = await layers("e-glow");
    expect(shadow).toHaveLength(4);
    shadow.forEach(([r, g, b, alpha], i) => {
      expect([r, g, b].map((v) => +v.toFixed(2))).toEqual(primary.map((v) => +v.toFixed(2)));
      expect(alpha).toBeCloseTo(0.2, 2); // 5 * 4%
      expect(shadow[i][4]).toBeCloseTo([3, 6, 12, 22][i], 1); // N * .6, 1.2, 2.4, 4.4 px of blur
    });
  });

  test("--glow grows with N, takes --glow-c, and follows a --primary set in a subtree", async () => {
    const [one, five, ten] = await Promise.all(["e-glow-1", "e-glow", "e-glow-10"].map(layers));
    expect(one[0][3]).toBeLessThan(five[0][3]);
    expect(five[0][3]).toBeLessThan(ten[0][3]);
    expect(one[3][4]).toBeLessThan(five[3][4]);
    expect(five[3][4]).toBeLessThan(ten[3][4]);
    expect((await layers("e-glow-red"))[0].slice(0, 3)).toEqual([1, 0, 0]);
    const green = (await layers("e-glow-theme"))[0];
    expect(green[0]).toBe(0);
    expect(green[1]).toBeCloseTo(0.5, 1);
    expect(green[2]).toBe(0);
  });

  test("--glow paints: the pixel beside the box is tinted, and the page beside it is plain white", async () => {
    await scrollTo("e-glow-10");
    await snapshot();
    const beside = async (id: string) => {
      const r = await rect(id);
      return px(r.x - 3, r.y + r.height / 2);
    };
    const row = await rect("e-glow-10");
    expect(await px(1395, row.y + row.height / 2)).toEqual([255, 255, 255]); // far end of the same row
    const purple = await beside("e-glow-10");
    expect(purple[2] - purple[1]).toBeGreaterThan(25); // blue and red over green: purple on white
    expect(purple[0] - purple[1]).toBeGreaterThan(10);
    const red = await beside("e-glow-red");
    expect(red[0] - red[1]).toBeGreaterThan(15);
    expect(Math.abs(red[1] - red[2])).toBeLessThan(6);
  });

  test("--glow gives way on hover to --shadow-hover and to --boxs-hover", async () => {
    // --glow is not !important, like --levitate and --shadow, so a hover look can replace it.
    for (const [id, colour] of [["e-glow-shadow-hover", [0, 0, 0]], ["e-glow-boxs-hover", [1, 0, 0]]] as const) {
      expect((await layers(id))[0].slice(0, 3).map((v) => +v.toFixed(2))).not.toEqual(colour); // the glow, at rest
      await scrollTo(id);
      await page.hover("#" + id);
      await until(() => running(id), (moving) => moving.length === 0); // the 0.6s hover transition ends
      expect((await layers(id))[0].slice(0, 3)).toEqual(colour);
      await moveAway();
    }
  });

  test("without color-mix the glow falls back to the literal purple", async () => {
    const stripped = css.replace(/@supports \(color:color-mix\(in srgb,red,blue\)\)\{\[style\*="--glow:"\]\{[^{}]*\}\}/, "");
    expect(stripped.length).toBeLessThan(css.length); // the swap below cuts a real block
    await swapSheet(stripped);
    const shadow = await layers("e-glow");
    expect(shadow).toHaveLength(4);
    expect(shadow[0].map((v) => +v.toFixed(2))).toEqual([+(71 / 255).toFixed(2), +(1 / 255).toFixed(2), +(131 / 255).toFixed(2), 0.2, 3]);
    expect((await layers("e-glow-red"))[0].slice(0, 3).map((v) => +v.toFixed(2))).toEqual(shadow[0].slice(0, 3).map((v) => +v.toFixed(2)));
  });
});

suite("reduced motion", () => {
  beforeAll(() => openFixture(true));

  test("the page is in reduced motion", async () => {
    expect(await page.eval("matchMedia('(prefers-reduced-motion: reduce)').matches")).toBe(true);
  });

  test("--anim stops, so every animated probe shows its end state", async () => {
    for (const id of ["a-rise", "a-live", "k-fade", "k-rise", "k-slide", "k-slide-rtl", "k-slide-island", "k-pop", "k-rise-stack"]) {
      expect((await cs(id, ["animationName"])).animationName).toBe("none");
      expect(await running(id)).toEqual([]);
    }
    const end = await cs("a-rise", ["opacity", "translate"]);
    expect(end).toEqual({ opacity: "1", translate: "none" });
  });

  test("--anim stops in every breakpoint tier", async () => {
    for (const tier of TIERS) {
      await at(tier);
      expect(await cs("a-tiers", ["animationName", "animationDuration"])).toEqual({ animationName: "none", animationDuration: "0s" });
      expect(await running("a-tiers")).toEqual([]);
    }
    await at("xl");
  });

  test("the guard wins over a later !important rule at (0,1,0)", async () => {
    expect(await cs("l-anim", ["animationName"])).toEqual({ animationName: "none" });
    expect(await running("l-anim")).toEqual([]);
    expect(await cs("l-tn", ["transitionProperty", "transitionDuration"])).toEqual({ transitionProperty: "none", transitionDuration: "0s" });
  });

  test("the transition props stop, in every tier", async () => {
    for (const id of ["x-tn", "x-tdn", "x-tp", "x-tp-only", "h-state"]) {
      expect(await cs(id, ["transitionProperty", "transitionDuration"])).toEqual({ transitionProperty: "none", transitionDuration: "0s" });
    }
    for (const tier of TIERS) {
      await at(tier);
      expect(await cs("x-tiers", ["transitionProperty", "transitionDuration"])).toEqual({ transitionProperty: "none", transitionDuration: "0s" });
    }
    await at("xl");
  });

  test("a changed property jumps: no transition runs and the value is already there", async () => {
    await page.eval("document.getElementById('x-tn').style.opacity = '0'");
    await page.eval("document.getElementById('x-tp').style.transform = 'scale(2)'");
    expect(await running("x-tn")).toEqual([]);
    expect(await running("x-tp")).toEqual([]);
    expect((await cs("x-tn", ["opacity"])).opacity).toBe("0");
    expect((await cs("x-tp", ["transform"])).transform).toBe("matrix(2, 0, 0, 2, 0, 0)");
  });

  test("the hover helpers stop transitioning, in both name families, and still apply on hover", async () => {
    for (const id of ["h-shadow-hvr", "h-levitate-hvr", "h-translate-hvr", "h-shadow-hover", "h-levitate-hover", "h-translate-hover"]) {
      expect(await cs(id, ["transitionProperty", "transitionDuration"])).toEqual({ transitionProperty: "none", transitionDuration: "0s" });
    }
    for (const id of ["h-shadow-hvr", "h-shadow-hover"]) {
      const shown = await hoverShows(id);
      expect(shown.moving).toEqual([]);
      expect(shown.boxShadow).not.toBe("none"); // the hover look is there at once
    }
    for (const id of ["h-translate-hvr", "h-translate-hover"]) {
      const shown = await hoverShows(id);
      expect(shown.moving).toEqual([]);
      expect(shown.transform).toBe("matrix(1, 0, 0, 1, 0, -4)");
    }
  });

  test("the guard stays out of what is not motion", async () => {
    expect((await cs("g-text", ["backgroundClip"])).backgroundClip).toBe("text");
    expect((await cs("b-bdf", ["backdropFilter"])).backdropFilter).toBe("blur(6px) saturate(1.4)");
    expect(await layers("e-glow")).toHaveLength(4);
  });

  test("with the guard cut out of the sheet, the same page moves under reduced motion", async () => {
    const stripped = css.replace(/@media \(prefers-reduced-motion:reduce\)\{(?:[^{}]*\{[^{}]*\})+\}/, "");
    expect(stripped.length).toBeLessThan(css.length - 200); // both guard rules are gone
    await swapSheet(stripped);
    expect(await page.eval("matchMedia('(prefers-reduced-motion: reduce)').matches")).toBe(true);
    expect(await running("a-live")).toEqual([["CSSAnimation", "st-fade"]]);
    expect((await cs("l-anim", ["animationName"])).animationName).toBe("st-pop");
    expect((await cs("x-tn", ["transitionDuration"])).transitionDuration).toBe("10s");
    expect((await cs("h-shadow-hover", ["transitionDuration"])).transitionDuration).toBe("0.6s");
  });
});
