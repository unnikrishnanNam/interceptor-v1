const logBus = require("./eventBus");

let nextId = 1;
const blocked = new Map(); // id -> { id, connId, ts, preview, messages, type, forward }

function list() {
  return Array.from(blocked.values()).map(({ forward, ...rest }) => rest);
}

function add({ connId, preview, messages, type, forward }) {
  const id = nextId++;
  const item = { id, connId, ts: Date.now(), preview, messages, type, forward };
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
    // Forward messages to the server socket in original order
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

module.exports = { list, add, approve };
