const logBus = require("./eventBus");
const { blockedQueries, queryApprovals, users, config } = require("./db");

let nextId = 1;
const blocked = new Map();
// id -> { id, connId, ts, preview, messages, type, forward, sendToClient, requiresPeerApproval, approvals, rejections }

function list() {
  // Return everything except the function callbacks
  return Array.from(blocked.values()).map(
    ({ forward, sendToClient, ...rest }) => rest
  );
}

// Check if a similar query already exists (to prevent duplicates)
function findExisting(connId, preview) {
  for (const [id, item] of blocked.entries()) {
    if (item.connId === connId && item.preview === preview) {
      return id;
    }
  }
  return null;
}

function add({ connId, preview, messages, type, forward, sendToClient }) {
  // Check for duplicate query
  const existingId = findExisting(connId, preview);
  if (existingId !== null) {
    console.log(
      `[BlockedStore] Query already blocked as #${existingId}, skipping duplicate`
    );
    return existingId;
  }

  const id = nextId++;

  // Check if peer approval is enabled
  const peerApprovalEnabled = config.get("peer_approval_enabled") === "true";

  const item = {
    id,
    connId,
    ts: Date.now(),
    preview,
    messages,
    type,
    forward,
    sendToClient,
    requiresPeerApproval: peerApprovalEnabled,
    approvals: new Set(),
    rejections: new Set(),
  };
  blocked.set(id, item);
  console.log(
    `[BlockedStore] Added query #${id}, total=${
      blocked.size
    }, preview=${preview.slice(0, 50)}`
  );

  // Persist to database
  try {
    blockedQueries.add(connId, type, preview, peerApprovalEnabled);
  } catch (e) {
    console.error("Failed to persist blocked query:", e);
  }

  logBus.emit("log", {
    kind: "blocked",
    id,
    conn: connId,
    text: preview,
    data: { type, requiresPeerApproval: peerApprovalEnabled },
  });
  return id;
}

function approve(id, approvedBy = "Unknown") {
  const item = blocked.get(id);
  if (!item) return false;

  // Remove from in-memory store
  blocked.delete(id);

  // Also remove any other blocked queries from the same connection with same preview
  // (in case there were any timing issues)
  for (const [otherId, otherItem] of blocked.entries()) {
    if (
      otherItem.connId === item.connId &&
      otherItem.preview === item.preview
    ) {
      blocked.delete(otherId);
      console.log(`[BlockedStore] Removed duplicate #${otherId}`);
    }
  }

  // Update database
  try {
    blockedQueries.approve(id, approvedBy);
  } catch (e) {
    console.error("Failed to persist approval:", e);
  }

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

  // Remove from in-memory store
  blocked.delete(id);

  // Also remove any other blocked queries from the same connection with same preview
  for (const [otherId, otherItem] of blocked.entries()) {
    if (
      otherItem.connId === item.connId &&
      otherItem.preview === item.preview
    ) {
      blocked.delete(otherId);
      console.log(`[BlockedStore] Removed duplicate #${otherId}`);
    }
  }

  // Update database
  try {
    blockedQueries.reject(id, authorityName);
  } catch (e) {
    console.error("Failed to persist rejection:", e);
  }

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

/**
 * Add a peer vote (approve/reject) to a query
 * Returns: { success, autoResolved, action } where action is 'approved' or 'rejected' if autoResolved
 */
function addVote(id, username, vote) {
  const item = blocked.get(id);
  if (!item) {
    return { success: false, error: "Query not found" };
  }

  if (!item.requiresPeerApproval) {
    return {
      success: false,
      error: "This query does not require peer approval",
    };
  }

  // Record the vote
  if (vote === "approve") {
    item.approvals.add(username);
    item.rejections.delete(username);
  } else if (vote === "reject") {
    item.rejections.add(username);
    item.approvals.delete(username);
  } else {
    return { success: false, error: "Invalid vote type" };
  }

  // Persist to database
  try {
    queryApprovals.addVote(id, username, vote);
    blockedQueries.updateVoteCounts(
      id,
      item.approvals.size,
      item.rejections.size
    );
  } catch (e) {
    console.error("Failed to persist vote:", e);
    return { success: false, error: "Database error" };
  }

  logBus.emit("log", {
    kind: "vote",
    id,
    conn: item.connId,
    text: `${username} voted to ${vote} query`,
  });

  // Check if threshold is met
  const thresholdResult = checkThreshold(item);

  if (thresholdResult.met) {
    if (thresholdResult.action === "approve") {
      approve(id, "Peer Approval System");
      return { success: true, autoResolved: true, action: "approved" };
    } else if (thresholdResult.action === "reject") {
      reject(id, "Peer Approval System");
      return { success: true, autoResolved: true, action: "rejected" };
    }
  }

  return {
    success: true,
    autoResolved: false,
    approvalCount: item.approvals.size,
    rejectionCount: item.rejections.size,
  };
}

/**
 * Check if a query has met the approval/rejection threshold
 * Returns: { met: boolean, action: 'approve'|'reject'|null }
 */
function checkThreshold(item) {
  // Get threshold configuration (minimum votes required)
  const minVotesStr = config.get("peer_approval_min_votes") || "1";
  const minVotes = parseInt(minVotesStr, 10);

  const approvalCount = item.approvals.size;
  const rejectionCount = item.rejections.size;

  // Check if approval threshold is met
  if (approvalCount >= minVotes) {
    return { met: true, action: "approve" };
  }

  // Check if rejection threshold is met
  if (rejectionCount >= minVotes) {
    return { met: true, action: "reject" };
  }

  return { met: false, action: null };
}

/**
 * Get voting status for a query
 */
function getVoteStatus(id) {
  const item = blocked.get(id);
  if (!item) return null;

  return {
    id: item.id,
    requiresPeerApproval: item.requiresPeerApproval,
    approvals: Array.from(item.approvals),
    rejections: Array.from(item.rejections),
    approvalCount: item.approvals.size,
    rejectionCount: item.rejections.size,
  };
}

/**
 * Clean up blocked queries for a specific connection
 * (called when connection closes)
 */
function cleanupConnection(connId) {
  let removed = 0;
  for (const [id, item] of blocked.entries()) {
    if (item.connId === connId) {
      blocked.delete(id);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(
      `[BlockedStore] Cleaned up ${removed} queries for connection ${connId}`
    );
  }
  return removed;
}

module.exports = {
  list,
  add,
  approve,
  reject,
  addVote,
  getVoteStatus,
  cleanupConnection,
};
