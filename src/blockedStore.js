const logBus = require("./eventBus");

let nextId = 1;
const blocked = new Map(); 
// id -> { id, connId, ts, preview, messages, type, forward, sendToClient }

function list() {
  // Return everything except the function callbacks
  return Array.from(blocked.values()).map(({ forward, sendToClient, ...rest }) => rest);
}

function add({ connId, preview, messages, type, forward, sendToClient }) {
  const id = nextId++;
  const item = { id, connId, ts: Date.now(), preview, messages, type, forward, sendToClient };
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

function approve(id, authorityName = "Unknown") {
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
      text: `Approved by ${authorityName}: ${item.preview}`,
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
        item.sendToClient(createErrorPacket("Query rejected by Authority (" + authorityName + ")"));
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
    // 1. ErrorResponse (E)
    // Fields: S(Severity)=ERROR, C(Code)=P0001, M(Message)=msg
    const severity = "ERROR";
    const code = "P0001"; // Raise Exception code
    const message = msg;
    
    // Calculate length of payload: 
    // 1(Type) + string + 0 + 1(Type) + string + 0 + 1(Type) + string + 0 + 1(null terminator)
    const payloadLen = 
        1 + severity.length + 1 +
        1 + code.length + 1 + 
        1 + message.length + 1 + 
        1; 

    const errorBuf = Buffer.alloc(1 + 4 + payloadLen);
    let offset = 0;
    
    errorBuf.write("E", offset); offset++;
    errorBuf.writeInt32BE(4 + payloadLen, offset); offset += 4;
    
    errorBuf.write("S", offset); offset++;
    errorBuf.write(severity, offset); offset += severity.length;
    errorBuf.writeUInt8(0, offset); offset++; // null

    errorBuf.write("C", offset); offset++;
    errorBuf.write(code, offset); offset += code.length;
    errorBuf.writeUInt8(0, offset); offset++;

    errorBuf.write("M", offset); offset++;
    errorBuf.write(message, offset); offset += message.length;
    errorBuf.writeUInt8(0, offset); offset++;
    
    errorBuf.writeUInt8(0, offset); offset++; // final null

    // 2. ReadyForQuery (Z) -> Transaction status 'I' (Idle)
    const readyBuf = Buffer.alloc(1 + 4 + 1);
    readyBuf.write("Z", 0);
    readyBuf.writeInt32BE(5, 1);
    readyBuf.write("I", 5);

    return Buffer.concat([errorBuf, readyBuf]);
}

module.exports = { list, add, approve, reject };