const http = require("http");
const fs = require("fs");
const path = require("path");
const logBus = require("./eventBus");
const blocked = require("./blockedStore");

const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit for request bodies

// Cache MIME types for common extensions
const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function createAdminServer({ port = 8080, staticDir }) {
  const clients = new Set();

  const server = http.createServer((req, res) => {
    if (req.url === "/events") {
      // SSE stream
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.flushHeaders && res.flushHeaders();
      res.write(`retry: 2000\n\n`);

      const onEvent = (evt) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      };
      logBus.on("log", onEvent);
      clients.add(res);

      // heartbeat every 15s to keep connection alive
      const hb = setInterval(() => {
        if (!res.writableEnded) {
          res.write(": ping\n\n");
        }
      }, 15000);

      req.on("close", () => {
        clearInterval(hb);
        logBus.off("log", onEvent);
        clients.delete(res);
        if (!res.writableEnded) res.end();
      });
      return;
    }

    // REST: list blocked
    if (req.method === "GET" && req.url.startsWith("/api/blocked")) {
      const items = blocked.list();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items }));
      return;
    }

    // REST: approve blocked
    if (req.method === "POST" && req.url.startsWith("/api/approve")) {
      let body = "";
      let bodySize = 0;
      req.on("data", (chunk) => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY_SIZE) {
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on("end", () => {
        try {
          const { id } = JSON.parse(body || "{}");
          const ok = blocked.approve(Number(id));
          res.writeHead(ok ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // REST: reject blocked
    if (req.method === "POST" && req.url.startsWith("/api/reject")) {
      let body = "";
      let bodySize = 0;
      req.on("data", (chunk) => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY_SIZE) {
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on("end", () => {
        try {
          const { id, authority } = JSON.parse(body || "{}");
          const ok = blocked.reject(Number(id), authority);
          res.writeHead(ok ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // Serve static assets
    const filePath = (() => {
      let p = req.url.split("?")[0];
      if (p === "/" || p === "") p = "/index.html";
      return path.join(staticDir, p);
    })();

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      const ext = path.extname(filePath);
      const type = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    });
  });

  server.listen(port, () => {
    console.log(`Admin portal listening on http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = { createAdminServer };
