const http = require("http");
const fs = require("fs");
const path = require("path");
const logBus = require("./eventBus");
const blocked = require("./blockedStore");
const auth = require("./auth");
const { users, audit, config } = require("./db");

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

  const server = http.createServer(async (req, res) => {
    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    // CORS headers for API endpoints
    if (req.url.startsWith("/api/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }
    }

    // ============ AUTHENTICATION ENDPOINTS ============

    // Login endpoint
    if (req.method === "POST" && req.url === "/api/login") {
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
      req.on("end", async () => {
        try {
          const { username, password } = JSON.parse(body || "{}");
          const result = await auth.login(username, password, clientIp);

          if (result.success) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } else {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.message }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Logout endpoint
    if (req.method === "POST" && req.url === "/api/logout") {
      const token = req.headers.authorization?.substring(7);
      if (token) {
        const decoded = auth.verifyToken(token);
        if (decoded) {
          auth.logout(decoded.username, clientIp);
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Token refresh endpoint
    if (req.method === "POST" && req.url === "/api/refresh") {
      const token = req.headers.authorization?.substring(7);
      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No token provided" }));
        return;
      }

      const newToken = auth.refreshToken(token);
      if (newToken) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token: newToken }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
      }
      return;
    }

    // ============ PROTECTED ENDPOINTS ============

    // Extract and verify token for protected endpoints
    let currentUser = null;
    if (req.url.startsWith("/api/") && req.url !== "/api/login") {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return;
      }

      const token = authHeader.substring(7);
      currentUser = auth.verifyToken(token);

      if (!currentUser) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or expired token" }));
        return;
      }
    }
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

    // REST: get blocked queries list
    if (req.method === "GET" && req.url === "/api/blocked") {
      const items = blocked.list();
      console.log(`[Admin] GET /api/blocked -> ${items.length} items`);
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
          const ok = blocked.approve(Number(id), currentUser.username);

          if (ok) {
            audit.log(
              currentUser.username,
              "query_approved",
              JSON.stringify({ queryId: id }),
              clientIp
            );
          }

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
          const { id } = JSON.parse(body || "{}");
          const ok = blocked.reject(Number(id), currentUser.username);

          if (ok) {
            audit.log(
              currentUser.username,
              "query_rejected",
              JSON.stringify({ queryId: id }),
              clientIp
            );
          }

          res.writeHead(ok ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // REST: vote on blocked query (peer approval system)
    if (req.method === "POST" && req.url.startsWith("/api/vote")) {
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
          const { id, vote } = JSON.parse(body || "{}");

          if (!id || !vote || !["approve", "reject"].includes(vote)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ success: false, error: "Invalid request" })
            );
            return;
          }

          const result = blocked.addVote(
            Number(id),
            currentUser.username,
            vote
          );

          if (result.success) {
            audit.log(
              currentUser.username,
              "peer_vote",
              JSON.stringify({
                queryId: id,
                vote,
                autoResolved: result.autoResolved,
                action: result.action,
              }),
              clientIp
            );
          }

          res.writeHead(result.success ? 200 : 400, {
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }

    // REST: get vote status for a query
    if (req.method === "GET" && req.url.startsWith("/api/vote-status/")) {
      const id = req.url.split("/").pop();
      const status = blocked.getVoteStatus(Number(id));

      if (status) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Query not found" }));
      }
      return;
    }

    // ============ USER MANAGEMENT ENDPOINTS ============

    // Get all users (admin only)
    if (req.method === "GET" && req.url === "/api/users") {
      if (currentUser.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Admin access required" }));
        return;
      }

      const userList = users.list();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ users: userList }));
      return;
    }

    // Add new user (admin only)
    if (req.method === "POST" && req.url === "/api/users") {
      if (currentUser.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Admin access required" }));
        return;
      }

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
      req.on("end", async () => {
        try {
          const { username, password, role } = JSON.parse(body || "{}");

          if (!username || !password) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "Username and password required" })
            );
            return;
          }

          if (users.findByUsername(username)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Username already exists" }));
            return;
          }

          const passwordHash = await auth.hashPassword(password);
          const userId = users.create(username, passwordHash, role || "peer");

          audit.log(
            currentUser.username,
            "user_created",
            JSON.stringify({ userId, newUser: username, role: role || "peer" }),
            clientIp
          );

          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, userId }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Delete user (admin only)
    if (req.method === "DELETE" && req.url.startsWith("/api/users/")) {
      if (currentUser.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Admin access required" }));
        return;
      }

      const userId = parseInt(req.url.split("/")[3]);

      if (userId === currentUser.id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cannot delete yourself" }));
        return;
      }

      users.delete(userId);

      audit.log(
        currentUser.username,
        "user_deleted",
        JSON.stringify({ userId }),
        clientIp
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Change password
    if (req.method === "POST" && req.url === "/api/change-password") {
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
      req.on("end", async () => {
        try {
          const { oldPassword, newPassword } = JSON.parse(body || "{}");

          const user = users.findById(currentUser.id);
          const isValid = await auth.verifyPassword(
            oldPassword,
            user.password_hash
          );

          if (!isValid) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid current password" }));
            return;
          }

          const newHash = await auth.hashPassword(newPassword);
          users.updatePassword(currentUser.id, newHash);

          audit.log(currentUser.username, "password_changed", null, clientIp);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Get configuration
    if (req.method === "GET" && req.url === "/api/config") {
      const cfg = config.getAll();
      // Don't expose sensitive data
      delete cfg.jwt_secret;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(cfg));
      return;
    }

    // Update configuration (admin only)
    if (req.method === "PUT" && req.url === "/api/config") {
      if (currentUser.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Admin access required" }));
        return;
      }

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
          const updates = JSON.parse(body || "{}");

          // Prevent updating sensitive keys
          delete updates.jwt_secret;
          delete updates.setup_complete;

          for (const [key, value] of Object.entries(updates)) {
            config.set(key, value);
          }

          audit.log(
            currentUser.username,
            "config_updated",
            JSON.stringify(updates),
            clientIp
          );

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Get audit logs (admin only)
    if (req.method === "GET" && req.url.startsWith("/api/audit")) {
      if (currentUser.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Admin access required" }));
        return;
      }

      const logs = audit.getLogs(100);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ logs }));
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
