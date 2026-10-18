// Shared parts of the page probes (tap-probe.ts, diff-probe.ts): argument
// pieces, the AI-UI sign-in, the "page has settled" expressions and the
// stylesheet substitution that hover-probe.ts does with --sheet.
//
// Everything here that does not need a browser is pure, and is tested in
// probe-util.test.ts.

import { readFileSync } from "node:fs";
import type { Chrome, Page } from "./cdp";

/** The kit URLs a page loads from startr.style. The same set hover-probe.ts substitutes. */
export const KIT_URL = /startr\.style\/(style(\.min)?\.css|startr\.css)(\?|$)/;
const KIT_PATTERNS = ["*startr.style/style.css*", "*startr.style/style.min.css*", "*startr.style/startr.css*"];

export type Viewport = { width: number; height: number };

export type SplitArgs = { positional: string[]; values: Map<string, string[]>; flags: Set<string> };

/**
 * Split argv into positionals, valued flags (kept in order, so a flag may repeat) and boolean flags.
 * An unknown flag, or a valued flag at the end of the line, is an error.
 */
export function splitArgs(argv: string[], valueFlags: string[], boolFlags: string[]): SplitArgs | { error: string } {
  const positional: string[] = [];
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (boolFlags.includes(a)) flags.add(a);
    else if (valueFlags.includes(a)) {
      const v = argv[++i];
      if (v === undefined) return { error: `${a} needs a value` };
      values.set(a, [...(values.get(a) ?? []), v]);
    } else if (a.startsWith("--")) return { error: `unknown flag ${a}` };
    else positional.push(a);
  }
  return { positional, values, flags };
}

/** "390x844" -> { width: 390, height: 844 }. Null when it is not WIDTHxHEIGHT. */
export function parseViewport(text: string): Viewport | null {
  const m = /^(\d{2,5})x(\d{2,5})$/i.exec(text.trim());
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** "email:password" -> parts, split on the FIRST colon so a password may hold one. Null when there is no colon. */
export function parseLogin(text: string): { email: string; password: string } | null {
  const at = text.indexOf(":");
  if (at <= 0) return null;
  return { email: text.slice(0, at), password: text.slice(at + 1) };
}

/** "name=value" -> parts, split on the FIRST "=" so the value may hold one (base64 does). */
export function parseCookie(text: string): { name: string; value: string } | null {
  const at = text.indexOf("=");
  if (at <= 0) return null;
  return { name: text.slice(0, at).trim(), value: text.slice(at + 1) };
}

/** "390,1280" -> [390, 1280]. Null on anything else, or on an empty list. */
export function parseWidths(text: string): number[] | null {
  const parts = text.split(",").map((p) => p.trim());
  if (!parts.length || parts.some((p) => !/^\d{2,5}$/.test(p))) return null;
  return parts.map(Number);
}

/** A filename-safe slug for a URL: host, port and path, no scheme or query. */
export function slugify(url: string): string {
  let text = url;
  try {
    const u = new URL(url);
    text = `${u.host}${u.pathname}`;
  } catch {}
  const slug = text.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return slug.slice(0, 80) || "page";
}

/** Load finished, fonts in, plus a beat for late paint. */
export const SETTLED = `new Promise(r => { const done = () => (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(r, 150)); document.readyState === "complete" ? done() : addEventListener("load", done, { once: true }); })`;

/**
 * Resolves with the number of nodes once it has held steady for 750 ms (three polls). A single-page
 * app keeps rendering after load, and a probe that reads early sees a fraction of the page. Gives up
 * after 8 s with the last count.
 */
export const stableCount = (selector: string) =>
  `new Promise(r => { let last = -1, same = 0; const t = setInterval(() => { const n = document.querySelectorAll(${JSON.stringify(selector)}).length; if (n === last) { if (++same >= 3) { clearInterval(t); r(n); } } else { same = 0; last = n; } }, 250); setTimeout(() => { clearInterval(t); r(last); }, 8000); })`;

/** Turn transitions and animations off, so a computed style is its final value. */
export const FREEZE_MOTION = `(() => { const s = document.createElement("style"); s.textContent = "*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}"; document.head.appendChild(s); })()`;

/** Sign in the AI-UI way (POST /api/v1/auths/signin: cookie, plus the token in localStorage). Returns the HTTP status. */
export async function signIn(page: Page, login: { email: string; password: string }): Promise<{ status: number; token: boolean }> {
  const res = await page.eval<{ status: number; token: string | null }>(`(async () => {
    const r = await fetch('/api/v1/auths/signin', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(login.email)}, password: ${JSON.stringify(login.password)} }) });
    let j = null; try { j = await r.json(); } catch {}
    if (j && j.token) localStorage.setItem('token', j.token);
    return { status: r.status, token: j && j.token ? j.token : null };
  })()`);
  return { status: res.status, token: !!res.token };
}

/** Set cookies for a URL before the page loads. */
export async function setCookies(page: Page, url: string, cookies: { name: string; value: string }[]) {
  for (const c of cookies) await page.send("Network.setCookie", { name: c.name, value: c.value, url });
}

export type SheetSwap = {
  /** The stylesheet to serve in place of the kit, base64 (see readSheet), or null to let the live one through. */
  body: string | null;
  /** How many requests it replaced. */
  served: number;
};

/**
 * Substitute a stylesheet wherever the page loads the kit, the way hover-probe --sheet does. The
 * returned object is live: set `swap.body` between loads to change what the next load gets.
 * `match` replaces the default startr.style URL test (a page that vendors the kit under its own path).
 */
export async function serveSheets(chrome: Chrome, page: Page, match: RegExp = KIT_URL): Promise<SheetSwap> {
  const swap: SheetSwap = { body: null, served: 0 };
  chrome.on("Fetch.requestPaused", (p: any, session?: string) => {
    if (session !== page.session) return;
    if (swap.body !== null && match.test(p.request.url)) {
      swap.served++;
      void chrome.send("Fetch.fulfillRequest", {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/css; charset=utf-8" },
          { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Cache-Control", value: "no-store" },
        ],
        body: swap.body,
      }, session);
    } else {
      void chrome.send("Fetch.continueRequest", { requestId: p.requestId }, session);
    }
  });
  // A custom match can hit any URL, so ask for them all; the default hits three known ones.
  await page.send("Fetch.enable", {
    patterns: (match === KIT_URL ? KIT_PATTERNS : ["*"]).map((urlPattern) => ({ urlPattern, requestStage: "Request" })),
  });
  return swap;
}

/** A stylesheet file as the base64 body Fetch.fulfillRequest wants. */
export const readSheet = (path: string) => readFileSync(path).toString("base64");
