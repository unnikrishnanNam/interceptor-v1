const logBus = require("./eventBus");

let nextId = 1;
const blocked = new Map();
// id -> { id, connId, ts, preview, messages, type, forward, sendToClient }

function list() {
  // Return everything except the function callbacks
  return Array.from(blocked.values()).map(
    ({ forward, sendToClient, ...rest }) => rest
  );
}

function add({ connId, preview, messages, type, forward, sendToClient }) {
  const id = nextId++;
  const item = {
    id,
    connId,
    ts: Date.now(),
    preview,
    messages,
    type,
    forward,
    sendToClient,
  };
  blocked.set(id, item);
  logBus.emit("log", {
    kind: "blocked",
    id,
    conn: connId,
    text: preview,
    data: { type },
  });
  return id;
}

function approve(id) {
  const item = blocked.get(id);
  if (!item) return false;
  blocked.delete(id);
  try {
    // Forward messages to the real Postgres server
    for (const buf of item.messages) {
      item.forward(buf);
    }
    logBus.emit("log", {
      kind: "approved",
      id,
      conn: item.connId,
      text: `Approved: ${item.preview}`,
    });
    return true;
  } catch (e) {
    logBus.emit("log", {
      level: "error",
      conn: item.connId,
      text: `Approve failed: ${e.message}`,
    });
    return false;
  }
}

function reject(id, authorityName = "Unknown") {
  const item = blocked.get(id);
  if (!item) return false;
  blocked.delete(id);
  try {
    // Do NOT forward to server.
    // Instead, send a Postgres ErrorResponse back to the client.
    if (item.sendToClient) {
      item.sendToClient(
        createErrorPacket("Query rejected by Authority (" + authorityName + ")")
      );
    }

    logBus.emit("log", {
      kind: "rejected",
      id,
      conn: item.connId,
      text: `Rejected by ${authorityName}: ${item.preview}`,
    });
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/**
 * Helper to construct a Postgres ErrorResponse (Type 'E')
 * followed by ReadyForQuery (Type 'Z') so the client doesn't hang.
 */
function createErrorPacket(msg) {
  // ErrorResponse fields
  const severity = "ERROR";
  const code = "P0001";
  const message = msg;

  // Calculate payload length
  const payloadLen =
    1 + severity.length + 1 + 1 + code.length + 1 + 1 + message.length + 1 + 1;
  const errorLen = 1 + 4 + payloadLen;
  const readyLen = 6; // 'Z' + length(4) + status(1)

  const buf = Buffer.allocUnsafe(errorLen + readyLen);
  let offset = 0;

  // ErrorResponse
  buf.write("E", offset);
  offset++;
  buf.writeInt32BE(4 + payloadLen, offset);
  offset += 4;
  buf.write("S", offset);
  offset++;
  buf.write(severity, offset);
  offset += severity.length;
  buf.writeUInt8(0, offset);
  offset++;
  buf.write("C", offset);
  offset++;
  buf.write(code, offset);
  offset += code.length;
  buf.writeUInt8(0, offset);
  offset++;
  buf.write("M", offset);
  offset++;
  buf.write(message, offset);
  offset += message.length;
  buf.writeUInt8(0, offset);
  offset++;
  buf.writeUInt8(0, offset);
  offset++;

  // ReadyForQuery
  buf.write("Z", offset);
  offset++;
  buf.writeInt32BE(5, offset);
  offset += 4;
  buf.write("I", offset);

  return buf;
}

module.exports = { list, add, approve, reject };
