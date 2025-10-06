const http = require("http");
const fs = require("fs");
const path = require("path");
const logBus = require("./eventBus");
const blocked = require("./blockedStore");

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
        try {
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        } catch (_) {
          // ignore
        }
      };
      logBus.on("log", onEvent);
      clients.add(res);

      // heartbeat every 15s to keep connection alive
      const hb = setInterval(() => {
        res.write(": ping\n\n");
      }, 15000);

      req.on("close", () => {
        clearInterval(hb);
        logBus.off("log", onEvent);
        clients.delete(res);
        res.end();
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
      req.on("data", (chunk) => (body += chunk));
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
      const type =
        ext === ".html"
          ? "text/html"
          : ext === ".css"
          ? "text/css"
          : ext === ".js"
          ? "text/javascript"
          : "application/octet-stream";
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
