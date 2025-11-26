(function () {
  const table = document.getElementById("logTable");
  const autoScroll = document.getElementById("autoScroll");
  const levelFilter = document.getElementById("levelFilter");
  const search = document.getElementById("search");
  const clearBtn = document.getElementById("clearBtn");
  const blockedEl = document.getElementById("blocked");

  // BASIC ROLE SYSTEM: Identify the Authority
  let authorityName = localStorage.getItem("interceptor_authority_name");
  if (!authorityName) {
    authorityName = prompt("Enter your Authority Name (e.g., Admin Alice):") || "Anonymous Admin";
    localStorage.setItem("interceptor_authority_name", authorityName);
  }
  document.querySelector(".brand").textContent = `Interceptor Admin: ${authorityName}`;

  const rows = [];

  function renderHeader() {
    const head = document.createElement("div");
    head.className = "row head";
    head.innerHTML = `
      <div class="ts">Timestamp</div>
      <div>Direction</div>
      <div>Connection</div>
      <div>Message</div>
    `;
    table.appendChild(head);
  }

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
    if (!rowMatchesFilters(evt)) return; // filtered out
    const div = document.createElement("div");
    div.className = "row";
    
    // Map 'rejected' kind to a specific CSS class for visual feedback
    let dirClass = evt.level || evt.direction || "conn";
    if (evt.kind === "rejected") dirClass = "error"; // Reuse 'error' red color for rejections
    if (evt.kind === "approved") dirClass = "server"; // Reuse 'server' blue/green for approvals
    
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
    renderHeader();
    for (const evt of rows) renderRow(evt);
  }

  async function refreshBlocked() {
    try {
      const res = await fetch("/api/blocked");
      const { items } = await res.json();
      const root = blockedEl;
      root.innerHTML = "";
      if (items.length === 0) {
        root.innerHTML = '<div style="padding:10px; color:#666;">No pending requests.</div>';
        return;
      }
      for (const it of items) {
        const div = document.createElement("div");
        div.className = "item";
        const ts = new Date(it.ts).toLocaleTimeString();
        div.innerHTML = `
          <div>
            <div class="meta">#${it.id} • ${ts} • ${it.connId} • ${it.type}</div>
            <div class="sql">${escapeHtml(it.preview)}</div>
          </div>
          <div class="actions">
            <button class="btn-approve" data-id="${it.id}">Approve</button>
            <button class="btn-deny" data-id="${it.id}">Deny</button>
          </div>
        `;
        
        // Attach event listeners
        div.querySelector(".btn-approve").addEventListener("click", () => handleDecision(it.id, "approve"));
        div.querySelector(".btn-deny").addEventListener("click", () => handleDecision(it.id, "reject"));
        
        root.appendChild(div);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDecision(id, action) {
    try {
      await fetch(`/api/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, authority: authorityName }),
      });
      // Note: We don't strictly need to call refreshBlocked() here because 
      // the server will emit an event (approved/rejected) which the EventSource below picks up.
    } catch (e) {
      console.error("Action failed", e);
    }
  }

  async function approveBlocked(id) {
    try {
      await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      refreshBlocked();
    } catch (e) {}
  }

  levelFilter.addEventListener("change", rerenderAll);
  search.addEventListener("input", () => {
    // debounce could be added; okay for now
    rerenderAll();
  });
  clearBtn.addEventListener("click", () => {
    rows.length = 0;
    rerenderAll();
  });

  const es = new EventSource("/events");
  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data);
      rows.push(evt);
      renderRow(evt); // Update Log Table
      
      // Update Blocked List on any status change
      if (evt.kind === "blocked" || evt.kind === "approved" || evt.kind === "rejected") {
        refreshBlocked();
      }
    } catch (_) {}
  };

  renderHeader();
  refreshBlocked();

  es.onerror = () => {
    // let browser auto-retry
  };
})();
