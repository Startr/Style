// Tap probe: does ONE tap on a phone do the job? A fast gate for the class of
// page that needs two taps: the first tap lands as :hover (or a half-run
// handler) and only the second one acts.
//
//   bun run probe:tap <url> <selector> --expect <css selector> [--login email:password]
//                     [--cookie name=value]... [--viewport 390x844] [--wait 1500] [--json]
//
// It emulates a touch phone, loads the page, taps the first visible match of
// <selector> once with Input.dispatchTouchEvent (a real touch, so the browser
// runs its tap gesture: hover, click, the lot), waits, and checks that
// --expect matches at least one element. Exit 0 when it does, 1 when one tap
// was not enough, 2 on a setup error: bad arguments, no Chrome, a failed login,
// a missing or hidden target, or an expectation that already held before the
// tap (then the probe proves nothing).
//
// --login signs in the AI-UI way (POST /api/v1/auths/signin). --cookie sets a
// cookie before the load (Django: --cookie sessionid=...); repeat it for more.

import { findChrome, launch } from "./cdp";
import { FREEZE_MOTION, parseCookie, parseLogin, parseViewport, setCookies, SETTLED, signIn, splitArgs, stableCount } from "./probe-util";

export const USAGE =
  "usage: bun run probe:tap <url> <selector> --expect <css selector> [--login email:password] [--cookie name=value]... [--viewport 390x844] [--wait ms] [--json]";

export type Options = {
  url: string;
  selector: string;
  expect: string;
  login: { email: string; password: string } | null;
  cookies: { name: string; value: string }[];
  viewport: { width: number; height: number };
  wait: number;
  json: boolean;
};

/** Parse argv (without bun and the script). Returns the options, or the message to print before exit 2. */
export function parseArgs(argv: string[]): Options | { error: string } {
  const split = splitArgs(argv, ["--expect", "--login", "--cookie", "--viewport", "--wait"], ["--json"]);
  if ("error" in split) return split;
  const { positional, values, flags } = split;
  const json = flags.has("--json");
  const [url, selector, ...rest] = positional;
  if (!url || !/^(https?|file):\/\//.test(url)) return { error: "the first argument must be a URL (http, https or file)" };
  if (!selector) return { error: "the second argument must be the selector to tap" };
  if (rest.length) return { error: `unexpected argument ${rest[0]}` };
  const expectSel = values.get("--expect")?.[0];
  if (!expectSel) return { error: "--expect <css selector> is required: say what one tap must leave on the page" };

  const loginText = values.get("--login")?.[0];
  const login = loginText === undefined ? null : parseLogin(loginText);
  if (loginText !== undefined && !login) return { error: "--login wants email:password" };

  const cookies: { name: string; value: string }[] = [];
  for (const text of values.get("--cookie") ?? []) {
    const c = parseCookie(text);
    if (!c) return { error: `--cookie wants name=value, got "${text}"` };
    cookies.push(c);
  }

  const viewportText = values.get("--viewport")?.[0];
  const viewport = viewportText === undefined ? { width: 390, height: 844 } : parseViewport(viewportText);
  if (!viewport) return { error: "--viewport wants WIDTHxHEIGHT, such as 390x844" };

  const waitText = values.get("--wait")?.[0];
  const wait = waitText === undefined ? 1500 : Number(waitText);
  if (!Number.isFinite(wait) || wait < 0) return { error: "--wait wants a number of milliseconds" };

  return { url, selector, expect: expectSel, login, cookies, viewport, wait, json };
}

export type Verdict = "ok" | "fail" | "vacuous";

/** One tap is enough when the expectation matches after it. It proves nothing when it matched before. */
export function verdict(before: number, after: number): Verdict {
  if (before > 0) return "vacuous";
  return after > 0 ? "ok" : "fail";
}

export const EXIT: Record<Verdict, number> = { ok: 0, fail: 1, vacuous: 2 };

export type Report = {
  url: string;
  viewport: string;
  selector: string;
  expect: string;
  verdict: Verdict;
  tapped: { tag: string; text: string; x: number; y: number } | null;
  /** The element under the finger, when it is not the target or inside it. */
  landedOn: string | null;
  matchesBefore: number;
  matchesAfter: number;
  path: { before: string; after: string };
};

export function formatReport(r: Report): string {
  const head = r.verdict === "ok" ? "ok  " : r.verdict === "fail" ? "FAIL" : "VOID";
  const what = `<${r.tapped?.tag ?? "?"}>${r.tapped?.text ? ` "${r.tapped.text}"` : ""}`;
  const lines = [`${head} tap   ${r.url} @${r.viewport}: one tap on ${r.selector} (${what})`];
  if (r.verdict === "ok") lines.push(`  --expect ${r.expect}: ${r.matchesBefore} before, ${r.matchesAfter} after`);
  else if (r.verdict === "fail") lines.push(`  --expect ${r.expect} still matches nothing after one tap: the page needs a second tap`);
  else lines.push(`  --expect ${r.expect} already matched ${r.matchesBefore} element(s) BEFORE the tap, so the probe proves nothing; pick an expectation the tap creates`);
  if (r.landedOn) lines.push(`  the finger landed on ${r.landedOn}, not on the target: something covers it`);
  if (r.path.before !== r.path.after) lines.push(`  navigated ${r.path.before} -> ${r.path.after}`);
  return lines.join("\n");
}

/** A problem with the setup, not the page: exit 2. Thrown, not process.exit()ed, so Chrome's profile is cleaned up. */
class SetupError extends Error {}

async function run(o: Options) {
  const chrome = await launch();
  try {
    const page = await chrome.newPage();
    await page.setViewport(o.viewport.width, o.viewport.height, true);
    await setCookies(page, o.url, o.cookies);
    const ready = async () => {
      await page.eval(SETTLED);
      await page.eval(stableCount("*"));
    };

    await page.goto(o.url);
    await ready();
    if (o.login) {
      const res = await signIn(page, o.login);
      if (res.status !== 200 || !res.token) throw new SetupError(`login failed: HTTP ${res.status}`);
      await page.goto(o.url);
      await ready();
    }
    await page.eval(FREEZE_MOTION);

    const count = (sel: string) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;
    let matchesBefore: number;
    try {
      matchesBefore = await page.eval<number>(count(o.expect));
    } catch {
      throw new SetupError(`--expect is not a valid selector: ${o.expect}`);
    }
    const pathBefore = await page.eval<string>("location.pathname + location.search");

    type Target = { found: boolean; visible?: boolean; tag?: string; text?: string; x?: number; y?: number; landedOn?: string | null };
    const target = await page.eval<Target>(`(() => {
      let el; try { el = document.querySelector(${JSON.stringify(o.selector)}); } catch { return { found: false }; }
      if (!el) return { found: false };
      el.scrollIntoView({ block: "center", inline: "center" });
      if (!el.getClientRects().length) return { found: true, visible: false };
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const name = (n) => n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (n.getAttribute("class") ? "." + n.getAttribute("class").trim().split(/\\s+/).slice(0, 2).join(".") : "");
      return { found: true, visible: true, tag: el.tagName.toLowerCase(), text: (el.textContent || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 30), x, y, landedOn: hit && el !== hit && !el.contains(hit) ? name(hit) : null };
    })()`);
    if (!target.found) throw new SetupError(`no element matches ${o.selector}`);
    if (!target.visible) throw new SetupError(`${o.selector} matches an element with no box (hidden); nothing to tap`);

    // One finger down and up: the browser turns it into a tap, with hover and click.
    const point = { x: target.x!, y: target.y! };
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await Bun.sleep(40);
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await Bun.sleep(o.wait);

    // A tap on a link may navigate; the old execution context dies, so ask again until the new page answers.
    let matchesAfter = 0;
    let pathAfter = pathBefore;
    for (let attempt = 0; ; attempt++) {
      try {
        await page.eval(SETTLED);
        matchesAfter = await page.eval<number>(count(o.expect));
        pathAfter = await page.eval<string>("location.pathname + location.search");
        break;
      } catch (error) {
        if (attempt >= 8) throw error;
        await Bun.sleep(250);
      }
    }

    const report: Report = {
      url: o.url,
      viewport: `${o.viewport.width}x${o.viewport.height}`,
      selector: o.selector,
      expect: o.expect,
      verdict: verdict(matchesBefore, matchesAfter),
      tapped: { tag: target.tag!, text: target.text ?? "", x: Math.round(point.x), y: Math.round(point.y) },
      landedOn: target.landedOn ?? null,
      matchesBefore,
      matchesAfter,
      path: { before: pathBefore, after: pathAfter },
    };
    console.log(o.json ? JSON.stringify(report, null, 2) : formatReport(report));
    process.exitCode = EXIT[report.verdict];
  } finally {
    await chrome.close();
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
