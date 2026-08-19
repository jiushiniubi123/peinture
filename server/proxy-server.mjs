// Local dev helper: serves the built SPA and proxies Model Scope API calls
// through a same-origin endpoint (/ms-proxy/*) to bypass Model Scope's CORS
// restrictions on its custom X-ModelScope-* headers.
// Usage: node server/proxy-server.mjs [port] [distDir]
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const DIST_DIR = process.argv[3] || join(process.cwd(), "dist");
const MS_UPSTREAM = "https://api-inference.modelscope.cn";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

// Forwarded-to-upstream headers (stripped from browser-only headers).
const UPSTREAM_HEADERS = [
  "authorization",
  "content-type",
  "x-modelscope-task-type",
  "x-modelscope-async-mode",
  "user-agent",
];

function addCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,X-ModelScope-Task-Type,X-ModelScope-Async-Mode",
  );
  res.setHeader("Access-Control-Expose-Headers", "Content-Length,Content-Range");
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = normalize(join(DIST_DIR, urlPath));
  if (!filePath.startsWith(normalize(DIST_DIR))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA fallback
    const idx = join(DIST_DIR, "index.html");
    if (existsSync(idx)) {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      createReadStream(idx).pipe(res);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
    return;
  }
  const type = MIME[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  createReadStream(filePath).pipe(res);
}

async function proxyMs(req, res) {
  // req.url like /ms-proxy/v1/images/generations
  const upstreamUrl = MS_UPSTREAM + req.url.replace(/^\/ms-proxy/, "");
  const headers = {};
  for (const h of UPSTREAM_HEADERS) {
    const v = req.headers[h];
    if (v !== undefined) headers[h] = v;
  }
  headers["accept"] = req.headers["accept"] || "*/*";

  try {
    // Buffer the (small) JSON request body, then forward upstream with fetch.
    // Node's global fetch is proxied by the sandbox preload, so the upstream
    // call goes through the egress proxy automatically.
    let body;
    if (!["GET", "HEAD"].includes(req.method)) {
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
    // Set CORS headers BEFORE writeHead (writeHead sends headers to the client).
    addCors(res);
    res.writeHead(upstreamRes.status, {
      "content-type": upstreamRes.headers.get("content-type") || "application/json",
      "content-length": data.length,
    });
    res.end(data);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      addCors(res);
    }
    res.end(JSON.stringify({ error: `Proxy upstream error: ${err.message}`, stack: err.stack }));
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    addCors(res);
    res.end();
    return;
  }
  if (req.url.startsWith("/ms-proxy")) {
    proxyMs(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[proxy-server] serving ${DIST_DIR} on http://0.0.0.0:${PORT}`);
  console.log(`[proxy-server] /ms-proxy/* -> ${MS_UPSTREAM}/*`);
});
