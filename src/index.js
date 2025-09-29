const net = require("net");
const {
  PGStreamParser,
  prettyPrintClientMessage,
  prettyPrintServerMessage,
} = require("./parser");
const { debugLog } = require("./utils");

const PROXY_PORT = process.env.PROXY_PORT
  ? Number(process.env.PROXY_PORT)
  : 5432;
const PG_HOST = process.env.PG_HOST || "127.0.0.1";
const PG_PORT = process.env.PG_PORT ? Number(process.env.PG_PORT) : 5433;

const server = net.createServer((clientSocket) => {
  const connId = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
  debugLog(
    connId,
    `Client connected. Opening connection to Postgres ${PG_HOST}:${PG_PORT}`
  );

  const serverSocket = net.createConnection(
    { host: PG_HOST, port: PG_PORT },
    () => {
      debugLog(connId, `Connected to real Postgres`);
    }
  );

  const clientParser = new PGStreamParser("C->S", "client");
  const serverParser = new PGStreamParser("S->C", "server");

  clientSocket.on("data", (chunk) => {
    try {
      const msgs = clientParser.push(chunk);
      for (const m of msgs) prettyPrintClientMessage(connId, m);
    } catch (e) {
      debugLog(connId, `Error parsing client chunk: ${e.stack || e}`);
    }
    const ok = serverSocket.write(chunk);
    if (!ok) debugLog(connId, `backpressure on serverSocket`);
  });

  serverSocket.on("data", (chunk) => {
    try {
      const msgs = serverParser.push(chunk);
      for (const m of msgs) prettyPrintServerMessage(connId, m);
    } catch (e) {
      debugLog(connId, `Error parsing server chunk: ${e.stack || e}`);
    }
    const ok = clientSocket.write(chunk);
    if (!ok) debugLog(connId, `backpressure on clientSocket`);
  });

  const onCloseBoth = (who) => {
    debugLog(connId, `Connection closed (${who}). Destroying both sockets.`);
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
});

server.listen(PROXY_PORT, () => {
  console.log(
    `Postgres proxy listening on 0.0.0.0:${PROXY_PORT} -> forwarding to ${PG_HOST}:${PG_PORT}`
  );
});
