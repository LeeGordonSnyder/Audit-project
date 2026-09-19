"use strict";

function initBoard86() {
  renderBoard86List();
}

function renderBoard86List() {
  const tbody = document.getElementById("board86-table-body");
  const restock = loadJSON(STORAGE.floorRestock, []);
  const outOfStock = restock.filter(isFloorRestockOnBoard86);

  document.getElementById("board86-count").textContent =
    `${outOfStock.length} item${outOfStock.length === 1 ? "" : "s"} out of stock`;

  tbody.innerHTML = "";
  if (outOfStock.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="no-results">Nothing on the 86 board.</td></tr>`;
    return;
  }

  const sorted = outOfStock.slice().sort((a, b) => new Date(b.outOfStock) - new Date(a.outOfStock));
  for (const item of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.description)} — ${escapeHtml(item.color)}</td>
      <td>${escapeHtml(item.size)}</td>
      <td>${item.outOfStock ? new Date(item.outOfStock).toLocaleString() : "—"}</td>
      <td><button class="btn secondary small board86-restock-btn" data-sku="${escapeHtml(item.sku)}" data-size="${escapeHtml(item.size)}">Restocked</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".board86-restock-btn").forEach((btn) => {
    btn.addEventListener("click", () => markBoard86Restocked(btn.dataset.sku, btn.dataset.size));
  });
}

async function markBoard86Restocked(sku, size) {
  if (!navigator.onLine) {
    setStatus("board86-status-msg", "Offline — nothing was updated. Try again once you have a connection.", true);
    return;
  }

  const nowIso = new Date().toISOString();

  try {
    await postFloor86Restock(getWebhookUrl(), { date: todayISO(), items: [{ sku, size }] });

    const restock = loadJSON(STORAGE.floorRestock, []);
    const idx = restock.findIndex((p) => p.sku === sku && p.size === size);
    if (idx !== -1) restock[idx].restocked = nowIso;
    saveJSON(STORAGE.floorRestock, restock);

    renderBoard86List();
    setStatus("board86-status-msg", "Marked restocked.", false);
  } catch (e) {
    setStatus("board86-status-msg", "Couldn't reach the sheet — check your connection and try again.", true);
  }
}
