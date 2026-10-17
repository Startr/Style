// Hover probe: does any button on a page change background on hover without
// asking to? A fast, heuristic gate for the class of regression 1.4.0 shipped
// (button:hover painted every transparent button --primary).
//
//   bun run probe:hover <url> [--width 1280] [--login email:password] [--sheet FILE] [--json]
//
// It loads the page once, turns transitions off, forces :hover on every
// visible button (button, .button, input[type=submit|button]) and compares the
// computed background-color at rest and hovered. A change is FLAGGED when the
// button was transparent at rest and its inline style asks for no hover
// (--bg-hover, --bgc-hover, --bg-in-hover, --hvr-bg, --hvr-bgc): nothing in
// the page wanted that paint. Other changes are counted, not flagged.
//
// --sheet FILE serves that file wherever the page loads the kit from
// startr.style (style.css, style.min.css or startr.css), so a candidate build
// is checked against the real consumer page before it is published.
// --login signs in the AI-UI way (POST /api/v1/auths/signin, cookie plus the
// token in localStorage) before loading the page. Exit 1 when anything is
// flagged, 2 on a setup error. One page takes a few seconds.

import { readFileSync } from "node:fs";
import { findChrome, launch } from "./cdp";

type Row = { i: number; tag: string; cls: string; text: string; style: string; rest: string; hover?: string };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const url = args.find((a) => /^https?:\/\//.test(a));
if (!url) {
  console.error("usage: bun run probe:hover <url> [--width 1280] [--login email:password] [--sheet FILE] [--json]");
  process.exit(2);
}
const width = Number(flag("--width") ?? 1280);
const login = flag("--login");
const sheet = flag("--sheet");
const json = args.includes("--json");
if (!findChrome()) {
  console.error("no Chrome found (set CHROME_BIN)");
  process.exit(2);
}

const CLEAR = new Set(["rgba(0, 0, 0, 0)", "transparent"]);
const WANTS_HOVER = /--(bg|bgc)-(in-)?hover\s*:|--hvr-(bg|bgc)\s*:/;
const KIT_URL = /startr\.style\/(style(\.min)?\.css|startr\.css)(\?|$)/;
const settled = `new Promise(r => { const done = () => (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(r, 150)); document.readyState === "complete" ? done() : addEventListener("load", done, { once: true }); })`;

const chrome = await launch();
let served = 0;
try {
  const page = await chrome.newPage();
  await page.setViewport(width, 900);

  if (sheet) {
    const body = readFileSync(sheet).toString("base64");
    chrome.on("Fetch.requestPaused", (p: any, session?: string) => {
      if (KIT_URL.test(p.request.url)) {
        served++;
        void chrome.send("Fetch.fulfillRequest", {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "text/css; charset=utf-8" },
            { name: "Access-Control-Allow-Origin", value: "*" },
            { name: "Cache-Control", value: "no-store" },
          ],
          body,
        }, session);
      } else {
        void chrome.send("Fetch.continueRequest", { requestId: p.requestId }, session);
      }
    });
    await page.send("Fetch.enable", {
      patterns: ["*startr.style/style.css*", "*startr.style/style.min.css*", "*startr.style/startr.css*"].map((urlPattern) => ({ urlPattern, requestStage: "Request" })),
    });
  }

  await page.goto(url);
  await page.eval(settled);

  if (login) {
    const [email, password] = login.split(":", 2);
    const res = await page.eval<{ status: number; token: string | null }>(`(async () => {
      const r = await fetch('/api/v1/auths/signin', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }) });
      let j = null; try { j = await r.json(); } catch {}
      if (j && j.token) localStorage.setItem('token', j.token);
      return { status: r.status, token: j && j.token ? j.token : null };
    })()`);
    if (res.status !== 200 || !res.token) {
      console.error(`login failed: HTTP ${res.status}`);
      process.exit(2);
    }
    await page.goto(url);
    await page.eval(settled);
  }

  if (sheet && served === 0) {
    console.error(`--sheet given, but the page loaded no kit from startr.style (vendored, or a different URL); nothing was substituted`);
    process.exit(2);
  }

  // Hover must read instantly: no transitions, no animations.
  await page.eval(`(() => { const s = document.createElement("style"); s.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}"; document.head.appendChild(s); })()`);

  const rows = await page.eval<Row[]>(`(() => {
    const out = [];
    const els = document.querySelectorAll('button, .button, input[type="submit"], input[type="button"]');
    let i = 0;
    for (const el of els) {
      if (!el.getClientRects().length) continue;
      el.setAttribute("data-hp", String(i));
      out.push({ i, tag: el.tagName.toLowerCase(), cls: (el.getAttribute("class") || "").slice(0, 60), text: (el.textContent || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 30), style: el.getAttribute("style") || "", rest: getComputedStyle(el).backgroundColor });
      i++;
    }
    return out;
  })()`);

  for (const row of rows) {
    const sel = `[data-hp="${row.i}"]`;
    await page.forcePseudoState(sel, ["hover"]);
    row.hover = await page.style(sel, "background-color");
    await page.forcePseudoState(sel, []);
  }

  const changed = rows.filter((r) => r.hover !== r.rest);
  const flagged = changed.filter((r) => CLEAR.has(r.rest) && !WANTS_HOVER.test(r.style));
  const kit = sheet ? `${sheet} (served ${served}×)` : "live";
  const summary = { url, width, kit, probed: rows.length, changed: changed.length, flagged: flagged.length, flagged_rows: flagged };
  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`${flagged.length ? "FLAG" : "ok  "} hover  ${url} @${width} [kit: ${kit}]: ${rows.length} buttons, ${changed.length} change on hover, ${flagged.length} unasked`);
    for (const r of flagged) console.log(`  <${r.tag}${r.cls ? ` class="${r.cls}"` : ""}> "${r.text}"  ${r.rest} → ${r.hover}`);
  }
  process.exitCode = flagged.length ? 1 : 0;
} finally {
  await chrome.close();
}
