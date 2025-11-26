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

const PROXY_PORT = process.env.PROXY_PORT
  ? Number(process.env.PROXY_PORT)
  : 5432;
const PG_HOST = process.env.PG_HOST || "127.0.0.1";
const PG_PORT = process.env.PG_PORT ? Number(process.env.PG_PORT) : 5433;
const ADMIN_PORT = process.env.ADMIN_PORT
  ? Number(process.env.ADMIN_PORT)
  : 8080;

// Start admin UI server
createAdminServer({
  port: ADMIN_PORT,
  staticDir: path.join(__dirname, "../public"),
});

const server = net.createServer((clientSocket) => {
  const connId = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
  debugLog(
    connId,
    `Client connected. Opening connection to Postgres ${PG_HOST}:${PG_PORT}`
  );
  emitLogEvent({
    level: "conn",
    conn: connId,
    text: `Client connected → ${PG_HOST}:${PG_PORT}`,
  });

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
    if (passthroughTLS) {
      // Once TLS is negotiated, we cannot parse; just forward bytes
      const ok = serverSocket.write(chunk);
      if (!ok) debugLog(connId, `backpressure on serverSocket`);
      return;
    }
    try {
      const msgs = clientParser.push(chunk);
      for (const m of msgs) {
        // Log as before
        prettyPrintClientMessage(connId, m);

        // Forwarding/blocking logic
        if (m.startup) {
          // Allow startup and negotiation to pass through
          if (m.raw) serverSocket.write(m.raw);
          else serverSocket.write(chunk); // fallback
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
          // Simple query: block as single item
          const sql = m.payload.toString("utf8", 0, m.payload.length - 1);
          blockedStore.add({
            connId,
            type: "simple",
            preview: sql,
            messages: [m.raw],
            forward: (buf) => serverSocket.write(buf),
            sendToClient: (buf) => clientSocket.write(buf)
          });
          emitLogEvent({
            kind: "blocked",
            conn: connId,
            text: `Blocked Q`,
            data: { sql },
          });
          continue;
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
            blockedStore.add({
              connId,
              type: "extended",
              preview,
              messages: batchBuffers.slice(0),
              forward: (buf) => serverSocket.write(buf),
              sendToClient: (buf) => clientSocket.write(buf)
            });
            emitLogEvent({
              kind: "blocked",
              conn: connId,
              text: `Blocked Extended`,
              data: { preview },
            });
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
      const ok = serverSocket.write(chunk);
      if (!ok) debugLog(connId, `backpressure on serverSocket`);
    }
  });

  serverSocket.on("data", (chunk) => {
    if (passthroughTLS) {
      const ok = clientSocket.write(chunk);
      if (!ok) debugLog(connId, `backpressure on clientSocket`);
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
    const ok = clientSocket.write(chunk);
    if (!ok) debugLog(connId, `backpressure on clientSocket`);
  });

  const onCloseBoth = (who) => {
    debugLog(connId, `Connection closed (${who}). Destroying both sockets.`);
    emitLogEvent({
      level: "conn",
      conn: connId,
      text: `Connection closed (${who})`,
    });
    clientSocket.destroy();
    serverSocket.destroy();
  };

  clientSocket.on("end", () => onCloseBoth("client end"));
  clientSocket.on("close", () => onCloseBoth("client close"));
  clientSocket.on("error", (err) => {
    debugLog(connId, `clientSocket error: ${err.message}`);
    onCloseBoth("client error");
  });

  serverSocket.on("end", () => onCloseBoth("server end"));
  serverSocket.on("close", () => onCloseBoth("server close"));
  serverSocket.on("error", (err) => {
    debugLog(connId, `serverSocket error: ${err.message}`);
    onCloseBoth("server error");
  });
});

server.on("error", (err) => {
  console.error("Proxy server error:", err);
  emitLogEvent({ level: "error", text: `Proxy server error: ${err.message}` });
});

server.listen(PROXY_PORT, () => {
  console.log(
    `Postgres proxy listening on 0.0.0.0:${PROXY_PORT} -> forwarding to ${PG_HOST}:${PG_PORT}`
  );
});
