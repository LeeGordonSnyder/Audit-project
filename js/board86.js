"use strict";

function initBoard86() {
  renderBoard86List();
}

// FloorRestock's own 86/RESTOCKED columns are the primary source — that
// sheet is staff-visible and fully re-synced on every boot/refresh, on
// every device. FloorReplen only fills in for a "Needed" size that was
// never actually sold, so has no FloorRestock row of its own to flag.
function board86Entries() {
  const restock = loadJSON(STORAGE.floorRestock, []);
  const replen = loadJSON(STORAGE.floorReplen, []);

  const fromRestock = restock.filter(isFloorRestockOnBoard86).map((item) => ({
    id: "",
    sku: item.sku,
    size: item.size,
    description: item.description,
    color: item.color,
    date: item.outOfStock,
  }));

  const onBoardKeys = new Set(fromRestock.map((e) => `${e.sku}:${e.size}`));
  const fromReplen = replen
    .filter((item) => item.status === "outOfStock" && !onBoardKeys.has(`${item.sku}:${item.size}`))
    .map((item) => ({
      id: item.id,
      sku: item.sku,
      size: item.size,
      description: item.description,
      color: item.color,
      date: item.pickedDate,
    }));

  return [...fromRestock, ...fromReplen];
}

function renderBoard86List() {
  const tbody = document.getElementById("board86-table-body");
  const entries = board86Entries();

  document.getElementById("board86-count").textContent =
    `${entries.length} item${entries.length === 1 ? "" : "s"} out of stock`;

  tbody.innerHTML = "";
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="no-results">Nothing on the 86 board.</td></tr>`;
    return;
  }

  const sorted = entries.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  sorted.forEach((item, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.description)} — ${escapeHtml(item.color)}</td>
      <td>${escapeHtml(item.size)}</td>
      <td>${item.date ? new Date(item.date).toLocaleString() : "—"}</td>
      <td><button class="btn secondary small board86-restock-btn" data-index="${i}">Restocked</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".board86-restock-btn").forEach((btn) => {
    btn.addEventListener("click", () => markBoard86Restocked(sorted[Number(btn.dataset.index)]));
  });
}

async function markBoard86Restocked(entry) {
  if (!navigator.onLine) {
    setStatus("board86-status-msg", "Offline — nothing was updated. Try again once you have a connection.", true);
    return;
  }

  const session = loadJSON(STORAGE.session, {});
  const initials = (session.initials || "").trim();
  const nowIso = new Date().toISOString();

  try {
    await postFloor86Restock(getWebhookUrl(), {
      initials,
      date: todayISO(),
      items: [{ id: entry.id, sku: entry.sku, size: entry.size }],
    });

    const restock = loadJSON(STORAGE.floorRestock, []);
    const rIdx = restock.findIndex((p) => p.sku === entry.sku && p.size === entry.size);
    if (rIdx !== -1) restock[rIdx].restocked = nowIso;
    saveJSON(STORAGE.floorRestock, restock);

    if (entry.id) {
      const replen = loadJSON(STORAGE.floorReplen, []);
      const idx = replen.findIndex((p) => p.id === entry.id);
      if (idx !== -1) {
        replen[idx].status = "restocked";
        replen[idx].restockedBy = initials;
        replen[idx].restockedDate = nowIso;
      }
      saveJSON(STORAGE.floorReplen, replen);
    }

    renderBoard86List();
    setStatus("board86-status-msg", "Marked restocked.", false);
  } catch (e) {
    setStatus("board86-status-msg", "Couldn't reach the sheet — check your connection and try again.", true);
  }
}
