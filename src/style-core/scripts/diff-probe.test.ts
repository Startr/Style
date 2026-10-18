import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "./cdp";
import { compareSnaps, countKinds, exceeds, formatWidth, movedOnly, parseArgs, showOrder, type Delta, type Options, type Snap, type WidthResult } from "./diff-probe";

// probe:diff lists what a candidate stylesheet changes on a page. The pure
// parts (arguments, the comparison, the report) run everywhere; the end-to-end
// cases drive a real Chrome against a local server and skip without one.

const root = join(import.meta.dir, "..");

const snap = (key: string, over: Partial<Snap> = {}): Snap => ({
  key,
  label: `<${key}>`,
  rect: [0, 0, 100, 20],
  color: "#333333",
  bg: "transparent",
  border: "",
  fontSize: "16px",
  display: "block",
  ...over,
});

describe("parseArgs", () => {
  const ok = (argv: string[]) => {
    const parsed = parseArgs(argv);
    if ("error" in parsed) throw new Error(`expected options, got: ${parsed.error}`);
    return parsed as Options;
  };
  const bad = (argv: string[]) => {
    const parsed = parseArgs(argv);
    if (!("error" in parsed)) throw new Error("expected an error");
    return parsed.error;
  };

  test("a url and --sheet are enough; the defaults are 390 and 1280, no gate, 30 shown", () => {
    const o = ok(["http://localhost:8080/", "--sheet", "dist/startr.css"]);
    expect(o.sheet).toBe("dist/startr.css");
    expect(o.base).toBeNull();
    expect(o.widths).toEqual([390, 1280]);
    expect(o.max).toBeNull();
    expect(o.show).toBe(30);
    expect(o.shots).toBeNull();
    expect(o.match).toBeNull();
    expect(o.json).toBe(false);
  });

  test("every option", () => {
    const o = ok([
      "http://x.test/a", "--sheet", "c.css", "--base", "b.css", "--login", "me@x.test:pw", "--cookie", "sessionid=1", "--cookie", "t=2",
      "--widths", "320,768,1280", "--max", "5", "--show", "10", "--shots", "out", "--match", "vendor/startr\\.css", "--json",
    ]);
    expect(o.base).toBe("b.css");
    expect(o.login).toEqual({ email: "me@x.test", password: "pw" });
    expect(o.cookies).toHaveLength(2);
    expect(o.widths).toEqual([320, 768, 1280]);
    expect(o.max).toBe(5);
    expect(o.show).toBe(10);
    expect(o.shots).toBe("out");
    expect(o.match?.test("/static/vendor/startr.css")).toBe(true);
    expect(o.json).toBe(true);
  });

  test("bad input is named", () => {
    expect(bad(["x.test", "--sheet", "c.css"])).toMatch(/URL/);
    expect(bad(["http://x.test/"])).toMatch(/--sheet/);
    expect(bad(["http://x.test/", "--sheet", "c.css", "extra"])).toMatch(/unexpected/);
    expect(bad(["http://x.test/", "--sheet", "c.css", "--widths", "wide"])).toMatch(/widths/);
    expect(bad(["http://x.test/", "--sheet", "c.css", "--max", "-1"])).toMatch(/whole number/);
    expect(bad(["http://x.test/", "--sheet", "c.css", "--max", "1.5"])).toMatch(/whole number/);
    expect(bad(["http://x.test/", "--sheet", "c.css", "--show", "many"])).toMatch(/whole number/);
    expect(bad(["http://x.test/", "--sheet", "c.css", "--match", "("])).toMatch(/regular expression/);
    expect(bad(["http://x.test/", "--sheet", "c.css", "--login", "nocolon"])).toMatch(/email:password/);
    expect(bad(["http://x.test/", "--sheet", "c.css", "--nope"])).toMatch(/unknown flag/);
  });
});

describe("compareSnaps", () => {
  test("the same page twice has no changes", () => {
    const page = [snap("html"), snap("html/body[1]"), snap("html/body[1]/p[0]")];
    expect(compareSnaps(page, structuredClone(page))).toEqual([]);
  });

  test("a move or a resize of 1 px is noise; more than 1 px is reported", () => {
    const a = [snap("p", { rect: [10, 10, 100, 20] })];
    expect(compareSnaps(a, [snap("p", { rect: [11, 11, 101, 21] })])).toEqual([]);
    expect(compareSnaps(a, [snap("p", { rect: [10.9, 10, 100.9, 20] })])).toEqual([]);
    const moved = compareSnaps(a, [snap("p", { rect: [11.1, 10, 100, 20] })]);
    expect(moved[0].kinds).toEqual(["moved"]);
    expect(moved[0].changes.moved).toEqual(["10,10", "11.1,10"]);
    const resized = compareSnaps(a, [snap("p", { rect: [10, 10, 100, 22] })]);
    expect(resized[0].kinds).toEqual(["resized"]);
    expect(resized[0].changes.resized).toEqual(["100x20", "100x22"]);
  });

  test("a resize and a move on one element are both named", () => {
    const d = compareSnaps([snap("p", { rect: [0, 0, 100, 20] })], [snap("p", { rect: [0, 5, 100, 30] })]);
    expect(d[0].kinds).toEqual(["resized", "moved"]);
  });

  test("each colour is its own kind", () => {
    const base = [snap("a", { color: "#333333", bg: "transparent", border: "#cccccc" })];
    const d = compareSnaps(base, [snap("a", { color: "#555555", bg: "#0066ff", border: "#cc0000" })]);
    expect(d).toHaveLength(1);
    expect(d[0].kinds).toEqual(["color", "background-color", "border-color"]);
    expect(d[0].changes.color).toEqual(["#333333", "#555555"]);
    expect(d[0].changes["border-color"]).toEqual(["#cccccc", "#cc0000"]);
  });

  test("a border that appears or goes reads as none on the empty side", () => {
    const d = compareSnaps([snap("a", { border: "" })], [snap("a", { border: "#cc0000" })]);
    expect(d[0].changes["border-color"]).toEqual(["none", "#cc0000"]);
  });

  test("font-size and display are reported", () => {
    const d = compareSnaps([snap("a")], [snap("a", { fontSize: "18px", display: "flex" })]);
    expect(d[0].kinds).toEqual(["font-size", "display"]);
  });

  test("an element visible in one load only is added or removed", () => {
    const d = compareSnaps([snap("gone"), snap("kept")], [snap("kept"), snap("new")]);
    expect(d.map((x) => [x.key, x.kinds[0]])).toEqual([
      ["gone", "removed"],
      ["new", "added"],
    ]);
    expect(d[0].changes.removed).toEqual(["[0, 0, 100, 20]", ""]);
    expect(d[1].changes.added).toEqual(["", "[0, 0, 100, 20]"]);
  });

  test("a wider tolerance is honoured", () => {
    const a = [snap("p", { rect: [0, 0, 100, 20] })];
    const b = [snap("p", { rect: [0, 4, 100, 20] })];
    expect(compareSnaps(a, b, 5)).toEqual([]);
    expect(compareSnaps(a, b, 3)).toHaveLength(1);
  });

  test("order follows the base document, then what only the candidate shows", () => {
    const base = [snap("a"), snap("b"), snap("c")];
    const cand = [snap("a", { color: "#000000" }), snap("b"), snap("c", { color: "#000000" }), snap("z")];
    expect(compareSnaps(base, cand).map((d) => d.key)).toEqual(["a", "c", "z"]);
  });
});

describe("the report", () => {
  const d = (key: string, kinds: Delta["kinds"]): Delta => ({
    key,
    label: `<${key}>`,
    kinds,
    changes: Object.fromEntries(kinds.map((k) => [k, k === "added" ? ["", "[1, 2, 3, 4]"] : k === "removed" ? ["[1, 2, 3, 4]", ""] : ["x", "y"]])) as Delta["changes"],
  });

  test("movedOnly and showOrder put the cascade last and keep the order inside each group", () => {
    const deltas = [d("m1", ["moved"]), d("c1", ["color"]), d("m2", ["moved"]), d("r1", ["resized", "moved"])];
    expect(deltas.map(movedOnly)).toEqual([true, false, true, false]);
    expect(showOrder(deltas).map((x) => x.key)).toEqual(["c1", "r1", "m1", "m2"]);
  });

  test("countKinds counts an element under every kind it has", () => {
    expect(countKinds([d("a", ["resized", "moved"]), d("b", ["moved"]), d("c", ["color"])])).toEqual({ resized: 1, moved: 2, color: 1 });
  });

  test("exceeds sums the widths; no gate never trips; the gate is exclusive", () => {
    const w = (n: number): WidthResult => ({ width: 390, compared: 10, changed: n, kinds: {}, deltas: [] });
    expect(exceeds([w(3), w(4)], null)).toBe(false);
    expect(exceeds([w(3), w(4)], 7)).toBe(false);
    expect(exceeds([w(3), w(4)], 6)).toBe(true);
    expect(exceeds([w(0), w(0)], 0)).toBe(false);
    expect(exceeds([w(1)], 0)).toBe(true);
  });

  test("formatWidth: clean, changed within the gate, changed over it", () => {
    const clean: WidthResult = { width: 1280, compared: 40, changed: 0, kinds: {}, deltas: [] };
    expect(formatWidth("http://x.test/", clean, "live", 30, false)).toBe("ok   diff   http://x.test/ @1280 [live]: 40 elements compared, 0 changed");

    const deltas = [d("m", ["moved"]), d("c", ["color"]), d("add", ["added"]), d("rm", ["removed"])];
    const dirty: WidthResult = { width: 390, compared: 1, changed: 4, kinds: countKinds(deltas), deltas };
    const text = formatWidth("http://x.test/", dirty, "live", 30, false);
    expect(text.startsWith("DIFF diff")).toBe(true);
    expect(text).toContain("1 element compared, 4 changed (1 added, 1 removed, 1 moved, 1 color)");
    expect(text).toContain("color  x -> y");
    expect(text).toContain("added at [1, 2, 3, 4]");
    expect(text).toContain("removed from [1, 2, 3, 4]");
    // The colour change is listed before the move-only element, though it comes after it in the list.
    expect(text.indexOf("<c>")).toBeLessThan(text.indexOf("<m>"));
    expect(formatWidth("http://x.test/", dirty, "live", 30, true).startsWith("FLAG diff")).toBe(true);
  });

  test("formatWidth cuts the list at --show and says how many are left", () => {
    const deltas = Array.from({ length: 12 }, (_, i) => d(`e${i}`, ["color"]));
    const text = formatWidth("http://x.test/", { width: 390, compared: 99, changed: 12, kinds: countKinds(deltas), deltas }, "live", 5, false);
    expect(text).toContain("<e4>");
    expect(text).not.toContain("<e5>");
    expect(text).toContain("... 7 more");
  });
});

// --- end to end ---------------------------------------------------------------------------------

const suite = findChrome() ? describe : describe.skip;

// The page loads the kit from the address the probe substitutes. Neither sheet ever leaves the machine.
const KIT = "https://startr.style/style.css";
const body = `
  <p id="para">Some text</p>
  <button id="btn">Save</button>
  <div id="card" class="card">Card</div>
  <div id="maybe" class="maybe">Maybe</div>
  <div id="untouched">Untouched</div>`;
const PAGES: Record<string, string> = {
  "/": `<!doctype html><html><head><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="${KIT}"></head><body>${body}</body></html>`,
  "/nokit": `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`,
};

const BASE_CSS = `
  body { margin: 0; font: 16px/20px sans-serif; color: #111; }
  #para { margin: 0; color: #333333; }
  #btn { display: block; margin: 0; padding: 8px; background: #0066ff; color: #fff; border: 0; font: inherit; }
  .card { margin: 0; padding: 10px; border: 2px solid #cccccc; }
  .maybe { display: none; }
  #untouched { margin: 0; color: #111; }
`;
// Four deliberate changes: a colour, a resize, a border colour, a new element. The card and
// everything below the button move because the button grew; they are the cascade.
const CANDIDATE_CSS = BASE_CSS
  .replace("color: #333333", "color: #555555")
  .replace("padding: 8px", "padding: 8px 8px 20px")
  .replace("2px solid #cccccc", "2px solid #cc0000")
  .replace(".maybe { display: none; }", ".maybe { display: block; margin: 0; }");
// The same paint spelt other ways: rgb() and color-mix() both resolve to #333333.
const RESPELT_CSS = BASE_CSS.replace("color: #333333", "color: color-mix(in srgb, rgb(51, 51, 51) 100%, white 0%)").replace("background: #0066ff", "background: rgb(0, 102, 255)");

suite("probe:diff end to end", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base = "";
  let work = "";
  const file = (name: string, css: string) => {
    const path = join(work, name);
    writeFileSync(path, css);
    return path;
  };

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "startr-diff-probe-"));
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const html = PAGES[new URL(req.url).pathname];
        return html ? new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404 });
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server?.stop(true);
    if (work) rmSync(work, { recursive: true, force: true });
  });

  async function probe(path: string, args: string[]) {
    const run = Bun.spawn([process.execPath, "run", "scripts/diff-probe.ts", base + path, "--widths", "500", "--json", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    return { code, err, report: out.trim() ? JSON.parse(out) : null };
  }
  const byLabel = (deltas: Delta[], text: string) => deltas.find((d) => d.label.includes(text));

  test("the same sheet against itself changes nothing, exit 0, even with --max 0", async () => {
    const same = file("same.css", BASE_CSS);
    const r = await probe("/", ["--base", same, "--sheet", same, "--max", "0"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.report.changed).toBe(0);
    expect(r.report.widths[0].compared).toBeGreaterThan(5);
  }, 60_000);

  test("two spellings of one paint are not a change", async () => {
    const r = await probe("/", ["--base", file("a.css", BASE_CSS), "--sheet", file("b.css", RESPELT_CSS), "--max", "0"]);
    expect(r.err).toBe("");
    expect(r.report.changed).toBe(0);
    expect(r.code).toBe(0);
  }, 60_000);

  test("teeth: a candidate that recolours, resizes and adds is caught, element by element", async () => {
    const r = await probe("/", ["--base", file("a.css", BASE_CSS), "--sheet", file("c.css", CANDIDATE_CSS)]);
    expect(r.err).toBe("");
    const deltas: Delta[] = r.report.widths[0].deltas;
    expect(byLabel(deltas, "#para")?.kinds).toEqual(["color"]);
    expect(byLabel(deltas, "#para")?.changes.color).toEqual(["#333333", "#555555"]);
    expect(byLabel(deltas, "#btn")?.kinds).toEqual(["resized"]);
    expect(byLabel(deltas, "#card")?.kinds).toEqual(["moved", "border-color"]);
    expect(byLabel(deltas, "#maybe")?.kinds).toEqual(["added"]);
    expect(byLabel(deltas, "#untouched")?.kinds).toEqual(["moved"]);
    // The container grows too: a cause the cascade list would otherwise hide.
    expect(byLabel(deltas, "<body>")?.kinds).toEqual(["resized"]);
    // resized: the button, body and html; moved: the card and the untouched div.
    expect(r.report.widths[0].kinds).toEqual({ added: 1, resized: 3, moved: 2, color: 1, "border-color": 1 });
    expect(r.report.changed).toBe(7);
    // Without --max the probe reports and passes.
    expect(r.code).toBe(0);
  }, 60_000);

  test("--max gates the exit: over it is 1, at or under it is 0", async () => {
    const args = ["--base", file("a.css", BASE_CSS), "--sheet", file("c.css", CANDIDATE_CSS)];
    const changed = (await probe("/", args)).report.changed as number;
    expect(changed).toBeGreaterThan(3);
    const over = await probe("/", [...args, "--max", String(changed - 1)]);
    expect(over.code).toBe(1);
    expect(over.report.exceeded).toBe(true);
    const within = await probe("/", [...args, "--max", String(changed)]);
    expect(within.code).toBe(0);
    expect(within.report.exceeded).toBe(false);
  }, 90_000);

  test("--shots writes a base and a candidate screenshot per width", async () => {
    const shots = join(work, "shots");
    const r = await probe("/", ["--base", file("a.css", BASE_CSS), "--sheet", file("c.css", CANDIDATE_CSS), "--shots", shots]);
    expect(r.code).toBe(0);
    for (const name of ["500-base.png", "500-candidate.png"]) {
      const matches = [...new Bun.Glob(`*${name}`).scanSync(shots)];
      expect(matches).toHaveLength(1);
      expect(Bun.file(join(shots, matches[0])).size).toBeGreaterThan(500);
    }
  }, 60_000);

  test("a page that loads no matching kit is a setup error, exit 2", async () => {
    const r = await probe("/nokit", ["--base", file("a.css", BASE_CSS), "--sheet", file("c.css", CANDIDATE_CSS)]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("nothing was substituted");
  }, 60_000);

  test("--match substitutes a kit served under another path", async () => {
    const r = await probe("/", ["--base", file("a.css", BASE_CSS), "--sheet", file("c.css", CANDIDATE_CSS), "--match", "startr\\.style/style\\.css"]);
    expect(r.err).toBe("");
    expect(r.report.changed).toBeGreaterThan(3);
  }, 60_000);

  test("a missing sheet is a setup error, exit 2, before Chrome starts", async () => {
    const r = await probe("/", ["--sheet", join(work, "does-not-exist.css")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("cannot read the stylesheet");
    expect(existsSync(join(work, "does-not-exist.css"))).toBe(false);
  }, 30_000);
});
