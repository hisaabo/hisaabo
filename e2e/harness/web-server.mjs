/**
 * web-server.mjs — static server for the production web build, with the same
 * `/api` reverse proxy the Vite dev server has (apps/web/vite.config.ts
 * `server.proxy`). Deliberately tiny: no Vite in the process, no watchers.
 *
 * Also answers `/__e2e_ready` (200 only once the upstream API reports healthy),
 * which Playwright's webServer polls instead of the SPA root.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

/**
 * @param {{ root: string, port: number, apiPort: number, isReady?: () => boolean }} opts
 * @returns {Promise<http.Server>}
 */
export function startWebServer({ root, port, apiPort, isReady = () => true }) {
  const indexHtml = path.join(root, "index.html");

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/__e2e_ready") {
      if (!isReady()) {
        res.writeHead(503).end("starting");
        return;
      }
      http
        .get({ host: "localhost", port: apiPort, path: "/health", timeout: 2_000 }, (r) => {
          r.resume();
          res.writeHead(r.statusCode === 200 ? 200 : 503).end();
        })
        .on("error", () => res.writeHead(503).end("api down"));
      return;
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const upstream = http.request(
        {
          host: "localhost",
          port: apiPort,
          path: req.url,
          method: req.method,
          // changeOrigin: true, as in the Vite proxy
          headers: { ...req.headers, host: `localhost:${apiPort}` },
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }

    let file;
    try {
      file = path.join(root, path.normalize(decodeURIComponent(url.pathname)));
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    let stat = fs.statSync(file, { throwIfNoEntry: false });
    // History-API fallback, as Vite's dev/preview servers do: an unknown path
    // without an extension is a client-side route, served by index.html.
    if ((!stat || stat.isDirectory()) && !path.extname(url.pathname)) {
      file = indexHtml;
      stat = fs.statSync(file, { throwIfNoEntry: false });
    }
    if (!stat?.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": stat.size,
      // hashed assets are immutable; index.html must always be revalidated
      "cache-control": file === indexHtml ? "no-cache" : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}
