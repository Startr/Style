// A minimal Chrome DevTools Protocol client on Bun's WebSocket.
//
//   const chrome = await launch();            // headless Chrome, DevTools URL read from stderr
//   const page = await chrome.newPage(url);   // a tab, with DOM, CSS and Page enabled
//   await page.forcePseudoState("#a", ["hover"]);
//   await page.eval("getComputedStyle(document.querySelector('#a')).color");
//   await chrome.close();                     // kills Chrome and deletes the temp profile
//
// Headless Chrome clamps layouts to 500px wide. For a wider (or phone) viewport call
// page.setViewport(): it uses Emulation.setDeviceMetricsOverride, which media queries obey.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Params = Record<string, unknown>;
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; method: string };
type Waiter = { event: string; session?: string; resolve: (params: any) => void };
type Listener = (params: any, session?: string) => void;

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
];

/** The Chrome binary: CHROME_BIN, else the first known install. Null when there is none. */
export function findChrome(): string | null {
  const wanted = [process.env.CHROME_BIN, ...CANDIDATES].filter(Boolean) as string[];
  for (const name of wanted) {
    if (name.startsWith("/") ? existsSync(name) : Bun.which(name)) {
      return name.startsWith("/") ? name : (Bun.which(name) as string);
    }
  }
  return null;
}

export type LaunchOptions = {
  chrome?: string;
  /** Extra command-line flags. */
  args?: string[];
  /** How long to wait for the DevTools URL, in ms. */
  timeout?: number;
};

export async function launch(options: LaunchOptions = {}): Promise<Chrome> {
  const binary = options.chrome ?? findChrome();
  if (!binary) throw new Error("No Chrome found. Set CHROME_BIN to a Chrome or Chromium binary.");

  const profile = mkdtempSync(join(tmpdir(), "startr-cdp-"));
  const args = [
    "--headless=new",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--hide-scrollbars",
    ...(process.getuid?.() === 0 || process.env.CI ? ["--no-sandbox"] : []),
    ...(options.args ?? []),
    "about:blank",
  ];
  const proc = Bun.spawn([binary, ...args], { stdout: "ignore", stderr: "pipe", stdin: "ignore" });

  try {
    const url = await readDevToolsUrl(proc.stderr, options.timeout ?? 20_000);
    const socket = await open(url);
    return new Chrome(proc, profile, socket);
  } catch (error) {
    proc.kill();
    rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}

/** Resolve with the promise's value, or null once `ms` pass. The timer never outlives the race. */
async function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Chrome prints "DevTools listening on ws://127.0.0.1:PORT/devtools/browser/ID" to stderr. */
async function readDevToolsUrl(stderr: ReadableStream<Uint8Array>, timeout: number): Promise<string> {
  const reader = stderr.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + timeout;
  while (true) {
    const chunk = await raceTimeout(reader.read(), Math.max(1, deadline - Date.now()));
    if (chunk === null) throw new Error(`Chrome did not print a DevTools URL within ${timeout} ms:\n${seen}`);
    if (chunk.done) throw new Error(`Chrome exited before it printed a DevTools URL:\n${seen}`);
    seen += decoder.decode(chunk.value, { stream: true });
    const match = seen.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) {
      // Keep draining, so a full pipe never stalls Chrome.
      (async () => {
        while (!(await reader.read()).done) {}
      })().catch(() => {});
      return match[1];
    }
  }
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`Cannot open ${url}`)), { once: true });
  });
}

export class Chrome {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private waiters: Waiter[] = [];
  private listeners = new Map<string, Listener[]>();
  private closed = false;
  private onExit = () => this.kill();

  constructor(
    readonly proc: ReturnType<typeof Bun.spawn>,
    readonly profile: string,
    readonly socket: WebSocket,
  ) {
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", () => this.failAll(new Error("DevTools connection closed")));
    process.on("exit", this.onExit);
  }

  /** Send one command. Pass a session id to address a page. */
  send<T = any>(method: string, params: Params = {}, session?: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`${method}: Chrome is closed`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }

  /** Call a function for every event of this name, from any session. */
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  /** Resolve with the params of the next matching event. */
  waitFor<T = any>(event: string, session?: string, timeout = 15_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        event,
        session,
        resolve: (params) => {
          clearTimeout(timer);
          resolve(params);
        },
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for ${event}`));
        }
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  async newPage(url = "about:blank"): Promise<Page> {
    const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, targetId, sessionId);
    await page.init();
    if (url !== "about:blank") await page.goto(url);
    return page;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await raceTimeout(this.send("Browser.close").catch(() => {}), 2_000);
    this.closed = true;
    this.kill();
    await raceTimeout(this.proc.exited, 3_000);
    process.off("exit", this.onExit);
    try {
      this.socket.close();
    } catch {}
    rmSync(this.profile, { recursive: true, force: true });
  }

  private kill() {
    try {
      this.proc.kill();
    } catch {}
  }

  private receive(text: string) {
    const message = JSON.parse(text);
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
    this.waiters = this.waiters.filter((waiter) => {
      const match = waiter.event === message.method && (!waiter.session || waiter.session === message.sessionId);
      if (match) waiter.resolve(message.params);
      return !match;
    });
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export class Page {
  // DOM.getDocument hands out fresh node ids every time and drops the old ones, and a pseudo-state
  // forced on a dropped id is lost (or stuck, if you try to clear it). So ask once per document.
  private root: number | null = null;
  private forcedNodes = new Set<number>();

  constructor(
    readonly chrome: Chrome,
    readonly targetId: string,
    readonly session: string,
  ) {
    chrome.on("DOM.documentUpdated", (_params, session) => {
      if (session === this.session) {
        this.root = null;
        this.forcedNodes.clear();
      }
    });
  }

  /** Turn on the domains the tests use, and make the page believe it has focus. */
  async init() {
    await this.send("Page.enable");
    await this.send("DOM.enable");
    await this.send("CSS.enable");
    await this.send("Runtime.enable");
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  }

  send<T = any>(method: string, params: Params = {}): Promise<T> {
    return this.chrome.send<T>(method, params, this.session);
  }

  async goto(url: string) {
    const loaded = this.chrome.waitFor("Page.loadEventFired", this.session);
    await this.send("Page.navigate", { url });
    await loaded;
    this.root = null;
    this.forcedNodes.clear();
  }

  /** Evaluate an expression in the page and return its value (JSON-serialisable). */
  async eval<T = any>(expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`eval failed: ${text}\n${expression}`);
    }
    return result.result.value as T;
  }

  /** The node id of the first element matching a selector. Throws when there is none. */
  async node(selector: string): Promise<number> {
    if (this.root === null) {
      const { root } = await this.send("DOM.getDocument", { depth: 0 });
      this.root = root.nodeId;
    }
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: this.root, selector });
    if (!nodeId) throw new Error(`No element matches ${selector}`);
    return nodeId;
  }

  /**
   * Force pseudo-classes on one element (DevTools "Force element state"):
   * "hover", "active", "focus", "focus-visible", "focus-within", "visited", "target".
   * An empty list clears them. Only that element is forced, not its ancestors.
   */
  async forcePseudoState(selector: string, states: string[]) {
    const nodeId = await this.node(selector);
    await this.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: states });
    if (states.length) this.forcedNodes.add(nodeId);
    else this.forcedNodes.delete(nodeId);
  }

  /** Clear every pseudo-state this page forced. Call it between tests. */
  async clearForcedStates() {
    for (const nodeId of this.forcedNodes) {
      await this.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] }).catch(() => {});
    }
    this.forcedNodes.clear();
  }

  /** The computed value of one CSS property. */
  style(selector: string, property: string): Promise<string> {
    return this.eval<string>(
      `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`,
    );
  }

  /** Set the viewport. Media queries follow it. `touch` also makes hover:none and pointer:coarse true. */
  async setViewport(width: number, height = 800, touch = false) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: touch,
    });
    await this.send("Emulation.setTouchEmulationEnabled", touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  }

  /** Press and release a key, e.g. press("Tab"). Real input, so :focus-visible follows the keyboard. */
  async press(key: string, options: { shift?: boolean } = {}) {
    const codes: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, " ": 32 };
    const event = {
      key,
      code: key === " " ? "Space" : key,
      windowsVirtualKeyCode: codes[key] ?? key.toUpperCase().charCodeAt(0),
      modifiers: options.shift ? 8 : 0,
    };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...event });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
  }

  /** Move the real mouse pointer to the centre of an element. Hovers it and its ancestors. */
  async hover(selector: string) {
    const { x, y } = await this.eval<{ x: number; y: number }>(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }

  /** Click the centre of an element with the real mouse. */
  async click(selector: string) {
    const { x, y } = await this.eval<{ x: number; y: number }>(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async close() {
    await this.chrome.send("Target.closeTarget", { targetId: this.targetId }).catch(() => {});
  }
}
