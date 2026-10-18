// Diff probe: what does a candidate stylesheet change on a real page? A fast
// gate for the change nobody asked for. A kit release moves things the tests
// never look at; this loads the page with the live kit and with the candidate
// and lists every element that came out different.
//
//   bun run probe:diff <url> --sheet <candidate.css> [--base <base.css>] [--login email:password]
//                      [--cookie name=value]... [--widths 390,1280] [--max N] [--show 30]
//                      [--shots <dir>] [--match <regex>] [--json]
//
// The page loads once per width with the base sheet (the live kit unless --base
// names a file) and once with the candidate. Both are served the way
// hover-probe --sheet serves: wherever the page loads the kit from startr.style
// (style.css, style.min.css or startr.css). --match REGEX replaces that URL
// test, for a page that vendors the kit under its own path.
//
// Each visible element gets a stable key (its position in the tree) and is
// measured: box, color, background-color, border-color (only where a border
// shows), font-size, display. An element is REPORTED when
//   - its box moved or resized by more than 1 px,
//   - a colour changed (compared as the 8-bit sRGB the browser paints),
//   - its font-size or display changed, or
//   - it is visible in one load and not in the other.
// The text lists the elements that changed in kind first (a resize, a colour)
// and the ones that only moved last: one grown box moves everything below it,
// and that cascade would bury the cause. --shots DIR writes a base and a
// candidate screenshot per width.
//
// Exit 1 only when the changed elements, summed over the widths, exceed --max.
// Without --max the probe reports and exits 0. Exit 2 on a setup error.
// Motion is off while measuring. Pages that move on their own (carousels,
// clocks) show up as noise: run the base against itself to see how much.

import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { findChrome, launch, type Page } from "./cdp";
import {
  FREEZE_MOTION,
  KIT_URL,
  parseCookie,
  parseLogin,
  parseWidths,
  readSheet,
  serveSheets,
  setCookies,
  SETTLED,
  signIn,
  slugify,
  splitArgs,
  stableCount,
} from "./probe-util";

export const USAGE =
  "usage: bun run probe:diff <url> --sheet <candidate.css> [--base <base.css>] [--login email:password] [--cookie name=value]... [--widths 390,1280] [--max N] [--show 30] [--shots <dir>] [--match <regex>] [--json]";

export type Options = {
  url: string;
  sheet: string;
  base: string | null;
  login: { email: string; password: string } | null;
  cookies: { name: string; value: string }[];
  widths: number[];
  max: number | null;
  show: number;
  shots: string | null;
  match: RegExp | null;
  json: boolean;
};

/** Parse argv (without bun and the script). Returns the options, or the message to print before exit 2. */
export function parseArgs(argv: string[]): Options | { error: string } {
  const split = splitArgs(argv, ["--sheet", "--base", "--login", "--cookie", "--widths", "--max", "--show", "--shots", "--match"], ["--json"]);
  if ("error" in split) return split;
  const { positional, values, flags } = split;
  const [url, ...rest] = positional;
  if (!url || !/^https?:\/\//.test(url)) return { error: "the first argument must be an http(s) URL" };
  if (rest.length) return { error: `unexpected argument ${rest[0]}` };
  const sheet = values.get("--sheet")?.[0];
  if (!sheet) return { error: "--sheet <candidate.css> is required" };

  const loginText = values.get("--login")?.[0];
  const login = loginText === undefined ? null : parseLogin(loginText);
  if (loginText !== undefined && !login) return { error: "--login wants email:password" };

  const cookies: { name: string; value: string }[] = [];
  for (const text of values.get("--cookie") ?? []) {
    const c = parseCookie(text);
    if (!c) return { error: `--cookie wants name=value, got "${text}"` };
    cookies.push(c);
  }

  const widthsText = values.get("--widths")?.[0];
  const widths = widthsText === undefined ? [390, 1280] : parseWidths(widthsText);
  if (!widths) return { error: "--widths wants a comma list of widths, such as 390,1280" };

  const maxText = values.get("--max")?.[0];
  const max = maxText === undefined ? null : Number(maxText);
  if (max !== null && (!Number.isInteger(max) || max < 0)) return { error: "--max wants a whole number" };

  const showText = values.get("--show")?.[0];
  const show = showText === undefined ? 30 : Number(showText);
  if (!Number.isInteger(show) || show < 0) return { error: "--show wants a whole number" };

  const matchText = values.get("--match")?.[0];
  let match: RegExp | null = null;
  if (matchText !== undefined) {
    try {
      match = new RegExp(matchText);
    } catch {
      return { error: `--match is not a valid regular expression: ${matchText}` };
    }
  }

  return {
    url,
    sheet,
    base: values.get("--base")?.[0] ?? null,
    login,
    cookies,
    widths,
    max,
    show,
    shots: values.get("--shots")?.[0] ?? null,
    match,
    json: flags.has("--json"),
  };
}

// --- the measurement and the comparison (pure) -----------------------------------------------

/** One visible element, as measured in the page. rect is [x, y, width, height] in page coordinates, rounded to 0.1 px. */
export type Snap = {
  key: string;
  label: string;
  rect: [number, number, number, number];
  color: string;
  bg: string;
  border: string;
  fontSize: string;
  display: string;
};

export const KINDS = ["added", "removed", "resized", "moved", "color", "background-color", "border-color", "font-size", "display"] as const;
export type Kind = (typeof KINDS)[number];

export type Delta = {
  key: string;
  label: string;
  kinds: Kind[];
  /** What changed, per kind: [before, after]. For added and removed, the element's rect as text on the side it exists. */
  changes: Partial<Record<Kind, [string, string]>>;
};

const fmtRect = (r: Snap["rect"]) => `[${r.join(", ")}]`;

/**
 * The elements that differ between two loads. Moves and resizes count past `tolerance` px; colours, font-size
 * and display count on any difference of the measured value. Order: the base's document order, then elements
 * that only the candidate shows.
 */
export function compareSnaps(base: Snap[], cand: Snap[], tolerance = 1): Delta[] {
  const candByKey = new Map(cand.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const out: Delta[] = [];
  for (const a of base) {
    const b = candByKey.get(a.key);
    seen.add(a.key);
    if (!b) {
      out.push({ key: a.key, label: a.label, kinds: ["removed"], changes: { removed: [fmtRect(a.rect), ""] } });
      continue;
    }
    const changes: Delta["changes"] = {};
    const kinds: Kind[] = [];
    const note = (kind: Kind, before: string, after: string) => {
      kinds.push(kind);
      changes[kind] = [before, after];
    };
    const [ax, ay, aw, ah] = a.rect;
    const [bx, by, bw, bh] = b.rect;
    if (Math.abs(aw - bw) > tolerance || Math.abs(ah - bh) > tolerance) note("resized", `${aw}x${ah}`, `${bw}x${bh}`);
    if (Math.abs(ax - bx) > tolerance || Math.abs(ay - by) > tolerance) note("moved", `${ax},${ay}`, `${bx},${by}`);
    if (a.color !== b.color) note("color", a.color, b.color);
    if (a.bg !== b.bg) note("background-color", a.bg, b.bg);
    if (a.border !== b.border) note("border-color", a.border || "none", b.border || "none");
    if (a.fontSize !== b.fontSize) note("font-size", a.fontSize, b.fontSize);
    if (a.display !== b.display) note("display", a.display, b.display);
    if (kinds.length) out.push({ key: a.key, label: a.label, kinds, changes });
  }
  for (const b of cand) {
    if (!seen.has(b.key)) out.push({ key: b.key, label: b.label, kinds: ["added"], changes: { added: ["", fmtRect(b.rect)] } });
  }
  return out;
}

/** True when the element only moved: very likely pushed by something above it that changed. */
export const movedOnly = (d: Delta) => d.kinds.length === 1 && d.kinds[0] === "moved";

/** Count of changed elements per kind (an element with two kinds counts in both). */
export function countKinds(deltas: Delta[]): Partial<Record<Kind, number>> {
  const out: Partial<Record<Kind, number>> = {};
  for (const d of deltas) for (const k of d.kinds) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/** The deltas in the order to show them: everything that changed in kind first, the move-only cascade last. Stable. */
export function showOrder(deltas: Delta[]): Delta[] {
  return [...deltas.filter((d) => !movedOnly(d)), ...deltas.filter(movedOnly)];
}

export type WidthResult = { width: number; compared: number; changed: number; kinds: Partial<Record<Kind, number>>; deltas: Delta[] };

/** True when the changed elements, summed over the widths, exceed the gate. No gate never trips. */
export function exceeds(results: WidthResult[], max: number | null): boolean {
  if (max === null) return false;
  return results.reduce((n, r) => n + r.changed, 0) > max;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatWidth(url: string, r: WidthResult, kit: string, show: number, tripped: boolean): string {
  const head = r.changed === 0 ? "ok  " : tripped ? "FLAG" : "DIFF";
  const kinds = KINDS.filter((k) => r.kinds[k]).map((k) => `${r.kinds[k]} ${k}`);
  const lines = [`${head} diff   ${url} @${r.width} [${kit}]: ${plural(r.compared, "element")} compared, ${r.changed} changed${kinds.length ? ` (${kinds.join(", ")})` : ""}`];
  const ordered = showOrder(r.deltas);
  for (const d of ordered.slice(0, show)) {
    lines.push(`  ${d.label}  ${d.key}`);
    for (const k of d.kinds) {
      const [before, after] = d.changes[k]!;
      if (k === "added") lines.push(`      added at ${after}`);
      else if (k === "removed") lines.push(`      removed from ${before}`);
      else lines.push(`      ${k}  ${before} -> ${after}`);
    }
  }
  if (ordered.length > show) lines.push(`  ... ${ordered.length - show} more (--show N, or --json for all)`);
  return lines.join("\n");
}

// --- in the page --------------------------------------------------------------------------------

/**
 * Measure every visible element. The key is the element's path by sibling index, so it is the same in two
 * loads of the same markup whatever the CSS does. Colours go through a 1x1 canvas, so two spellings of the
 * same paint (rgb() and color(srgb ...)) compare equal. Skips head content, scripts, svg internals and
 * display:none subtrees. Stops at 30000 elements.
 */
export const COLLECT = `(() => {
  const SKIP = new Set(["HEAD", "SCRIPT", "STYLE", "META", "LINK", "TITLE", "NOSCRIPT", "TEMPLATE", "BASE"]);
  const cx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const hex = (n) => n.toString(16).padStart(2, "0");
  const norm = (c) => {
    if (!c) return "";
    let v = cache.get(c);
    if (v !== undefined) return v;
    v = c;
    if (CSS.supports("color", c)) {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#000";
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
      v = a === 0 ? "transparent" : a === 255 ? "#" + hex(r) + hex(g) + hex(b) : "rgba(" + r + ", " + g + ", " + b + ", " + Math.round((a / 255) * 100) / 100 + ")";
    }
    cache.set(c, v);
    return v;
  };
  const r1 = (n) => Math.round(n * 10) / 10;
  const SIDES = ["Top", "Right", "Bottom", "Left"];
  const out = [];
  let truncated = false;
  const label = (el) => {
    const cls = (el.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 2).join(".");
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.trim().replace(/\\s+/g, " ").slice(0, 24);
    return "<" + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "") + ">" + (own ? ' "' + own + '"' : "");
  };
  const walk = (el, path) => {
    if (out.length >= 30000) { truncated = true; return; }
    if (SKIP.has(el.tagName)) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return;
    if (el.getClientRects().length) {
      const r = el.getBoundingClientRect();
      const border = SIDES.filter((s) => parseFloat(cs["border" + s + "Width"]) > 0 && cs["border" + s + "Style"] !== "none" && cs["border" + s + "Style"] !== "hidden")
        .map((s) => norm(cs["border" + s + "Color"]));
      out.push({
        key: path,
        label: label(el),
        rect: [r1(r.left + scrollX), r1(r.top + scrollY), r1(r.width), r1(r.height)],
        color: norm(cs.color),
        bg: norm(cs.backgroundColor),
        border: [...new Set(border)].join(" "),
        fontSize: cs.fontSize,
        display: cs.display,
      });
    }
    if (el.tagName.toLowerCase() === "svg") return;
    let i = 0;
    for (const child of el.children) walk(child, path + "/" + child.tagName.toLowerCase() + "[" + i++ + "]");
  };
  walk(document.documentElement, "html");
  return { snaps: out, truncated };
})()`;

async function fullPageShot(page: Page, file: string, width: number) {
  const metrics = await page.send("Page.getLayoutMetrics");
  const height = Math.min(Math.ceil((metrics.cssContentSize ?? metrics.contentSize).height), 16000);
  const { data } = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  await Bun.write(file, Buffer.from(data, "base64"));
}

/** A problem with the setup, not the page: exit 2. Thrown, not process.exit()ed, so Chrome's profile is cleaned up. */
class SetupError extends Error {}

type Report = {
  url: string;
  base: string;
  candidate: string;
  max: number | null;
  changed: number;
  exceeded: boolean;
  widths: (WidthResult & { truncatedDeltas: boolean; truncatedPage: boolean })[];
};

async function run(o: Options) {
  const candidateBody = readSheetOrFail(o.sheet);
  const baseBody = o.base ? readSheetOrFail(o.base) : null;
  const baseName = o.base ?? "live";
  const kit = `base: ${o.base ? basename(o.base) : "live"}, candidate: ${basename(o.sheet)}`;
  if (o.shots) mkdirSync(o.shots, { recursive: true });

  const chrome = await launch();
  try {
    const page = await chrome.newPage();
    // The live base must not come from a cache, and the candidate must not be skipped by one.
    await page.send("Network.enable");
    await page.send("Network.setCacheDisabled", { cacheDisabled: true });
    const swap = await serveSheets(chrome, page, o.match ?? KIT_URL);
    await setCookies(page, o.url, o.cookies);

    let signedIn = false;
    const load = async (width: number, body: string | null, name: string) => {
      swap.body = body;
      const servedBefore = swap.served;
      await page.setViewport(width, 900);
      await page.goto(o.url);
      await page.eval(SETTLED);
      await page.eval(stableCount("*"));
      if (o.login && !signedIn) {
        const res = await signIn(page, o.login);
        if (res.status !== 200 || !res.token) throw new SetupError(`login failed: HTTP ${res.status}`);
        signedIn = true;
        await page.goto(o.url);
        await page.eval(SETTLED);
        await page.eval(stableCount("*"));
      }
      if (body !== null && swap.served === servedBefore) {
        throw new SetupError(
          `${name} sheet given, but the page loaded no kit that matches ${o.match ?? "startr.style/(style|style.min|startr).css"} (vendored, or a different URL); nothing was substituted. Try --match.`,
        );
      }
      await page.eval(FREEZE_MOTION);
      return page.eval<{ snaps: Snap[]; truncated: boolean }>(COLLECT);
    };

    const results: Report["widths"] = [];
    for (const width of o.widths) {
      const before = await load(width, baseBody, "--base");
      if (o.shots) await fullPageShot(page, join(o.shots, `${slugify(o.url)}-${width}-base.png`), width);
      const after = await load(width, candidateBody, "--sheet");
      if (o.shots) await fullPageShot(page, join(o.shots, `${slugify(o.url)}-${width}-candidate.png`), width);

      const deltas = compareSnaps(before.snaps, after.snaps);
      results.push({
        width,
        compared: Math.max(before.snaps.length, after.snaps.length),
        changed: deltas.length,
        kinds: countKinds(deltas),
        deltas,
        truncatedDeltas: false,
        truncatedPage: before.truncated || after.truncated,
      });
    }

    const exceeded = exceeds(results, o.max);
    const changed = results.reduce((n, r) => n + r.changed, 0);
    if (o.json) {
      const cap = 500;
      const report: Report = {
        url: o.url,
        base: baseName,
        candidate: o.sheet,
        max: o.max,
        changed,
        exceeded,
        widths: results.map((r) => ({ ...r, deltas: showOrder(r.deltas).slice(0, cap), truncatedDeltas: r.deltas.length > cap })),
      };
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const r of results) {
        console.log(formatWidth(o.url, r, kit, o.show, exceeded));
        if (r.truncatedPage) console.log("  note: the page has more than 30000 visible elements; the rest were not measured");
      }
      if (o.shots) console.log(`  screenshots in ${o.shots}`);
      if (o.max !== null) console.log(`  ${changed} changed, gate --max ${o.max}: ${exceeded ? "over" : "within"}`);
    }
    process.exitCode = exceeded ? 1 : 0;
  } finally {
    await chrome.close();
  }
}

function readSheetOrFail(path: string): string {
  try {
    return readSheet(path);
  } catch {
    throw new SetupError(`cannot read the stylesheet ${path}`);
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${USAGE}`);
    process.exit(2);
  }
  if (!findChrome()) {
    console.error("no Chrome found (set CHROME_BIN)");
    process.exit(2);
  }
  try {
    await run(parsed);
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (import.meta.main) await main();
