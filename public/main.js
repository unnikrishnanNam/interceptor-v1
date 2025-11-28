(function () {
  // ============ AUTHENTICATION ============
  const AUTH_KEY = "interceptor_auth";
  const AUTHORITY_KEY = "interceptor_authority_name";

  // Simple auth check (in production, use proper JWT/session management)
  function isAuthenticated() {
    return localStorage.getItem(AUTH_KEY) === "true";
  }

  function login(username, password) {
    // Simple demo auth - in production, validate against backend
    if (username && password) {
      localStorage.setItem(AUTH_KEY, "true");
      localStorage.setItem(AUTHORITY_KEY, username);
      return true;
    }
    return false;
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    showLoginScreen();
  }

  function showLoginScreen() {
    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("dashboard").style.display = "none";
  }

  function showDashboard() {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("dashboard").style.display = "flex";
    const username = localStorage.getItem(AUTHORITY_KEY) || "Admin";
    document.getElementById("userName").textContent = username;
  }

  // ============ INITIALIZATION ============
  if (isAuthenticated()) {
    showDashboard();
  } else {
    showLoginScreen();
  }

  // Login form handling
  document.getElementById("loginBtn").addEventListener("click", () => {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const errorEl = document.getElementById("loginError");

    if (login(username, password)) {
      showDashboard();
      initializeApp();
    } else {
      errorEl.textContent = "Please enter both username and password";
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
    if (autoScroll.checked) {
      div.scrollIntoView({ behavior: "smooth", block: "end" });
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
      const res = await fetch("/api/blocked");
      const { items } = await res.json();

      stats.blockedQueries = items.length;
      updateStats();

      // Update badge
      const badge = document.getElementById("blockedCount");
      if (badge) {
        badge.textContent = items.length;
        badge.style.display = items.length > 0 ? "block" : "none";
      }

      const root = blockedEl;
      root.innerHTML = "";

      if (items.length === 0) {
        root.innerHTML =
          '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">No blocked queries</div>';
        return;
      }

      for (const it of items) {
        const div = document.createElement("div");
        div.className = "blocked-item";
        const ts = new Date(it.ts).toLocaleTimeString();

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
            </div>
          </div>
          <div class="blocked-sql">${escapeHtml(it.preview)}</div>
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

        div
          .querySelector(".btn-approve")
          .addEventListener("click", () => handleDecision(it.id, "approve"));
        div
          .querySelector(".btn-deny")
          .addEventListener("click", () => handleDecision(it.id, "reject"));

        root.appendChild(div);
      }
    } catch (e) {
      console.error("Failed to refresh blocked queries:", e);
    }
  }

  async function handleDecision(id, action) {
    try {
      const authorityName = localStorage.getItem(AUTHORITY_KEY) || "Admin";
      await fetch(`/api/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, authority: authorityName }),
      });
    } catch (e) {
      console.error("Action failed", e);
    }
  }

  // ============ EVENT SOURCE ============
  function initializeApp() {
    levelFilter.addEventListener("change", rerenderAll);
    search.addEventListener("input", debounce(rerenderAll, 300));
    clearBtn.addEventListener("click", () => {
      rows.length = 0;
      rerenderAll();
    });

    const es = new EventSource("/events");

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
          refreshBlocked();
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

    // Update uptime
    const startTime = Date.now();
    setInterval(() => {
      const uptime = Date.now() - startTime;
      const hours = Math.floor(uptime / 3600000);
      const minutes = Math.floor((uptime % 3600000) / 60000);
      document.getElementById("uptime").textContent = `${hours}h ${minutes}m`;
    }, 60000);
  }

  // Initialize if already authenticated
  if (isAuthenticated()) {
    initializeApp();
  }
})();
