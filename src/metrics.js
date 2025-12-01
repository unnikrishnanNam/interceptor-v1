const v8 = require("v8");
const blockedStore = require("./blockedStore");

// Metrics tracking
const metrics = {
  startTime: Date.now(),
  connections: {
    active: new Set(),
    total: 0,
    peak: 0,
  },
  queries: {
    total: 0,
    blocked: 0,
    approved: 0,
    rejected: 0,
    simple: 0,
    extended: 0,
  },
  throughput: {
    bytesReceived: 0,
    bytesSent: 0,
    messagesReceived: 0,
    messagesSent: 0,
  },
  errors: 0,
  lastReset: Date.now(),
};

// Track connection
function trackConnection(connId) {
  metrics.connections.active.add(connId);
  metrics.connections.total++;
  if (metrics.connections.active.size > metrics.connections.peak) {
    metrics.connections.peak = metrics.connections.active.size;
  }
}

// Remove connection
function removeConnection(connId) {
  metrics.connections.active.delete(connId);
}

// Track query
function trackQuery(type) {
  metrics.queries.total++;
  if (type === "simple") {
    metrics.queries.simple++;
  } else if (type === "extended") {
    metrics.queries.extended++;
  }
}

// Track blocked query
function trackBlocked() {
  metrics.queries.blocked++;
}

// Track approved/rejected
function trackApproved() {
  metrics.queries.approved++;
}

function trackRejected() {
  metrics.queries.rejected++;
}

// Track throughput
function trackBytesReceived(bytes) {
  metrics.throughput.bytesReceived += bytes;
  metrics.throughput.messagesReceived++;
}

function trackBytesSent(bytes) {
  metrics.throughput.bytesSent += bytes;
  metrics.throughput.messagesSent++;
}

// Track error
function trackError() {
  metrics.errors++;
}

// Get memory statistics
function getMemoryStats() {
  const heapStats = v8.getHeapStatistics();
  const memUsage = process.memoryUsage();

  return {
    // Process memory
    process: {
      rss: memUsage.rss, // Resident Set Size - total memory
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
    },
    // V8 heap details
    heap: {
      totalHeapSize: heapStats.total_heap_size,
      usedHeapSize: heapStats.used_heap_size,
      heapSizeLimit: heapStats.heap_size_limit,
      totalPhysicalSize: heapStats.total_physical_size,
      mallocedMemory: heapStats.malloced_memory,
      peakMallocedMemory: heapStats.peak_malloced_memory,
    },
    // Blocked queries memory estimate
    blockedQueries: estimateBlockedQueriesMemory(),
  };
}

// Estimate memory used by blocked queries
function estimateBlockedQueriesMemory() {
  const items = blockedStore.list();
  let totalBytes = 0;
  const perQuery = [];

  for (const item of items) {
    let itemBytes = 0;

    // Estimate string sizes (JS uses UTF-16, so 2 bytes per char)
    if (item.preview) {
      itemBytes += item.preview.length * 2;
    }

    // Estimate message buffers
    if (item.messages && Array.isArray(item.messages)) {
      for (const msg of item.messages) {
        itemBytes += msg.length || 0;
      }
    }

    // Add object overhead (approximate)
    itemBytes += 200; // Base object overhead

    totalBytes += itemBytes;
    perQuery.push({
      id: item.id,
      bytes: itemBytes,
      preview: item.preview ? item.preview.slice(0, 50) : "",
    });
  }

  return {
    total: totalBytes,
    count: items.length,
    average: items.length > 0 ? Math.round(totalBytes / items.length) : 0,
    items: perQuery,
  };
}

// Get comprehensive metrics snapshot
function getMetrics() {
  const uptime = Date.now() - metrics.startTime;
  const memory = getMemoryStats();
  const blockedItems = blockedStore.list();

  return {
    uptime: {
      ms: uptime,
      seconds: Math.floor(uptime / 1000),
      formatted: formatUptime(uptime),
    },
    connections: {
      active: metrics.connections.active.size,
      total: metrics.connections.total,
      peak: metrics.connections.peak,
    },
    queries: {
      total: metrics.queries.total,
      blocked: metrics.queries.blocked,
      approved: metrics.queries.approved,
      rejected: metrics.queries.rejected,
      pending: blockedItems.length,
      simple: metrics.queries.simple,
      extended: metrics.queries.extended,
      throughput: calculateThroughput(uptime),
    },
    throughput: {
      bytesReceived: metrics.throughput.bytesReceived,
      bytesSent: metrics.throughput.bytesSent,
      messagesReceived: metrics.throughput.messagesReceived,
      messagesSent: metrics.throughput.messagesSent,
      formatted: {
        bytesReceived: formatBytes(metrics.throughput.bytesReceived),
        bytesSent: formatBytes(metrics.throughput.bytesSent),
      },
    },
    memory,
    errors: metrics.errors,
    timestamp: Date.now(),
  };
}

// Calculate queries per second
function calculateThroughput(uptime) {
  const seconds = uptime / 1000;
  return {
    queriesPerSecond:
      seconds > 0 ? (metrics.queries.total / seconds).toFixed(2) : 0,
    blockedPerSecond:
      seconds > 0 ? (metrics.queries.blocked / seconds).toFixed(2) : 0,
  };
}

// Format uptime
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Format bytes
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

// Reset metrics (optional)
function resetMetrics() {
  metrics.queries.total = 0;
  metrics.queries.blocked = 0;
  metrics.queries.approved = 0;
  metrics.queries.rejected = 0;
  metrics.queries.simple = 0;
  metrics.queries.extended = 0;
  metrics.throughput.bytesReceived = 0;
  metrics.throughput.bytesSent = 0;
  metrics.throughput.messagesReceived = 0;
  metrics.throughput.messagesSent = 0;
  metrics.errors = 0;
  metrics.lastReset = Date.now();
}

module.exports = {
  trackConnection,
  removeConnection,
  trackQuery,
  trackBlocked,
  trackApproved,
  trackRejected,
  trackBytesReceived,
  trackBytesSent,
  trackError,
  getMetrics,
  getMemoryStats,
  resetMetrics,
};
