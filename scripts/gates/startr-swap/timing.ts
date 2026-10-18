// Startr Swap timing gate: does `swap:after` see the NEW content?
//
//   bun run scripts/gates/startr-swap/timing.ts                      # src/static/swap.js
//   bun run scripts/gates/startr-swap/timing.ts --swap FILE          # another build
//   bun run scripts/gates/startr-swap/timing.ts --self-test          # prove it can fail
//
// The bug: under a View Transition the library replaced the region inside
// document.startViewTransition(run), whose callback runs ASYNCHRONOUSLY, and then
// fired `swap:after` right after transition() returned. A listener saw the OLD
// content. /v1/swap.js still does this and is immutable; 1.1 fixes it.
//
// How it tests: it serves the demo pages (src/demo/swap/a.njk and b.njk, which are
// plain HTML under their front matter) from a local server, with the script tag
// pointed at the build under test, so the real demo markup is what runs. In headless
// Chrome it loads a.html, registers a `swap:after` listener on the region that
// records the region's content AT THE MOMENT IT FIRES, clicks the link to b.html,
// and requires the recorded content to be B's. Then it clicks back and requires A's.
//
// Exit 0: every recorded `swap:after` saw the destination's content.
// Exit 1: one saw the old content, or never fired.
// Exit 2: setup error (no Chrome, no View Transitions in this Chrome, a demo page missing).
// --self-test: exits 0 only when /v1/swap.js FAILS the check and src/static/swap.js PASSES it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../../../src/style-core/scripts/cdp";

const ROOT = join(import.meta.dir, "../../..");
const CURRENT = join(ROOT, "src/static/swap.js");
const PINNED_V1 = join(ROOT, "src/static/v1/swap.js");
const UNDER_TEST = "/__swap-under-test.js";

class SetupError extends Error {}

/** A demo page as the browser gets it: the njk front matter off, the script tag pointed at the build under test. */
export function demoPage(source: string): string {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const tag = /src="\/v\d+(?:\.\d+)*\/swap\.js"/;
  if (!tag.test(body)) throw new SetupError("a demo page no longer loads a pinned /vN/swap.js; update this gate");
  return body.replace(tag, `src="${UNDER_TEST}"`);
}

/** What each swap:after saw, against what it should have seen. */
export function judge(seen: string[], wanted: string[]): { ok: boolean; why: string } {
  if (seen.length !== wanted.length) return { ok: false, why: `swap:after fired ${seen.length} time(s), wanted ${wanted.length}` };
  const wrong = seen.map((s, i) => (s === wanted[i] ? null : `swap #${i + 1}: the listener read "${s}", the page was going to "${wanted[i]}"`)).filter(Boolean);
  return wrong.length ? { ok: false, why: wrong.join("; ") } : { ok: true, why: "" };
}

export type Result = { ok: boolean; why: string; seen: string[]; viewTransitions: boolean };

export async function run(swapFile: string): Promise<Result> {
  const swapSource = readFileSync(swapFile, "utf8");
  const pages: Record<string, string> = {};
  for (const name of ["a", "b"]) {
    try {
      pages[`/demo/swap/${name}.html`] = demoPage(readFileSync(join(ROOT, `src/demo/swap/${name}.njk`), "utf8"));
    } catch (error) {
      if (error instanceof SetupError) throw error;
      throw new SetupError(`cannot read the demo page src/demo/swap/${name}.njk`);
    }
  }
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === UNDER_TEST) return new Response(swapSource, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
      const html = pages[path];
      return html ? new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }) : new Response("not found", { status: 404 });
    },
  });
  const chrome = await launch();
  try {
    const page = await chrome.newPage();
    await page.setViewport(1024, 768);
    await page.goto(`http://127.0.0.1:${server.port}/demo/swap/a.html`);
    const installed = await page.eval<boolean>(
      `new Promise(r => { const t0 = Date.now(); const id = setInterval(() => { if (document.documentElement.hasAttribute("data-swap-installed") || Date.now() - t0 > 3000) { clearInterval(id); r(document.documentElement.hasAttribute("data-swap-installed")); } }, 20); })`,
    );
    if (!installed) throw new SetupError(`${swapFile} did not install on the demo page`);
    const viewTransitions = await page.eval<boolean>(`"startViewTransition" in document && !matchMedia("(prefers-reduced-motion: reduce)").matches`);
    if (!viewTransitions) throw new SetupError("this Chrome has no View Transitions (or reduced motion is on): the bug cannot show, so a pass would prove nothing");

    // The listener records what the region holds WHEN swap:after fires, not what it holds later.
    await page.eval(`(() => {
      window.__seen = [];
      document.querySelector("[data-swap]").addEventListener("swap:after", () => {
        const who = document.querySelector("[data-swap] #who");
        window.__seen.push(who ? who.textContent : "(no #who in the region)");
      });
    })()`);

    // Click a link, then wait until the swap has fired AND the page shows the destination.
    const hop = async (link: string, expectedNow: string) => {
      await page.click(link);
      await page.eval(
        `new Promise(r => { const t0 = Date.now(); const id = setInterval(() => { const who = document.getElementById("who"); if ((window.__seen.length && who && who.textContent === ${JSON.stringify(expectedNow)}) || Date.now() - t0 > 4000) { clearInterval(id); r(null); } }, 20); })`,
      );
      // Let the view transition's animation finish so the next click lands on settled layout.
      await Bun.sleep(450);
    };
    await hop("#to-b", "B");
    await hop("#to-a", "A");

    const seen = await page.eval<string[]>("window.__seen");
    const verdict = judge(seen, ["B", "A"]);
    return { ...verdict, seen, viewTransitions };
  } finally {
    await chrome.close();
    server.stop(true);
  }
}

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<number> {
  if (!findChrome()) throw new SetupError("no Chrome found (set CHROME_BIN)");

  if (process.argv.includes("--self-test")) {
    const bad = await run(PINNED_V1);
    const good = await run(CURRENT);
    console.log(`  /v1/swap.js          ${bad.ok ? "PASSED (the gate has no teeth)" : `failed, as it must: ${bad.why}`}`);
    console.log(`  src/static/swap.js   ${good.ok ? "passed, as it must" : `FAILED: ${good.why}`}`);
    if (bad.ok || !good.ok) {
      console.log("FAIL -- the timing gate does not tell the old build from the fixed one.");
      return 1;
    }
    console.log("PASS -- the timing gate fails the old build and passes the fixed one.");
    return 0;
  }

  const file = arg("--swap") ?? CURRENT;
  const result = await run(file);
  if (result.ok) {
    console.log(`PASS -- swap:after saw the new content on both swaps (${file.replace(`${ROOT}/`, "")}).`);
    return 0;
  }
  console.log(`FAIL -- ${result.why} (${file.replace(`${ROOT}/`, "")})`);
  console.log("        swap:after must fire inside the view transition's callback, once the content is in.");
  return 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
