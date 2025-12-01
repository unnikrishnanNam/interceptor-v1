const net = require("net");
const path = require("path");
const {
  PGStreamParser,
  prettyPrintClientMessage,
  prettyPrintServerMessage,
} = require("./parser");
const { debugLog, emitLogEvent, readCString, readInt16 } = require("./utils");
const { createAdminServer } = require("./adminServer");
const blockedStore = require("./blockedStore");
const { config } = require("./db");
const { setup } = require("./setup");
const { ensurePortsFree } = require("./portCleanup");
const metrics = require("./metrics");

// Check if setup is complete
async function startProxy() {
  if (!config.isConfigured()) {
    console.log("\n⚠️  Interceptor-v1 is not configured yet.\n");
    await setup();
  }

  // Load configuration from database
  const PROXY_PORT = parseInt(
    config.get("proxy_port") || process.env.PROXY_PORT || "5432"
  );
  const PG_HOST =
    config.get("target_host") || process.env.PG_HOST || "localhost";
  const PG_PORT = parseInt(
    config.get("target_port") || process.env.PG_PORT || "5433"
  );
  const ADMIN_PORT = parseInt(
    config.get("admin_port") || process.env.ADMIN_PORT || "3000"
  );
  const BLOCK_BY_DEFAULT = config.get("block_by_default") === "yes";
  // Critical command classification config (comma-separated keywords)
  const DEFAULT_CRITICAL = [
    "DROP",
    "ALTER",
    "TRUNCATE",
    "DELETE",
    "GRANT",
    "REVOKE",
    "CREATE EXTENSION",
  ];
  const DEFAULT_ALLOWED = ["SELECT", "INSERT", "UPDATE", "CREATE TABLE"];

  function getConfigList(key, fallbackArr) {
    const raw = config.get(key);
    if (!raw) return fallbackArr;
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function classifySql(sql) {
    const criticalList = getConfigList("critical_keywords", DEFAULT_CRITICAL);
    const allowedList = getConfigList("allowed_keywords", DEFAULT_ALLOWED);
    const upper = sql.toUpperCase();
    // Priority: explicit critical > explicit allowed > default policy
    if (criticalList.some((kw) => upper.includes(kw))) return "critical";
    if (allowedList.some((kw) => upper.includes(kw))) return "allowed";
    return BLOCK_BY_DEFAULT ? "critical" : "allowed";
  }

  // Ensure required ports are free
  const portCheckResult = await ensurePortsFree([ADMIN_PORT, PROXY_PORT], {
    autoKill: true,
    verbose: true,
  });

  if (!portCheckResult.success) {
    console.error(
      `\n❌ Failed to free required ports: ${portCheckResult.message}`
    );
    console.error(
      `   Please manually free ports ${portCheckResult.failed.join(
        ", "
      )} and try again.\n`
    );
    process.exit(1);
  }

  console.log("\n🚀 Starting Interceptor-v1...");
  console.log(`   Proxy: 0.0.0.0:${PROXY_PORT} → ${PG_HOST}:${PG_PORT}`);
  console.log(`   Admin: http://localhost:${ADMIN_PORT}`);
  console.log(`   Block by default: ${BLOCK_BY_DEFAULT ? "YES" : "NO"}\n`);

  // Start admin UI server
  let adminServer;
  try {
    adminServer = createAdminServer({
      port: ADMIN_PORT,
      staticDir: path.join(__dirname, "../public"),
    });
  } catch (err) {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${ADMIN_PORT} is already in use!`);
      console.error(
        `   Run 'npm run kill' to free the port, or change admin_port in config.\n`
      );
      process.exit(1);
    }
    throw err;
  }

  const server = net.createServer((clientSocket) => {
    const connId = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
    let connectionClosed = false;

    debugLog(
      connId,
      `Client connected. Opening connection to Postgres ${PG_HOST}:${PG_PORT}`
    );
    emitLogEvent({
      level: "conn",
      conn: connId,
      text: `Client connected → ${PG_HOST}:${PG_PORT}`,
    });
    metrics.trackConnection(connId);

    const serverSocket = net.createConnection(
      { host: PG_HOST, port: PG_PORT },
      () => {
        debugLog(connId, `Connected to real Postgres`);
        emitLogEvent({
          level: "conn",
          conn: connId,
          text: "Connected to Postgres",
        });
      }
    );

    const clientParser = new PGStreamParser("C->S", "client");
    const serverParser = new PGStreamParser("S->C", "server");

    // Track an extended-protocol batch to block until Sync
    let batchActive = false;
    let batchBuffers = [];
    let batchPreview = null;
    let passthroughTLS = false; // set to true when server responds 'S' to SSLRequest

    clientSocket.on("data", (chunk) => {
      metrics.trackBytesReceived(chunk.length);
      if (passthroughTLS) {
        // Once TLS is negotiated, we cannot parse; just forward bytes
        serverSocket.write(chunk);
        return;
      }
      try {
        const msgs = clientParser.push(chunk);
        for (const m of msgs) {
          prettyPrintClientMessage(connId, m);

          // Forwarding/blocking logic
          if (m.startup) {
            // Allow startup and negotiation to pass through
            serverSocket.write(m.raw || chunk);
            continue;
          }

          const t = m.type;
          // Identify extended-protocol messages we block as a batch until Sync
          const isExtended =
            t === "P" ||
            t === "B" ||
            t === "D" ||
            t === "E" ||
            t === "C" ||
            t === "S" ||
            t === "H";

          if (t === "Q") {
            // Simple query: check if blocking is enabled
            const sql = m.payload.toString("utf8", 0, m.payload.length - 1);
            metrics.trackQuery("simple");
            const classification = classifySql(sql);
            const shouldBlock = classification === "critical";

            debugLog(
              connId,
              `Query detected. block_by_default=${config.get(
                "block_by_default"
              )}, shouldBlock=${shouldBlock}`
            );

            if (shouldBlock) {
              // Block and store the query
              metrics.trackBlocked();
              blockedStore.add({
                connId,
                type: "simple",
                preview: sql,
                messages: [m.raw],
                forward: (buf) => serverSocket.write(buf),
                sendToClient: (buf) => clientSocket.write(buf),
              });
              emitLogEvent({
                kind: "blocked",
                conn: connId,
                text: `Blocked Q (critical)`,
                data: { sql },
              });
              continue;
            } else {
              // Forward directly
              debugLog(connId, `Forwarding query (blocking disabled)`);
              serverSocket.write(m.raw);
              continue;
            }
          } else if (isExtended) {
            // Accumulate batch
            if (!batchActive) {
              batchActive = true;
              batchBuffers = [];
              batchPreview = null;
            }
            batchBuffers.push(m.raw);
            if (t === "P" && !batchPreview) {
              // extract query preview from Parse
              let off = 0;
              const nameRes = readCString(m.payload, off); // stmt name
              off = nameRes.nextOffset;
              const qRes = readCString(m.payload, off);
              batchPreview = qRes.str;
            }
            if (t === "S") {
              // finalize batch on Sync
              const preview =
                batchPreview || `Extended batch (${batchBuffers.length} msg)`;

              metrics.trackQuery("extended");
              // Classify based on preview
              const classification = classifySql(preview);
              const shouldBlock = classification === "critical";

              debugLog(
                connId,
                `Extended query. block_by_default=${config.get(
                  "block_by_default"
                )}, shouldBlock=${shouldBlock}`
              );

              if (shouldBlock) {
                // Block and store the batch
                metrics.trackBlocked();
                blockedStore.add({
                  connId,
                  type: "extended",
                  preview,
                  messages: batchBuffers.slice(0),
                  forward: (buf) => serverSocket.write(buf),
                  sendToClient: (buf) => clientSocket.write(buf),
                });
                emitLogEvent({
                  kind: "blocked",
                  conn: connId,
                  text: `Blocked Extended (critical)`,
                  data: { preview },
                });
              } else {
                // Forward all accumulated messages
                debugLog(
                  connId,
                  `Forwarding extended batch (blocking disabled)`
                );
                for (const buf of batchBuffers) {
                  serverSocket.write(buf);
                }
              }

              batchActive = false;
              batchBuffers = [];
              batchPreview = null;
            }
            continue;
          } else {
            // Non-query client messages: forward immediately
            serverSocket.write(m.raw);
          }
        }
      } catch (e) {
        debugLog(connId, `Error parsing client chunk: ${e.stack || e}`);
        // If parsing fails (e.g., TLS), pass through bytes
        serverSocket.write(chunk);
      }
    });

    serverSocket.on("data", (chunk) => {
      metrics.trackBytesSent(chunk.length);
      if (passthroughTLS) {
        clientSocket.write(chunk);
        return;
      }
      try {
        const msgs = serverParser.push(chunk);
        for (const m of msgs) {
          // Detect SSL accept to switch to passthrough
          if (m.startup && m.sslResponse === "S") {
            passthroughTLS = true;
          }
          prettyPrintServerMessage(connId, m);
        }
      } catch (e) {
        debugLog(connId, `Error parsing server chunk: ${e.stack || e}`);
      }
      clientSocket.write(chunk);
    });

    const onCloseBoth = (who) => {
      if (connectionClosed) return;
      connectionClosed = true;

      debugLog(connId, `Connection closed (${who}). Destroying both sockets.`);
      emitLogEvent({
        level: "conn",
        conn: connId,
        text: `Connection closed (${who})`,
      });

      metrics.removeConnection(connId);
      // Clean up any blocked queries for this connection
      blockedStore.cleanupConnection(connId);

      if (!clientSocket.destroyed) clientSocket.destroy();
      if (!serverSocket.destroyed) serverSocket.destroy();
    };

    clientSocket.on("end", () => onCloseBoth("client end"));
    clientSocket.on("error", (err) => {
      metrics.trackError();
      debugLog(connId, `clientSocket error: ${err.message}`);
      onCloseBoth("client error");
    });

    serverSocket.on("end", () => onCloseBoth("server end"));
    serverSocket.on("error", (err) => {
      metrics.trackError();
      debugLog(connId, `serverSocket error: ${err.message}`);
      onCloseBoth("server error");
    });
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${PROXY_PORT} is already in use!`);
      console.error(`   Run 'npm run kill' to free the port.\n`);
      process.exit(1);
    }
    console.error("Proxy server error:", err);
    emitLogEvent({
      level: "error",
      text: `Proxy server error: ${err.message}`,
    });
  });

  server.listen(PROXY_PORT, () => {
    console.log(
      `Postgres proxy listening on 0.0.0.0:${PROXY_PORT} -> forwarding to ${PG_HOST}:${PG_PORT}`
    );
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n🛑 Shutting down gracefully...");
    adminServer.close(() => {
      console.log("✅ Admin server closed");
      server.close(() => {
        console.log("✅ Proxy server closed");
        process.exit(0);
      });
    });
  });

  process.on("SIGTERM", () => {
    console.log("\n\n🛑 Shutting down gracefully...");
    adminServer.close(() => {
      console.log("✅ Admin server closed");
      server.close(() => {
        console.log("✅ Proxy server closed");
        process.exit(0);
      });
    });
  });
}

// Start the proxy
if (require.main === module) {
  startProxy().catch((err) => {
    console.error("Failed to start proxy:", err);
    process.exit(1);
  });
}

module.exports = { startProxy };
