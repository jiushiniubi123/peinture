// Peinture local proxy server
//
// Two jobs:
//  1. Serve the built frontend (dist/) as a static site on the same origin.
//  2. Proxy /ms-proxy/* requests to the ModelScope API so the browser never
//     hits ModelScope's CORS restrictions (the frontend talks to the proxy,
//     and the proxy talks to ModelScope server-side).
//
// Usage:
//   node server/proxy-server.mjs [port] [staticDir]
//   e.g. node server/proxy-server.mjs 4173 /workspace/dist

import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const PORT = Number(process.argv[2] || 4173);
const STATIC_DIR = process.argv[3] || join(process.cwd(), "dist");

// ModelScope upstream. All /ms-proxy/* paths are rewritten onto this base.
const MS_UPSTREAM = "https://api-inference.modelscope.cn";

// Headers that are forwarded verbatim from the browser to the upstream API.
const UPSTREAM_HEADERS = [
  "authorization",
  "content-type",
  "x-modelscope-task-type",
  "accept",
  "user-agent",
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function addCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-ModelScope-Task-Type",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function proxyMs(req, res) {
  // strip /ms-proxy prefix and forward to the upstream
  const upstreamPath = req.url.replace(/^\/ms-proxy/, "");
  const upstreamUrl = MS_UPSTREAM + upstreamPath;

  // forward the browser's request headers
  const headers = {};
  for (const h of UPSTREAM_HEADERS) {
    const v = req.headers[h];
    if (v !== undefined) headers[h] = v;
  }
  if (!headers["accept"]) headers["accept"] = "*/*";

  try {
    // read the request body if present
    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks).toString("utf8");
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: body || undefined,
    });

    const data = Buffer.from(await upstreamRes.arrayBuffer());
    addCors(res);
    res.writeHead(upstreamRes.status, {
      "content-type": upstreamRes.headers.get("content-type") || "application/json",
      "content-length": data.length,
    });
    res.end(data);
  } catch (err) {
    if (!res.headersSent) {
      addCors(res);
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(
      JSON.stringify({
        error: `Proxy upstream error: ${err.message}`,
      }),
    );
  }
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === "/") pathname = "/index.html";

  // resolve and guard against path traversal
  const filePath = normalize(join(STATIC_DIR, pathname));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(STATIC_DIR, "index.html");

  const ext = extname(target);
  const type = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });
  createReadStream(target).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    addCors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url.startsWith("/ms-proxy")) {
    proxyMs(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[proxy-server] listening on http://localhost:${PORT}`);
  console.log(`[proxy-server] static dir: ${STATIC_DIR}`);
  console.log(`[proxy-server] /ms-proxy -> ${MS_UPSTREAM}`);
});
