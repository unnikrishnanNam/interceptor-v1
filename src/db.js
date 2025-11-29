const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Database file location
const DB_DIR = path.join(__dirname, "../data");
const DB_PATH = path.join(DB_DIR, "interceptor.db");

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'peer',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_login INTEGER
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS blocked_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conn_id TEXT NOT NULL,
    query_type TEXT NOT NULL,
    query_preview TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    resolved_at INTEGER,
    resolved_by TEXT,
    approval_count INTEGER NOT NULL DEFAULT 0,
    rejection_count INTEGER NOT NULL DEFAULT 0,
    requires_peer_approval INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS query_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    vote TEXT NOT NULL CHECK(vote IN ('approve', 'reject')),
    voted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (query_id) REFERENCES blocked_queries(id),
    UNIQUE(query_id, username)
  );

  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_blocked_status ON blocked_queries(status);
  CREATE INDEX IF NOT EXISTS idx_config_key ON config(key);
  CREATE INDEX IF NOT EXISTS idx_query_approvals_query ON query_approvals(query_id);
`);

// ============ CONFIG METHODS ============

const config = {
  get: (key) => {
    const stmt = db.prepare("SELECT value FROM config WHERE key = ?");
    const row = stmt.get(key);
    return row ? row.value : null;
  },

  set: (key, value) => {
    const stmt = db.prepare(`
      INSERT INTO config (key, value, updated_at) 
      VALUES (?, ?, strftime('%s', 'now'))
      ON CONFLICT(key) DO UPDATE SET 
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.run(key, String(value));
  },

  getAll: () => {
    const stmt = db.prepare("SELECT key, value FROM config");
    const rows = stmt.all();
    const result = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  },

  isConfigured: () => {
    const setupComplete = config.get("setup_complete");
    return setupComplete === "true";
  },

  delete: (key) => {
    const stmt = db.prepare("DELETE FROM config WHERE key = ?");
    stmt.run(key);
  },
};

// ============ USER METHODS ============

const users = {
  create: (username, passwordHash, role = "peer") => {
    const stmt = db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)"
    );
    const result = stmt.run(username, passwordHash, role);
    return result.lastInsertRowid;
  },

  findByUsername: (username) => {
    const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
    return stmt.get(username);
  },

  findById: (id) => {
    const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
    return stmt.get(id);
  },

  list: () => {
    const stmt = db.prepare(
      "SELECT id, username, role, created_at, last_login FROM users ORDER BY created_at DESC"
    );
    return stmt.all();
  },

  updatePassword: (id, passwordHash) => {
    const stmt = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
    stmt.run(passwordHash, id);
  },

  updateLastLogin: (id) => {
    const stmt = db.prepare(
      "UPDATE users SET last_login = strftime('%s', 'now') WHERE id = ?"
    );
    stmt.run(id);
  },

  delete: (id) => {
    const stmt = db.prepare("DELETE FROM users WHERE id = ?");
    stmt.run(id);
  },

  count: () => {
    const stmt = db.prepare("SELECT COUNT(*) as count FROM users");
    const row = stmt.get();
    return row.count;
  },
};

// ============ AUDIT LOG METHODS ============

const audit = {
  log: (username, action, details = null, ipAddress = null) => {
    const stmt = db.prepare(
      "INSERT INTO audit_log (username, action, details, ip_address) VALUES (?, ?, ?, ?)"
    );
    stmt.run(username, action, details, ipAddress);
  },

  getLogs: (limit = 100) => {
    const stmt = db.prepare(
      "SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?"
    );
    return stmt.all(limit);
  },

  getLogsByUser: (username, limit = 50) => {
    const stmt = db.prepare(
      "SELECT * FROM audit_log WHERE username = ? ORDER BY timestamp DESC LIMIT ?"
    );
    return stmt.all(username, limit);
  },
};

// ============ BLOCKED QUERIES METHODS ============

const blockedQueries = {
  add: (connId, queryType, queryPreview, requiresPeerApproval = false) => {
    const stmt = db.prepare(
      "INSERT INTO blocked_queries (conn_id, query_type, query_preview, status, requires_peer_approval) VALUES (?, ?, ?, 'pending', ?)"
    );
    const result = stmt.run(
      connId,
      queryType,
      queryPreview,
      requiresPeerApproval ? 1 : 0
    );
    return result.lastInsertRowid;
  },

  approve: (id, resolvedBy) => {
    const stmt = db.prepare(`
      UPDATE blocked_queries 
      SET status = 'approved', 
          resolved_at = strftime('%s', 'now'),
          resolved_by = ?
      WHERE id = ?
    `);
    stmt.run(resolvedBy, id);
  },

  reject: (id, resolvedBy) => {
    const stmt = db.prepare(`
      UPDATE blocked_queries 
      SET status = 'rejected', 
          resolved_at = strftime('%s', 'now'),
          resolved_by = ?
      WHERE id = ?
    `);
    stmt.run(resolvedBy, id);
  },

  updateVoteCounts: (id, approvalCount, rejectionCount) => {
    const stmt = db.prepare(`
      UPDATE blocked_queries 
      SET approval_count = ?,
          rejection_count = ?
      WHERE id = ?
    `);
    stmt.run(approvalCount, rejectionCount, id);
  },

  getPending: () => {
    const stmt = db.prepare(
      "SELECT * FROM blocked_queries WHERE status = 'pending' ORDER BY created_at ASC"
    );
    return stmt.all();
  },

  getAll: (limit = 100) => {
    const stmt = db.prepare(
      "SELECT * FROM blocked_queries ORDER BY created_at DESC LIMIT ?"
    );
    return stmt.all(limit);
  },

  getById: (id) => {
    const stmt = db.prepare("SELECT * FROM blocked_queries WHERE id = ?");
    return stmt.get(id);
  },
};

// ============ QUERY APPROVALS METHODS ============

const queryApprovals = {
  addVote: (queryId, username, vote) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO query_approvals (query_id, username, vote) 
      VALUES (?, ?, ?)
    `);
    stmt.run(queryId, username, vote);
  },

  getVotes: (queryId) => {
    const stmt = db.prepare(`
      SELECT * FROM query_approvals WHERE query_id = ? ORDER BY voted_at ASC
    `);
    return stmt.all(queryId);
  },

  getVoteCounts: (queryId) => {
    const stmt = db.prepare(`
      SELECT 
        COUNT(CASE WHEN vote = 'approve' THEN 1 END) as approve_count,
        COUNT(CASE WHEN vote = 'reject' THEN 1 END) as reject_count,
        COUNT(*) as total_votes
      FROM query_approvals 
      WHERE query_id = ?
    `);
    return stmt.get(queryId);
  },

  hasUserVoted: (queryId, username) => {
    const stmt = db.prepare(`
      SELECT vote FROM query_approvals WHERE query_id = ? AND username = ?
    `);
    const result = stmt.get(queryId, username);
    return result ? result.vote : null;
  },

  deleteVotesForQuery: (queryId) => {
    const stmt = db.prepare("DELETE FROM query_approvals WHERE query_id = ?");
    stmt.run(queryId);
  },
};

// Graceful shutdown
process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  db.close();
  process.exit(0);
});

module.exports = {
  db,
  config,
  users,
  audit,
  blockedQueries,
  queryApprovals,
};
