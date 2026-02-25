import { watch } from "fs";
import { join, extname } from "path";

const PORT = 3000;
const ROOT = import.meta.dir;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".map": "application/json",
};

// --- Build ---
async function build() {
  const proc = Bun.spawn(["bun", "run", "build.ts"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  return proc.exitCode === 0;
}

// --- SSE clients for live reload ---
const clients = new Set<ReadableStreamDefaultController>();

function notifyReload() {
  for (const controller of clients) {
    try {
      controller.enqueue("data: reload\n\n");
    } catch {
      clients.delete(controller);
    }
  }
}

// --- File watcher ---
let buildTimeout: ReturnType<typeof setTimeout> | null = null;

watch(join(ROOT, "src"), { recursive: true }, () => {
  if (buildTimeout) clearTimeout(buildTimeout);
  buildTimeout = setTimeout(async () => {
    console.log("\nRebuilding...");
    const ok = await build();
    if (ok) notifyReload();
  }, 200);
});

// --- HTTP server ---
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // SSE endpoint for live reload
    if (pathname === "/__reload") {
      const stream = new ReadableStream({
        start(controller) {
          clients.add(controller);
        },
        cancel(controller) {
          clients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Serve files
    if (pathname === "/") pathname = "/index.html";
    const filePath = join(ROOT, pathname);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      // Inject live reload script into HTML
      if (ext === ".html") {
        let html = await file.text();
        const reloadScript = `<script>new EventSource("/__reload").onmessage=()=>location.reload()</script>`;
        html = html.replace("</body>", `${reloadScript}\n</body>`);
        return new Response(html, {
          headers: { "Content-Type": "text/html" },
        });
      }

      return new Response(file, {
        headers: { "Content-Type": contentType },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

// --- Initial build and start ---
console.log("Building...");
await build();
console.log(`\nServing at http://localhost:${PORT}`);
console.log("Watching src/ for changes...");
