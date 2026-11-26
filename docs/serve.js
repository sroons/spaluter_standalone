#!/usr/bin/env node
// Local preview server for the Spiluter site. No dependencies.
//   npm run site            → http://localhost:4173
//   PORT=8080 npm run site
// Pages reload by themselves when a file under docs/ changes.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".mp4": "video/mp4"
};
const RELOAD_SNIPPET = `<script>new EventSource("/__reload").onmessage = () => location.reload();</script>`;
const clients = new Set();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/__reload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("retry: 500\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (_e) { rel = "/"; }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, path.normalize(rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end(`Not found: ${rel}`);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    if (ext === ".html") {
      res.end(data.toString("utf8").replace("</body>", `${RELOAD_SNIPPET}\n  </body>`));
    } else {
      res.end(data);
    }
  });
});

let timer = null;
try {
  fs.watch(ROOT, { recursive: true }, (_event, name) => {
    if (name && (name.startsWith("tools") || name === "serve.js")) return;
    clearTimeout(timer);
    timer = setTimeout(() => clients.forEach((res) => res.write("data: reload\n\n")), 80);
  });
} catch (_e) {
  console.log("File watching is not available here; refresh the browser by hand.");
}

server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE"
    ? `Port ${PORT} is in use. Try: PORT=${PORT + 1} npm run site`
    : err.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Spiluter site: http://localhost:${PORT}  (Ctrl+C to stop)`);
});
