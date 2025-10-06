(function () {
  const table = document.getElementById("logTable");
  const autoScroll = document.getElementById("autoScroll");
  const levelFilter = document.getElementById("levelFilter");
  const search = document.getElementById("search");
  const clearBtn = document.getElementById("clearBtn");
  const blockedEl = document.getElementById("blocked");

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
    const dirClass = evt.level || evt.direction || "conn";
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
      for (const it of items) {
        const div = document.createElement("div");
        div.className = "item";
        const ts = new Date(it.ts).toLocaleTimeString();
        div.innerHTML = `
          <div>
            <div class="meta">#${it.id} • ${ts} • ${it.connId} • ${
          it.type
        }</div>
            <div class="sql">${escapeHtml(it.preview)}</div>
          </div>
          <div>
            <button data-id="${it.id}">Approve</button>
          </div>
        `;
        div
          .querySelector("button")
          .addEventListener("click", () => approveBlocked(it.id));
        root.appendChild(div);
      }
    } catch (e) {
      // ignore
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

  renderHeader();
  refreshBlocked();

  const es = new EventSource("/events");
  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data);
      rows.push(evt);
      renderRow(evt);
      if (evt.kind === "blocked" || evt.kind === "approved") {
        refreshBlocked();
      }
    } catch (_) {}
  };
  es.onerror = () => {
    // let browser auto-retry
  };
})();
