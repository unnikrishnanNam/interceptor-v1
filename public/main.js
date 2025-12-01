(function () {
  // ============ AUTHENTICATION ============
  const TOKEN_KEY = "interceptor_token";
  const USER_KEY = "interceptor_user";

  let currentUser = null;
  let authToken = null;

  function isAuthenticated() {
    authToken = localStorage.getItem(TOKEN_KEY);
    const userStr = localStorage.getItem(USER_KEY);
    if (authToken && userStr) {
      try {
        currentUser = JSON.parse(userStr);
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  async function login(username, password) {
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        const data = await res.json();
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem(TOKEN_KEY, authToken);
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
        return { success: true };
      } else {
        const error = await res.json();
        return { success: false, message: error.error || "Login failed" };
      }
    } catch (e) {
      return { success: false, message: "Network error" };
    }
  }

  async function logout() {
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch (e) {
      console.error("Logout error:", e);
    }

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    authToken = null;
    currentUser = null;
    // Clear any user-specific UI state
    const blockedRoot = document.getElementById("blocked");
    if (blockedRoot) blockedRoot.innerHTML = "";
    showLoginScreen();
  }

  function showLoginScreen() {
    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("dashboard").style.display = "none";
  }

  function showDashboard() {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("dashboard").style.display = "flex";

    if (currentUser) {
      document.getElementById("userName").textContent = currentUser.username;
      const roleEl = document.querySelector(".user-role");
      if (roleEl) {
        roleEl.textContent =
          currentUser.role === "admin" ? "Administrator" : "Peer";
      }

      // Show/hide admin-only features
      const usersNavItem = document.getElementById("usersNavItem");
      if (usersNavItem) {
        usersNavItem.style.display =
          currentUser.role === "admin" ? "flex" : "none";
      }
    }

    // Initialize app when showing dashboard (fixes reload issue)
    if (!window.appInitialized) {
      initializeApp();
      window.appInitialized = true;
    }
  }

  // Helper for authenticated API calls
  async function fetchAPI(url, options = {}) {
    options.headers = options.headers || {};
    options.headers["Authorization"] = `Bearer ${authToken}`;

    const res = await fetch(url, options);

    if (res.status === 401) {
      logout();
      throw new Error("Authentication expired");
    }

    return res;
  }

  // Login form handling
  document.getElementById("loginBtn").addEventListener("click", async () => {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const errorEl = document.getElementById("loginError");

    errorEl.textContent = "";

    const result = await login(username, password);

    if (result.success) {
      showDashboard();
    } else {
      errorEl.textContent = result.message || "Login failed";
    }
  });

  // Allow Enter key to submit login
  ["username", "password"].forEach((id) => {
    document.getElementById(id).addEventListener("keypress", (e) => {
      if (e.key === "Enter") document.getElementById("loginBtn").click();
    });
  });

  // Logout handling
  document.getElementById("logoutBtn").addEventListener("click", logout);

  // ============ NAVIGATION ============
  const navItems = document.querySelectorAll(".nav-item");
  const pages = document.querySelectorAll(".page");

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const pageId = item.dataset.page;

      // Update nav active state
      navItems.forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");

      // Update page visibility
      pages.forEach((page) => page.classList.remove("active"));
      document.getElementById(pageId + "Page").classList.add("active");

      // Load data for specific pages
      if (pageId === "users") {
        // Block users page for peers
        if (currentUser && currentUser.role !== "admin") {
          alert(
            "Access Denied: Only administrators can access user management."
          );
          // Switch back to home page
          navItems.forEach((nav) => nav.classList.remove("active"));
          navItems[0].classList.add("active");
          pages.forEach((page) => page.classList.remove("active"));
          document.getElementById("homePage").classList.add("active");
          return;
        }
        loadUsers();
      } else if (pageId === "config") {
        loadConfig();
      } else if (pageId === "blocked") {
        // Ensure fresh render with current user context
        refreshBlocked();
      }
    });
  });

  // ============ DEBOUNCE UTILITY ============
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // ============ STATISTICS ============
  const stats = {
    connections: new Set(),
    totalQueries: 0,
    blockedQueries: 0,
    errors: 0,
  };

  // Guard against concurrent blocked list renders
  let blockedRenderSeq = 0;

  function updateStats() {
    document.getElementById("activeConnections").textContent =
      stats.connections.size;
    document.getElementById("totalQueries").textContent = stats.totalQueries;
    document.getElementById("statBlockedQueries").textContent =
      stats.blockedQueries;
    document.getElementById("errorCount").textContent = stats.errors;
  }

  function updateRecentActivity(evt) {
    const activityEl = document.getElementById("recentActivity");
    const item = document.createElement("div");
    item.className = "activity-item";

    const time = new Date(evt.ts || Date.now()).toLocaleTimeString();
    const text = evt.text || JSON.stringify(evt.data || evt);

    item.innerHTML = `
      <div class="time">${time}</div>
      <div>${escapeHtml(text)}</div>
    `;

    activityEl.insertBefore(item, activityEl.firstChild);

    // Keep only last 10 items
    while (activityEl.children.length > 10) {
      activityEl.removeChild(activityEl.lastChild);
    }
  }

  // ============ METRICS ============
  async function refreshMetrics() {
    try {
      const res = await fetchAPI("/api/metrics");
      const metrics = await res.json();

      // Update uptime (both Dashboard and Config pages may have an element)
      document.querySelectorAll("#uptime").forEach((el) => {
        el.textContent = metrics.uptime.formatted;
      });

      // Update memory
      const memUsedMB = (metrics.memory.process.heapUsed / 1024 / 1024).toFixed(
        1
      );
      document.getElementById("memoryUsed").textContent = `${memUsedMB} MB`;

      // Update blocked queries memory
      const blockedKB = (metrics.memory.blockedQueries.total / 1024).toFixed(1);
      document.getElementById("blockedMemory").textContent = `${blockedKB} KB`;

      // Update throughput
      document.getElementById(
        "throughput"
      ).textContent = `${metrics.queries.throughput.queriesPerSecond}/s`;

      // Update top stat cards from server metrics (persistence across reload)
      const active = metrics.connections.active;
      const totalQ = metrics.queries.total;
      const pendingBlocked = metrics.queries.pending;
      const errors = metrics.errors;
      const activeEl = document.getElementById("activeConnections");
      const totalEl = document.getElementById("totalQueries");
      const blockedElStat = document.getElementById("statBlockedQueries");
      const errorEl = document.getElementById("errorCount");
      if (activeEl) activeEl.textContent = active;
      if (totalEl) totalEl.textContent = totalQ;
      if (blockedElStat) blockedElStat.textContent = pendingBlocked;
      if (errorEl) errorEl.textContent = errors;
      const badge = document.getElementById("blockedCount");
      if (badge) {
        badge.textContent = pendingBlocked;
        badge.style.display = pendingBlocked > 0 ? "block" : "none";
      }

      // Update memory details
      const memDetails = document.getElementById("memoryDetails");
      memDetails.innerHTML = `
        <div class="metrics-row">
          <span class="metrics-label">Heap Used</span>
          <span class="metrics-value">${(
            metrics.memory.process.heapUsed /
            1024 /
            1024
          ).toFixed(2)} MB</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">Heap Total</span>
          <span class="metrics-value">${(
            metrics.memory.process.heapTotal /
            1024 /
            1024
          ).toFixed(2)} MB</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">RSS</span>
          <span class="metrics-value">${(
            metrics.memory.process.rss /
            1024 /
            1024
          ).toFixed(2)} MB</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">External</span>
          <span class="metrics-value">${(
            metrics.memory.process.external /
            1024 /
            1024
          ).toFixed(2)} MB</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">Blocked Queries</span>
          <span class="metrics-value highlight">${
            metrics.memory.blockedQueries.count
          } items (${(metrics.memory.blockedQueries.total / 1024).toFixed(
        1
      )} KB)</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">Avg per Query</span>
          <span class="metrics-value">${(
            metrics.memory.blockedQueries.average / 1024
          ).toFixed(2)} KB</span>
        </div>
      `;

      // Update network details
      const netDetails = document.getElementById("networkDetails");
      netDetails.innerHTML = `
        <div class="metrics-row">
          <span class="metrics-label">Bytes Received</span>
          <span class="metrics-value">${
            metrics.throughput.formatted.bytesReceived
          }</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">Bytes Sent</span>
          <span class="metrics-value">${
            metrics.throughput.formatted.bytesSent
          }</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">Messages Received</span>
          <span class="metrics-value">${metrics.throughput.messagesReceived.toLocaleString()}</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">Messages Sent</span>
          <span class="metrics-value">${metrics.throughput.messagesSent.toLocaleString()}</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">Queries per Second</span>
          <span class="metrics-value highlight">${
            metrics.queries.throughput.queriesPerSecond
          }</span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">Peak Connections</span>
          <span class="metrics-value">${metrics.connections.peak}</span>
        </div>
      `;
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    }
  }

  // ============ LOG TABLE ============
  const table = document.getElementById("logTable");
  const autoScroll = document.getElementById("autoScroll");
  const levelFilter = document.getElementById("levelFilter");
  const search = document.getElementById("search");
  const clearBtn = document.getElementById("clearBtn");
  const blockedEl = document.getElementById("blocked");

  const rows = [];

  function rowMatchesFilters(evt) {
    const f = levelFilter.value;
    const q = search.value.trim().toLowerCase();
    const dir = evt.level || evt.direction;
    if (f !== "all") {
      if (f === "conn" && dir !== "conn") return false;
      if (f === "client" && dir !== "client") return false;
      if (f === "server" && dir !== "server") return false;
      if (f === "error" && dir !== "error") return false;
    }
    if (!q) return true;
    const text = JSON.stringify(evt).toLowerCase();
    return text.includes(q);
  }

  function renderRow(evt) {
    if (!rowMatchesFilters(evt)) return;
    const div = document.createElement("div");
    div.className = "row";

    let dirClass = evt.level || evt.direction || "conn";
    if (evt.kind === "rejected") dirClass = "error";
    if (evt.kind === "approved") dirClass = "server";

    const ts = new Date(evt.ts || Date.now()).toISOString();
    const conn = evt.conn || "";
    const msg = evt.text || evt.message || JSON.stringify(evt.data || evt);
    div.innerHTML = `
      <div class="ts">${ts}</div>
      <div class="dir ${dirClass}">${dirClass}</div>
      <div>${conn}</div>
      <div class="msg">${escapeHtml(msg)}</div>
    `;
    table.appendChild(div);
    if (autoScroll && autoScroll.checked) {
      setTimeout(() => {
        table.scrollTop = table.scrollHeight;
      }, 0);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/\n/g, "<br/>");
  }

  function rerenderAll() {
    table.innerHTML = "";
    const fragment = document.createDocumentFragment();

    // Add header
    const head = document.createElement("div");
    head.className = "row head";
    head.innerHTML = `
      <div class="ts">Timestamp</div>
      <div>Direction</div>
      <div>Connection</div>
      <div>Message</div>
    `;
    fragment.appendChild(head);

    // Add filtered rows
    for (const evt of rows) {
      if (!rowMatchesFilters(evt)) continue;
      const div = document.createElement("div");
      div.className = "row";

      let dirClass = evt.level || evt.direction || "conn";
      if (evt.kind === "rejected") dirClass = "error";
      if (evt.kind === "approved") dirClass = "server";

      const ts = new Date(evt.ts || Date.now()).toISOString();
      const conn = evt.conn || "";
      const msg = evt.text || evt.message || JSON.stringify(evt.data || evt);
      div.innerHTML = `
        <div class="ts">${ts}</div>
        <div class="dir ${dirClass}">${dirClass}</div>
        <div>${conn}</div>
        <div class="msg">${escapeHtml(msg)}</div>
      `;
      fragment.appendChild(div);
    }

    table.appendChild(fragment);
  }

  // ============ BLOCKED QUERIES ============
  async function refreshBlocked() {
    try {
      const res = await fetchAPI("/api/blocked");
      const { items } = await res.json();
      // Dedupe by id for safety
      const seen = new Set();
      const uniqueItems = [];
      for (const it of items || []) {
        if (it && !seen.has(it.id)) {
          seen.add(it.id);
          uniqueItems.push(it);
        }
      }

      stats.blockedQueries = uniqueItems.length;
      updateStats();

      // Update badge
      const badge = document.getElementById("blockedCount");
      if (badge) {
        badge.textContent = uniqueItems.length;
        badge.style.display = uniqueItems.length > 0 ? "block" : "none";
      }

      const root = blockedEl;
      const seq = ++blockedRenderSeq;
      const fragment = document.createDocumentFragment();

      if (uniqueItems.length === 0) {
        if (seq !== blockedRenderSeq) return;
        root.innerHTML =
          '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">No blocked queries</div>';
        return;
      }

      for (const it of uniqueItems) {
        const div = document.createElement("div");
        div.className = "blocked-item";
        const ts = new Date(it.ts).toLocaleTimeString();

        // Get vote status for this query
        let voteStatusHtml = "";
        let actionsHtml = "";

        if (it.requiresPeerApproval) {
          // Fetch vote status from backend
          try {
            const voteRes = await fetchAPI(`/api/vote-status/${it.id}`);
            const voteStatus = await voteRes.json();

            const approvalCount = voteStatus.approvalCount || 0;
            const rejectionCount = voteStatus.rejectionCount || 0;
            const approvers = voteStatus.approvals || [];
            const rejectors = voteStatus.rejections || [];

            // Show voting progress
            voteStatusHtml = `
              <div class="vote-status" style="margin: 0.5rem 0; padding: 0.5rem; background: var(--bg-secondary); border-radius: 4px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--success);">✓ Approvals: ${approvalCount}</span>
                  <span style="color: var(--danger);">✗ Rejections: ${rejectionCount}</span>
                </div>
                ${
                  approvers.length > 0
                    ? `<div style="font-size: 0.75rem; color: var(--text-muted);">Approved by: ${approvers.join(
                        ", "
                      )}</div>`
                    : ""
                }
                ${
                  rejectors.length > 0
                    ? `<div style="font-size: 0.75rem; color: var(--text-muted);">Rejected by: ${rejectors.join(
                        ", "
                      )}</div>`
                    : ""
                }
              </div>
            `;

            // For peers, show vote buttons
            if (currentUser.role === "peer") {
              const userVote = approvers.includes(currentUser.username)
                ? "approve"
                : rejectors.includes(currentUser.username)
                ? "reject"
                : null;

              actionsHtml = `
                <div class="blocked-actions">
                  <button class="btn-vote-approve ${
                    userVote === "approve" ? "voted" : ""
                  }" data-id="${it.id}" ${userVote ? "disabled" : ""}>
                    <svg style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    ${userVote === "approve" ? "Voted Approve" : "Vote Approve"}
                  </button>
                  <button class="btn-vote-reject ${
                    userVote === "reject" ? "voted" : ""
                  }" data-id="${it.id}" ${userVote ? "disabled" : ""}>
                    <svg style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    ${userVote === "reject" ? "Voted Reject" : "Vote Reject"}
                  </button>
                </div>
              `;
            } else {
              // Admin can still directly approve/reject
              actionsHtml = `
                <div class="blocked-actions">
                  <button class="btn-approve" data-id="${it.id}">
                    <svg style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    Approve (Override)
                  </button>
                  <button class="btn-deny" data-id="${it.id}">
                    <svg style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Deny (Override)
                  </button>
                </div>
              `;
            }
          } catch (voteErr) {
            console.error("Failed to fetch vote status:", voteErr);
          }
        } else {
          // Standard approve/reject buttons for non-peer approval queries
          actionsHtml = `
            <div class="blocked-actions">
              <button class="btn-approve" data-id="${it.id}">
                <svg style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                Approve
              </button>
              <button class="btn-deny" data-id="${it.id}">
                <svg style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Deny
              </button>
            </div>
          `;
        }

        div.innerHTML = `
          <div class="blocked-header">
            <div class="blocked-meta">
              <span class="id">#${it.id}</span>
              <span class="dot"></span>
              <span>${ts}</span>
              <span class="dot"></span>
              <span>${it.connId}</span>
              <span class="dot"></span>
              <span>${it.type}</span>
              ${
                it.requiresPeerApproval
                  ? '<span class="dot"></span><span style="color: var(--info);">🤝 Peer Approval</span>'
                  : ""
              }
            </div>
          </div>
          <div class="blocked-sql">${escapeHtml(it.preview)}</div>
          ${voteStatusHtml}
          ${actionsHtml}
        `;

        // Attach event listeners
        const approveBtn = div.querySelector(".btn-approve");
        const denyBtn = div.querySelector(".btn-deny");
        const voteApproveBtn = div.querySelector(".btn-vote-approve");
        const voteRejectBtn = div.querySelector(".btn-vote-reject");

        if (approveBtn) {
          approveBtn.addEventListener("click", () =>
            handleDecision(it.id, "approve")
          );
        }
        if (denyBtn) {
          denyBtn.addEventListener("click", () =>
            handleDecision(it.id, "reject")
          );
        }
        if (voteApproveBtn) {
          voteApproveBtn.addEventListener("click", () =>
            handleVote(it.id, "approve")
          );
        }
        if (voteRejectBtn) {
          voteRejectBtn.addEventListener("click", () =>
            handleVote(it.id, "reject")
          );
        }

        fragment.appendChild(div);
      }
      if (seq !== blockedRenderSeq) return;
      root.innerHTML = "";
      root.appendChild(fragment);
    } catch (e) {
      console.error("Failed to refresh blocked queries:", e);
    }
  }

  async function handleDecision(id, action) {
    try {
      const res = await fetchAPI(`/api/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        // Optimistically refresh list to reflect change immediately
        await refreshBlocked();
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Action failed", err);
        alert(err.error || `Failed to ${action} query`);
      }
    } catch (e) {
      console.error("Action failed", e);
    }
  }

  async function handleVote(id, vote) {
    try {
      const res = await fetchAPI("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, vote }),
      });

      const result = await res.json();

      if (result.success) {
        if (result.autoResolved) {
          // Query was automatically approved or rejected
          console.log(`Query #${id} was automatically ${result.action}`);
        } else {
          // Just update the UI to show the vote
          console.log(`Vote recorded: ${vote} for query #${id}`);
          // Refresh to show updated counts
          await refreshBlocked();
        }
      } else {
        console.error("Vote failed:", result.error);
        alert(result.error || "Failed to record vote");
      }
    } catch (e) {
      console.error("Vote failed", e);
      alert("Failed to record vote");
    }
  }

  // ============ CONFIGURATION ============

  async function loadConfig() {
    const saveBtn = document.getElementById("saveConfigBtn");
    if (saveBtn && (!currentUser || currentUser.role !== "admin")) {
      saveBtn.disabled = true;
    }

    try {
      const res = await fetchAPI("/api/config");
      const config = await res.json();

      document.getElementById("configProxyPort").value =
        config.proxy_port || "5432";
      document.getElementById("configTargetHost").value =
        config.target_host || "localhost";
      document.getElementById("configTargetPort").value =
        config.target_port || "5433";
      document.getElementById("configAdminPort").value =
        config.admin_port || "3000";
      document.getElementById("configBlockByDefault").value =
        config.block_by_default === "true" ? "yes" : "no";
      document.getElementById("configPeerApprovalEnabled").value =
        config.peer_approval_enabled || "false";
      document.getElementById("configMinVotes").value =
        config.peer_approval_min_votes || "1";
      document.getElementById("configCriticalKeywords").value =
        config.critical_keywords ||
        "DROP, ALTER, TRUNCATE, DELETE, GRANT, REVOKE, CREATE EXTENSION";
      document.getElementById("configAllowedKeywords").value =
        config.allowed_keywords || "SELECT, INSERT, UPDATE, CREATE TABLE";
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  }

  async function saveConfig() {
    const proxyPort = document.getElementById("configProxyPort").value;
    const targetHost = document.getElementById("configTargetHost").value;
    const targetPort = document.getElementById("configTargetPort").value;
    const adminPort = document.getElementById("configAdminPort").value;
    const blockByDefault = document.getElementById(
      "configBlockByDefault"
    ).value;
    const peerApprovalEnabled = document.getElementById(
      "configPeerApprovalEnabled"
    ).value;
    const minVotes = document.getElementById("configMinVotes").value;
    const errorEl = document.getElementById("configFormError");

    errorEl.textContent = "";

    if (!proxyPort || !targetHost || !targetPort || !adminPort) {
      errorEl.textContent = "All fields are required";
      return;
    }

    try {
      const res = await fetchAPI("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxy_port: proxyPort,
          target_host: targetHost,
          target_port: targetPort,
          admin_port: adminPort,
          block_by_default: blockByDefault === "yes" ? "true" : "false",
          peer_approval_enabled: peerApprovalEnabled,
          peer_approval_min_votes: minVotes,
          critical_keywords: document.getElementById("configCriticalKeywords")
            .value,
          allowed_keywords: document.getElementById("configAllowedKeywords")
            .value,
        }),
      });

      if (res.ok) {
        errorEl.style.color = "var(--success)";
        errorEl.textContent =
          "✅ Configuration saved! Restart the proxy for changes to take effect.";
        setTimeout(() => {
          errorEl.textContent = "";
          errorEl.style.color = "";
        }, 5000);
      } else {
        const error = await res.json();
        errorEl.textContent = error.error || "Failed to save configuration";
      }
    } catch (e) {
      errorEl.textContent = e.message;
    }
  }

  // Config form handlers
  document
    .getElementById("saveConfigBtn")
    ?.addEventListener("click", saveConfig);

  // ============ USER MANAGEMENT ============
  async function loadUsers() {
    if (!currentUser || currentUser.role !== "admin") return;

    try {
      const res = await fetchAPI("/api/users");
      const { users } = await res.json();

      const tbody = document.getElementById("usersTableBody");
      tbody.innerHTML = "";

      if (users.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
              No users found
            </td>
          </tr>
        `;
        return;
      }

      for (const user of users) {
        const tr = document.createElement("tr");
        const createdDate = new Date(user.created_at).toLocaleDateString();
        const lastLogin = user.last_login
          ? new Date(user.last_login).toLocaleString()
          : "Never";

        const roleClass = user.role === "admin" ? "role-admin" : "role-peer";
        const canDelete = user.id !== currentUser.id;

        tr.innerHTML = `
          <td>${escapeHtml(user.username)}</td>
          <td><span class="role-badge ${roleClass}">${user.role}</span></td>
          <td>${createdDate}</td>
          <td>${lastLogin}</td>
          <td>
            ${
              canDelete
                ? `<button class="btn-delete" data-id="${user.id}">Delete</button>`
                : '<span style="color: var(--text-muted);">Current User</span>'
            }
          </td>
        `;

        if (canDelete) {
          tr.querySelector(".btn-delete").addEventListener("click", () =>
            deleteUser(user.id)
          );
        }

        tbody.appendChild(tr);
      }
    } catch (e) {
      console.error("Failed to load users:", e);
    }
  }

  async function createUser(username, password, role) {
    try {
      const res = await fetchAPI("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });

      if (res.ok) {
        return { success: true };
      } else {
        const error = await res.json();
        return {
          success: false,
          message: error.error || "Failed to create user",
        };
      }
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async function deleteUser(userId) {
    if (!confirm("Are you sure you want to delete this user?")) return;

    try {
      await fetchAPI(`/api/users/${userId}`, { method: "DELETE" });
      loadUsers();
    } catch (e) {
      console.error("Failed to delete user:", e);
      alert("Failed to delete user");
    }
  }

  // User form handlers
  document.getElementById("addUserBtn")?.addEventListener("click", () => {
    document.getElementById("addUserForm").style.display = "block";
    document.getElementById("newUsername").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("newRole").value = "peer";
    document.getElementById("userFormError").textContent = "";
  });

  document.getElementById("cancelUserBtn")?.addEventListener("click", () => {
    document.getElementById("addUserForm").style.display = "none";
  });

  document
    .getElementById("saveUserBtn")
    ?.addEventListener("click", async () => {
      const username = document.getElementById("newUsername").value.trim();
      const password = document.getElementById("newPassword").value;
      const role = document.getElementById("newRole").value;
      const errorEl = document.getElementById("userFormError");

      errorEl.textContent = "";

      if (!username || !password) {
        errorEl.textContent = "Username and password are required";
        return;
      }

      if (password.length < 6) {
        errorEl.textContent = "Password must be at least 6 characters";
        return;
      }

      const result = await createUser(username, password, role);

      if (result.success) {
        document.getElementById("addUserForm").style.display = "none";
        loadUsers();
      } else {
        errorEl.textContent = result.message;
      }
    });

  // ============ EXPORT LOGS ============
  function exportLogs() {
    const filteredRows = rows.filter(rowMatchesFilters);

    if (filteredRows.length === 0) {
      alert("No logs to export");
      return;
    }

    let csv = "Timestamp,Direction,Connection,Message\n";

    filteredRows.forEach((evt) => {
      const ts = new Date(evt.ts || Date.now()).toISOString();
      const dir = evt.level || evt.direction || "conn";
      const conn = evt.conn || "";
      const msg = (
        evt.text ||
        evt.message ||
        JSON.stringify(evt.data || evt)
      ).replace(/"/g, '""');
      csv += `"${ts}","${dir}","${conn}","${msg}"\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interceptor-logs-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============ EVENT SOURCE ============
  function initializeApp() {
    if (window.__interceptor_es_initialized) return; // guard against double init
    levelFilter.addEventListener("change", rerenderAll);
    search.addEventListener("input", debounce(rerenderAll, 300));
    clearBtn.addEventListener("click", () => {
      rows.length = 0;
      rerenderAll();
    });

    // Add export button listener
    const exportBtn = document.getElementById("exportBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", exportLogs);
    }

    const es = new EventSource("/events");
    window.__interceptor_es_initialized = true;

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        rows.push(evt);

        // Update statistics
        if (evt.level === "conn" && evt.text.includes("connected")) {
          if (evt.conn) stats.connections.add(evt.conn);
        }
        if (evt.level === "conn" && evt.text.includes("closed")) {
          if (evt.conn) stats.connections.delete(evt.conn);
        }
        if (
          evt.level === "client" &&
          (evt.text.startsWith("Q:") || evt.text.startsWith("P:"))
        ) {
          stats.totalQueries++;
        }
        if (evt.level === "error") {
          stats.errors++;
        }

        updateStats();
        updateRecentActivity(evt);
        renderRow(evt);

        if (
          evt.kind === "blocked" ||
          evt.kind === "approved" ||
          evt.kind === "rejected"
        ) {
          refreshBlockedDebounced();
        }
      } catch (err) {
        console.error("Failed to parse event:", err);
      }
    };

    es.onerror = () => {
      console.error("EventSource error, will retry...");
    };

    // Initial render
    rerenderAll();
    refreshBlocked();
    updateStats();
    refreshMetrics(); // Initial metrics fetch

    // Refresh metrics every 5 seconds
    setInterval(() => {
      refreshMetrics();
    }, 5000);

    // Update uptime (removed as metrics now handles it)
  }

  // Debounced wrapper to prevent overlapping refreshes on rapid events
  const refreshBlockedDebounced = debounce(refreshBlocked, 150);

  // Initialize if already authenticated
  if (isAuthenticated()) {
    showDashboard();
  }
})();
