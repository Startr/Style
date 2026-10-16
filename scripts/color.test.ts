// Colour by math: --mix and --tone (src/helpers/_color.css) and the tint
// tokens (src/variables.css).
//
//   bun test scripts/color.test.ts
//
// The cube check needs a browser, because color-mix(), round() and mod() are
// the browser's job. The test builds the sheets into a temp dir, copies the
// fixtures beside them, opens test/fixtures/color.html in headless Chrome and
// reads the measurements out of the dumped DOM. Without Chrome the browser
// tests skip and the static checks still run.
//
//   CHROME=/path/to/chrome       use another browser binary
//   COLOR_DIST=/path/to/dist     skip the build; use startr.css and startr.min.css there
//
// Headless Chrome prints the DOM in about a second and then lingers for
// minutes, so the runner reads stdout until </html> and kills it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HAVE_CHROME = existsSync(CHROME);
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// --- the measuring stick ------------------------------------------------------

type Lab = { L: number; a: number; b: number; A: number };

/** Computed colour string -> OKLab plus alpha. Reads what Chrome serializes. */
export function toLab(css: string): Lab {
  const s = css.trim();
  const num = (x: string) => (x === "none" ? 0 : parseFloat(x));
  const alpha = (x?: string) => (x === undefined ? 1 : x.endsWith("%") ? parseFloat(x) / 100 : num(x));
  let m = s.match(/^oklch\(\s*(\S+)\s+(\S+)\s+(\S+)\s*(?:\/\s*(\S+))?\s*\)$/);
  if (m) {
    const h = (num(m[3]) * Math.PI) / 180;
    return { L: num(m[1]), a: num(m[2]) * Math.cos(h), b: num(m[2]) * Math.sin(h), A: alpha(m[4]) };
  }
  m = s.match(/^oklab\(\s*(\S+)\s+(\S+)\s+(\S+)\s*(?:\/\s*(\S+))?\s*\)$/);
  if (m) return { L: num(m[1]), a: num(m[2]), b: num(m[3]), A: alpha(m[4]) };
  let rgb: number[] | undefined;
  let A = 1;
  m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    rgb = [m[1], m[2], m[3]].map((x) => parseFloat(x) / 255);
    A = alpha(m[4]);
  } else if ((m = s.match(/^color\(srgb\s+(\S+)\s+(\S+)\s+(\S+)\s*(?:\/\s*(\S+))?\s*\)$/))) {
    rgb = [m[1], m[2], m[3]].map(num);
    A = alpha(m[4]);
  }
  if (!rgb) throw new Error(`cannot read colour: ${css}`);
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const ss = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * ss,
    a: 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * ss,
    b: 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * ss,
    A,
  };
}

/** Distance in OKLab (plus alpha). Hue-less greys compare by L, so a stray hue on one costs nothing. */
export function dist(x: string, y: string): number {
  const p = toLab(x);
  const q = toLab(y);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b, p.A - q.A);
}

type Pair = { name: string; helper: string; ref: string };
const worst = (pairs: Pair[]) =>
  pairs.map((p) => ({ name: p.name, d: dist(p.helper, p.ref), helper: p.helper, ref: p.ref })).sort((x, y) => y.d - x.d)[0];

describe("measuring stick", () => {
  test("reads the formats Chrome serializes", () => {
    expect(dist("rgb(255, 255, 255)", "oklch(1 0 0)")).toBeLessThan(1e-4);
    expect(dist("color(srgb 1 1 1)", "oklab(1 0 0)")).toBeLessThan(1e-4);
    expect(dist("oklch(0.5 0.1 20 / 0.5)", "oklab(0.5 0.0939693 0.0342020 / 50%)")).toBeLessThan(1e-4);
    expect(dist("oklch(0.5 0.00001 none)", "oklch(0.5 0 200)")).toBeLessThan(1e-4);
  });

  test("sees a hue error, which is the one a plain seven-mix stack makes", () => {
    // Cell 001 of the plain stack against the old token: same L, C and alpha, hue 354 against 265.
    const d = dist("oklch(0.309863 0.0346356 353.801 / 0.9336)", "oklch(0.309863 0.0346356 265.476 / 0.9336)");
    expect(d).toBeGreaterThan(0.04);
    expect(dist("oklch(0.5 0.1 20)", "oklch(0.5 0.1 20.2)")).toBeLessThan(0.001);
  });
});

// --- source and built CSS (no browser) ------------------------------------------

const variables = read("src/variables.css");
const palette = read("test/fixtures/palette-1x.css");

describe("sources", () => {
  test("the reference palette holds the whole old cube and ramp", () => {
    expect(palette.match(/^\s*--color-\d+:/gm)?.length).toBe(16);
    expect(palette.match(/--_r\d-(bk|gn|bl|cn):/g)?.length).toBe(24); // four per line
    expect(palette.match(/^\s*--mix-[0-5]{3}:/gm)?.length).toBe(216);
    expect(palette.match(/^\s*--gray-\d+:/gm)?.length).toBe(24);
  });

  test("variables.css drops the enumerated palette and keeps the three layers", () => {
    expect(variables).not.toMatch(/--mix-\d{3}\s*:/);
    expect(variables).not.toMatch(/--gray-\d+\s*:/);
    expect(variables).not.toMatch(/--_r\d-(bk|gn|bl|cn)\s*:/);
    for (let i = 0; i < 16; i++) expect(variables).toMatch(new RegExp(`--color-${i}:`));
    for (const name of ["black", "red", "green", "yellow", "blue", "purple", "cyan", "white", "dark-grey", "grey", "orange", "pink"])
      expect(variables).toMatch(new RegExp(`\\s--${name}:`));
    for (const name of ["primary", "secondary", "background", "background-alt", "text-main", "text-muted", "links", "border"])
      expect(variables).toMatch(new RegExp(`\\s--${name}:`));
  });

  test("the tints start as literals and get their color-mix() under @supports", () => {
    const tints = variables.slice(variables.indexOf("Tints"));
    const root = /:root\s*\{([^}]*)\}/.exec(tints)?.[1] ?? "";
    const dark = /\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(tints)?.[1] ?? "";
    const supports = /@supports\s*\(([^)]*\)[^)]*)\)\s*\{([\s\S]*)\}\s*$/.exec(tints);
    for (const name of ["primary-tint", "good-bg", "warn-bg", "bad-bg"]) {
      expect(root).toMatch(new RegExp(`--${name}:\\s*#[0-9a-f]{6};`));
      expect(dark).toMatch(new RegExp(`--${name}:\\s*#[0-9a-f]{6};`));
      expect(supports?.[2]).toMatch(new RegExp(`--${name}:\\s*color-mix\\(in oklch,`));
    }
    expect(supports?.[1]).toContain("color-mix");
    // No color-mix() outside the @supports block, or an old browser would meet an unusable tint.
    expect(tints.slice(0, tints.indexOf("@supports"))).not.toContain("color-mix(in oklch");
    expect(supports?.[2]).toContain(":root");
    expect(supports?.[2]).toContain("[data-theme]");
  });
});

// --- build ------------------------------------------------------------------------

let work = "";
let dist_dir = "";
const profiles: string[] = [];

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "startr-color-"));
  if (process.env.COLOR_DIST) {
    dist_dir = resolve(process.env.COLOR_DIST);
  } else {
    dist_dir = join(work, "dist");
    const build = Bun.spawn(["bun", "run", "build.ts"], {
      cwd: ROOT,
      env: { ...process.env, STARTR_DIST: dist_dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
    if (code !== 0) throw new Error(`build failed (exit ${code}). Another stream may be mid-edit; retry in a minute.\n${(err || out).slice(-1500)}`);
  }
  for (const f of ["color.html", "palette-1x.css"]) copyFileSync(join(ROOT, "test/fixtures", f), join(work, f));
  // The theme creator's presets feed the fixture, so a new preset joins the check by itself.
  const presetSrc = /const presets = (\{[\s\S]*?\n\s*\});/.exec(read("theme-creator.html"));
  if (presetSrc) writeFileSync(join(work, "presets.js"), `window.PRESETS = ${JSON.stringify(new Function(`return ${presetSrc[1]}`)())};`);
  for (const f of ["startr.css", "startr.min.css"]) copyFileSync(join(dist_dir, f), join(work, f));
}, 180_000);

afterAll(async () => {
  // Chrome's helper processes keep the profile open for a moment after the kill.
  for (const dir of [...profiles, work]) {
    for (let attempt = 0; dir && attempt < 20; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await Bun.sleep(250);
      }
    }
  }
});

describe("built sheets", () => {
  for (const sheet of ["startr.css", "startr.min.css"]) {
    test(`${sheet}: no enumerated palette, both helpers, both registrations`, () => {
      const css = readFileSync(join(work, sheet), "utf8");
      expect(css).not.toMatch(/--mix-\d{3}\s*:/);
      expect(css).not.toMatch(/--gray-\d+\s*:/);
      expect(css).not.toMatch(/--_r\d-(bk|gn|bl|cn)\s*:/);
      expect(css).toMatch(/\[style\*="--mix:"\]/);
      expect(css).toMatch(/\[style\*="--tone:"\]/);
      expect(css).toMatch(/@property --mix\s*\{\s*syntax:\s*"<integer>";\s*inherits:\s*false;\s*initial-value:\s*0/);
      expect(css).toMatch(/@property --tone\s*\{\s*syntax:\s*"<number>";\s*inherits:\s*false;\s*initial-value:\s*0/);
    });
  }
});

// --- the browser --------------------------------------------------------------------

async function dumpDom(url: string): Promise<string> {
  const profile = mkdtempSync(join(tmpdir(), "startr-chrome-"));
  profiles.push(profile);
  const proc = Bun.spawn(
    [
      CHROME,
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--dump-dom",
      "--virtual-time-budget=5000",
      url,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const timer = setTimeout(() => proc.kill(), 90_000);
  const decoder = new TextDecoder();
  let out = "";
  try {
    for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
      out += decoder.decode(chunk, { stream: true });
      if (out.includes("</html>")) break;
    }
  } finally {
    clearTimeout(timer);
    proc.kill();
    await proc.exited;
  }
  return out;
}

const unescapeHtml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

async function measure(sheet: string): Promise<any> {
  const dom = await dumpDom(`file://${join(work, "color.html")}?sheet=${encodeURIComponent(sheet)}`);
  const m = dom.match(/<pre id="results">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error(`no results in the dumped DOM for ${sheet}:\n${dom.slice(0, 600)}`);
  const results = JSON.parse(unescapeHtml(m[1]));
  if (results.errors?.length) throw new Error(`fixture errors for ${sheet}: ${results.errors.join("; ")}`);
  return results;
}

const CUBE_LIMIT = 0.001;
const TIGHT = 0.0005;

describe.skipIf(!HAVE_CHROME)("in headless Chrome", () => {
  for (const sheet of ["startr.css", "startr.min.css"]) {
    describe(sheet, () => {
      let R: any;
      beforeAll(async () => {
        R = await measure(sheet);
      }, 150_000);

      test("the browser can run the math", () => {
        expect(R.env.colorMix).toBe(true);
        expect(R.env.round).toBe(true);
      });

      test("all 216 --mix:RGB cells match the old --mix-RGB tokens", () => {
        expect(R.cube.length).toBe(216);
        const w = worst(R.cube);
        // Greys at the two corners would be the only cells allowed to differ. None needs it.
        console.log(`${sheet}: cube max distance ${w.d.toExponential(2)} at --mix:${w.name}`);
        expect(w.d).toBeLessThan(CUBE_LIMIT);
        const off = (R.cube as Pair[]).filter((p) => dist(p.helper, p.ref) >= CUBE_LIMIT).map((p) => p.name);
        expect(off).toEqual([]);
      });

      test("the hue-less greys keep the old hue behaviour", () => {
        // Cells next to black (red 0, green 0) and next to white (red 5) are where a plain stack goes wrong.
        const names = ["001", "002", "003", "004", "010", "012", "014", "511", "512", "514", "522", "532"];
        for (const n of names) {
          const p = (R.cube as Pair[]).find((c) => c.name === n)!;
          expect(dist(p.helper, p.ref)).toBeLessThan(TIGHT);
        }
      });

      test("the cube follows a theme: every theme-creator preset, 216 cells each", () => {
        expect(R.presets).not.toBeNull();
        const names = Object.keys(R.presets);
        expect(names.length).toBeGreaterThanOrEqual(14);
        const misses: string[] = [];
        for (const name of names) {
          const cells = R.presets[name] as Pair[];
          expect(cells.length).toBe(216);
          for (const p of cells) {
            // The two corner greys may differ: a base colour with a faint tint (chroma under 0.02)
            // counts as hue-less when mixed, but cell 000 or 555 shows it raw.
            const limit = p.name === "000" || p.name === "555" ? 0.02 : CUBE_LIMIT;
            const d = dist(p.helper, p.ref);
            if (d >= limit) misses.push(`${name} --mix:${p.name} ${d.toFixed(4)}`);
          }
        }
        expect(misses).toEqual([]);
      });

      test("a digit above 5 counts as 5", () => {
        for (const p of R.mixClamp as Pair[]) expect(dist(p.helper, p.ref)).toBeLessThan(CUBE_LIMIT);
      });

      test("a negative number still gives a colour", () => {
        expect(R.mixNegative).not.toBe("rgb(1, 2, 3)");
        expect(() => toLab(R.mixNegative)).not.toThrow();
      });

      test("bad input falls to the registered initial value", () => {
        expect(R.bad.mix).toBe("0");
        expect(R.bad.tone).toBe("0");
      });

      test("--tone N with --tone-of black matches the old --gray-N ramp, all 24 steps", () => {
        expect(R.tone.ramp.length).toBe(24);
        const w = worst(R.tone.ramp);
        expect(w.d).toBeLessThan(TIGHT);
      });

      test("--tone-of defaults to --text-main", () => {
        expect(dist(R.tone.default.helper, R.tone.default.ref)).toBeLessThan(TIGHT);
      });

      test("--tone 0 is the background and 100 is the text colour", () => {
        expect(dist(R.tone.zero.helper, R.tone.zero.ref)).toBeLessThan(TIGHT);
        expect(dist(R.tone.full.helper, R.tone.full.ref)).toBeLessThan(TIGHT);
      });

      test("--tone clamps to 0 and 100", () => {
        expect(dist(R.tone.over.helper, R.tone.over.ref)).toBeLessThan(TIGHT);
        expect(dist(R.tone.under.helper, R.tone.under.ref)).toBeLessThan(TIGHT);
      });

      test("--tone-of takes a token, a literal colour, and --tone takes a fraction", () => {
        for (const k of ["of", "ofLiteral", "fraction"]) expect(dist(R.tone[k].helper, R.tone[k].ref)).toBeLessThan(TIGHT);
      });

      test("--toned follows the theme", () => {
        expect(dist(R.tone.follow.light, R.tone.follow.dark)).toBeGreaterThan(0.1);
        expect(dist(R.tone.dark.helper, R.tone.dark.ref)).toBeLessThan(TIGHT);
      });

      test("--mix on a parent does not leak into a child", () => {
        const L = R.leak.mix;
        expect(L.parentHasMixed).toBe(true);
        expect(L.childMix).toBe("0");
        expect(L.childMixed).toBe("");
        expect(L.childBg).toBe("rgb(1, 2, 3)"); // the fallback, not the parent's colour
        expect(dist(L.grandBg, L.whiteBg)).toBeLessThan(TIGHT); // the grandchild's own --mix works
      });

      test("--tone on a parent does not leak into a child", () => {
        const L = R.leak.tone;
        expect(L.parentHasToned).toBe(true);
        expect(L.childTone).toBe("0");
        expect(L.childToned).toBe("");
        expect(L.childBg).toBe("rgb(1, 2, 3)");
      });

      test("--tone-of on a parent does not leak into a child", () => {
        const L = R.leak.toneOf;
        expect(L.childToneOf).toBe("");
        expect(dist(L.child, L.expected)).toBeLessThan(TIGHT);
        expect(dist(L.child, L.ifLeaked)).toBeGreaterThan(0.1);
      });

      for (const theme of ["light", "nested", "dark"] as const) {
        test(`the tints exist and equal the --tone formula (${theme})`, () => {
          const T = R.tints[theme];
          for (const name of ["primary-tint", "good-bg", "warn-bg", "bad-bg"]) {
            expect(T[name].token).toBe(true);
            expect(dist(T[name].helper, T[name].ref)).toBeLessThan(TIGHT);
            expect(dist(T[name].helper, T[name].viaTone)).toBeLessThan(TIGHT);
          }
        });
      }

      test("the tints recompute in dark mode, on the page and in a nested container", () => {
        for (const name of ["primary-tint", "good-bg", "warn-bg", "bad-bg"]) {
          expect(dist(R.tints.light[name].helper, R.tints.dark[name].helper)).toBeGreaterThan(0.3);
          expect(dist(R.tints.nested[name].helper, R.tints.dark[name].helper)).toBeLessThan(TIGHT);
        }
        expect(R.tints.light.background).toBe("rgb(255, 255, 255)");
        expect(R.tints.dark.background).not.toBe(R.tints.light.background);
      });

      test("the literal fallbacks match the math, so an old browser sees the same fill", () => {
        const tints = variables.slice(variables.indexOf("Tints"));
        const root = /:root\s*\{([^}]*)\}/.exec(tints)![1];
        const dark = /\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(tints)![1];
        const hex = (block: string, name: string) => {
          const h = new RegExp(`--${name}:\\s*#([0-9a-f]{6});`).exec(block)![1];
          return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
        };
        for (const [theme, block] of [["light", root], ["dark", dark]] as const) {
          for (const name of ["primary-tint", "good-bg", "warn-bg", "bad-bg"]) {
            const lit = hex(block, name);
            const math: number[] = R.tints[theme][name].px;
            // min.css rounds the base colours to 8 bits, which can move a channel by 1.
            lit.forEach((v, i) => expect(Math.abs(v - math[i])).toBeLessThanOrEqual(2));
          }
        }
      });

      test("the documented usage works through the kit's --bg and --b", () => {
        expect(dist(R.usage.bg.helper, R.usage.bg.ref)).toBeLessThan(TIGHT);
        expect(R.usage.border.width).toBe("1px");
        expect(dist(R.usage.border.helper, R.usage.border.ref)).toBeLessThan(TIGHT);
      });

      test("animating --tone animates the colour", () => {
        expect(R.anim.tone).toBe("50");
        expect(dist(R.anim.helper, R.anim.ref)).toBeLessThan(TIGHT);
      });
    });
  }

  test("teeth: a plain stack of seven mixes fails the cube check", async () => {
    // The obvious reading of the cube, with no guard for hue-less greys.
    const plain = `
@property --mix { syntax: "<integer>"; inherits: false; initial-value: 0; }
[style*="--mix:"] {
  --_r: clamp(0%, round(down, var(--mix) / 100, 1) * 20%, 100%);
  --_g: clamp(0%, round(down, mod(var(--mix), 100) / 10, 1) * 20%, 100%);
  --_b: clamp(0%, mod(var(--mix), 10) * 20%, 100%);
  --mixed: color-mix(in oklch,
    color-mix(in oklch,
      color-mix(in oklch, var(--color-0), var(--color-1) var(--_r)),
      color-mix(in oklch, var(--color-2), var(--color-3) var(--_r)) var(--_g)),
    color-mix(in oklch,
      color-mix(in oklch, var(--color-4), var(--color-5) var(--_r)),
      color-mix(in oklch, var(--color-6), var(--color-7) var(--_r)) var(--_g)) var(--_b));
}
`;
    writeFileSync(join(work, "plain.css"), plain);
    const R = await measure("plain.css");
    const off = (R.cube as Pair[]).filter((p) => dist(p.helper, p.ref) >= CUBE_LIMIT);
    console.log(`plain stack: ${off.length} of 216 cells miss, worst ${worst(R.cube).d.toFixed(3)}`);
    expect(off.length).toBeGreaterThan(30);
  }, 150_000);
});

test.skipIf(HAVE_CHROME)("browser tests need Chrome", () => {
  console.log(`No Chrome at ${CHROME}. Set CHROME=... to run the cube, tone, leak and tint checks.`);
});
