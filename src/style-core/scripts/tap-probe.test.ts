import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findChrome } from "./cdp";
import { EXIT, formatReport, parseArgs, verdict, type Options, type Report } from "./tap-probe";

// probe:tap taps once and checks --expect. The pure parts (arguments, verdict,
// report) run everywhere; the end-to-end cases drive a real Chrome against a
// local server and need one (they skip without).

const root = join(import.meta.dir, "..");
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

describe("parseArgs", () => {
  test("a url, a selector and --expect are enough; the defaults are a 390x844 phone and a 1.5 s wait", () => {
    const o = ok(["http://localhost:8033/leads", "[data-row]", "--expect", "[data-on]"]);
    expect(o.url).toBe("http://localhost:8033/leads");
    expect(o.selector).toBe("[data-row]");
    expect(o.expect).toBe("[data-on]");
    expect(o.viewport).toEqual({ width: 390, height: 844 });
    expect(o.wait).toBe(1500);
    expect(o.login).toBeNull();
    expect(o.cookies).toEqual([]);
    expect(o.json).toBe(false);
  });

  test("flags may come before or between the positional arguments", () => {
    const o = ok(["--expect", "#done", "--json", "http://x.test/", "button.go", "--wait", "200", "--viewport", "360x640"]);
    expect([o.url, o.selector, o.expect, o.wait, o.json]).toEqual(["http://x.test/", "button.go", "#done", 200, true]);
    expect(o.viewport).toEqual({ width: 360, height: 640 });
  });

  test("--login splits on the first colon; --cookie splits on the first = and repeats", () => {
    const o = ok(["http://x.test/", "a", "--expect", "b", "--login", "me@x.test:pa:ss", "--cookie", "sessionid=abc==", "--cookie", "csrftoken=z"]);
    expect(o.login).toEqual({ email: "me@x.test", password: "pa:ss" });
    expect(o.cookies).toEqual([
      { name: "sessionid", value: "abc==" },
      { name: "csrftoken", value: "z" },
    ]);
  });

  test("a file:// url is accepted, for fixtures", () => {
    expect(ok(["file:///tmp/a.html", "a", "--expect", "b"]).url).toBe("file:///tmp/a.html");
  });

  test("--expect is required: a tap with no stated outcome proves nothing", () => {
    expect(bad(["http://x.test/", "a"])).toMatch(/--expect/);
  });

  test("bad input is named", () => {
    expect(bad(["x.test", "a", "--expect", "b"])).toMatch(/URL/);
    expect(bad(["http://x.test/"])).toMatch(/selector/);
    expect(bad(["http://x.test/", "a", "--expect"])).toMatch(/needs a value/);
    expect(bad(["http://x.test/", "a", "--expect", "b", "--nope"])).toMatch(/unknown flag/);
    expect(bad(["http://x.test/", "a", "--expect", "b", "extra"])).toMatch(/unexpected/);
    expect(bad(["http://x.test/", "a", "--expect", "b", "--login", "nocolon"])).toMatch(/email:password/);
    expect(bad(["http://x.test/", "a", "--expect", "b", "--cookie", "novalue"])).toMatch(/name=value/);
    expect(bad(["http://x.test/", "a", "--expect", "b", "--viewport", "wide"])).toMatch(/WIDTHxHEIGHT/);
    expect(bad(["http://x.test/", "a", "--expect", "b", "--wait", "soon"])).toMatch(/milliseconds/);
  });
});

describe("verdict", () => {
  test("ok when the expectation appears after the tap", () => {
    expect(verdict(0, 1)).toBe("ok");
    expect(verdict(0, 3)).toBe("ok");
  });
  test("fail when one tap was not enough", () => {
    expect(verdict(0, 0)).toBe("fail");
  });
  test("void when it already held: the probe would pass a page that does nothing", () => {
    expect(verdict(1, 1)).toBe("vacuous");
    expect(verdict(2, 0)).toBe("vacuous");
  });
  test("exit codes: 0 ok, 1 fail, 2 void", () => {
    expect([EXIT.ok, EXIT.fail, EXIT.vacuous]).toEqual([0, 1, 2]);
  });
});

describe("formatReport", () => {
  const base: Report = {
    url: "http://x.test/",
    viewport: "390x844",
    selector: "[data-row]",
    expect: "[data-on]",
    verdict: "ok",
    tapped: { tag: "a", text: "Lead 1", x: 195, y: 100 },
    landedOn: null,
    matchesBefore: 0,
    matchesAfter: 1,
    path: { before: "/leads", after: "/leads" },
  };
  test("a pass is one head line and the counts", () => {
    const text = formatReport(base);
    expect(text.split("\n")[0]).toMatch(/^ok {3}tap {3}http:\/\/x\.test\/ @390x844: one tap on \[data-row\] \(<a> "Lead 1"\)$/);
    expect(text).toContain("0 before, 1 after");
  });
  test("a fail says a second tap is needed", () => {
    const text = formatReport({ ...base, verdict: "fail", matchesAfter: 0 });
    expect(text.startsWith("FAIL")).toBe(true);
    expect(text).toContain("needs a second tap");
  });
  test("a void run says why", () => {
    const text = formatReport({ ...base, verdict: "vacuous", matchesBefore: 1 });
    expect(text.startsWith("VOID")).toBe(true);
    expect(text).toContain("BEFORE");
  });
  test("a covered target and a navigation are named", () => {
    const text = formatReport({ ...base, landedOn: "div.overlay", path: { before: "/a", after: "/b" } });
    expect(text).toContain("landed on div.overlay");
    expect(text).toContain("navigated /a -> /b");
  });
});

// --- end to end ---------------------------------------------------------------------------------

const suite = findChrome() ? describe : describe.skip;

const VIEWPORT = `<meta name="viewport" content="width=device-width, initial-scale=1">`;
const page = (body: string, attrs = "") => `<!doctype html><html><head><meta charset="utf-8">${VIEWPORT}<title>t</title></head><body ${attrs}>${body}</body></html>`;

const PAGES: Record<string, string> = {
  // One tap does it.
  "/one": page(`<button id="go" style="margin:40px;padding:20px">Go</button><script>go.onclick = () => { document.body.dataset.done = "1"; };</script>`),
  // The two-tap shape: the first tap only arms the button.
  "/two": page(`<button id="go" style="margin:40px;padding:20px">Go</button><script>let n = 0; go.onclick = () => { if (++n >= 2) document.body.dataset.done = "1"; };</script>`),
  // The expectation holds before anyone taps.
  "/void": page(`<button id="go" style="margin:40px;padding:20px">Go</button>`, 'data-done="1"'),
  // A link: the tap navigates, and the new page holds the expectation.
  "/link": page(`<a id="go" href="/arrived" style="display:block;margin:40px;padding:20px">Go</a>`),
  "/arrived": page(`<p>Arrived</p>`, 'data-done="1"'),
  // A veil sits over the button: the finger hits the veil.
  "/covered": page(`<button id="go" style="margin:40px;padding:20px">Go</button><div class="veil" style="position:fixed;inset:0"></div><script>go.onclick = () => { document.body.dataset.done = "1"; };</script>`),
  // The target is there but has no box.
  "/hidden": page(`<button id="go" style="display:none">Go</button>`),
  // No viewport meta: the layout is 980 px wide and scaled down to the phone.
  "/zoomed": `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><button id="go" style="margin:300px 600px;padding:40px">Go</button><script>go.onclick = () => { document.body.dataset.done = "1"; };</script></body></html>`,
};

suite("probe:tap end to end", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base = "";

  beforeAll(() => {
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
  });

  async function probe(path: string, selector: string, expectSel: string, extra: string[] = []) {
    const run = Bun.spawn([process.execPath, "run", "scripts/tap-probe.ts", base + path, selector, "--expect", expectSel, "--wait", "300", "--json", ...extra], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    return { code, err, report: out.trim() ? (JSON.parse(out) as Report) : null };
  }

  test("a page that acts on the first tap passes", async () => {
    const r = await probe("/one", "#go", "body[data-done]");
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.report?.verdict).toBe("ok");
    expect(r.report?.matchesBefore).toBe(0);
    expect(r.report?.matchesAfter).toBe(1);
  }, 60_000);

  test("teeth: a page that needs two taps fails with exit 1", async () => {
    const r = await probe("/two", "#go", "body[data-done]");
    expect(r.code).toBe(1);
    expect(r.report?.verdict).toBe("fail");
    expect(r.report?.matchesAfter).toBe(0);
  }, 60_000);

  test("an expectation that held before the tap is void, exit 2", async () => {
    const r = await probe("/void", "#go", "body[data-done]");
    expect(r.code).toBe(2);
    expect(r.report?.verdict).toBe("vacuous");
  }, 60_000);

  test("a tap on a link follows the navigation and checks the new page", async () => {
    const r = await probe("/link", "#go", "body[data-done]");
    expect(r.code).toBe(0);
    expect(r.report?.path).toEqual({ before: "/link", after: "/arrived" });
  }, 60_000);

  test("a target under a veil is tapped where a finger would land, and the veil is named", async () => {
    const r = await probe("/covered", "#go", "body[data-done]");
    expect(r.code).toBe(1);
    expect(r.report?.landedOn).toBe("div.veil");
  }, 60_000);

  test("a missing or hidden target is a setup error, exit 2", async () => {
    const missing = await probe("/one", "#nope", "body[data-done]");
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("no element matches #nope");
    const hidden = await probe("/hidden", "#go", "body[data-done]");
    expect(hidden.code).toBe(2);
    expect(hidden.err).toContain("no box");
  }, 60_000);

  test("a page with no viewport meta (laid out at 980 px, scaled to the phone) is still tapped on target", async () => {
    const r = await probe("/zoomed", "#go", "body[data-done]");
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  }, 60_000);

  test("a bad argument exits 2 with the usage line", async () => {
    const run = Bun.spawn([process.execPath, "run", "scripts/tap-probe.ts", base + "/one", "#go"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [err, code] = await Promise.all([new Response(run.stderr).text(), run.exited]);
    expect(code).toBe(2);
    expect(err).toContain("--expect");
    expect(err).toContain("usage:");
  }, 30_000);
});
