"use strict";

function initBoard86() {
  renderBoard86List();
}

function renderBoard86List() {
  const tbody = document.getElementById("board86-table-body");
  const replen = loadJSON(STORAGE.floorReplen, []);

  const outOfStock = replen.filter((item) => item.status === "outOfStock");

  document.getElementById("board86-count").textContent =
    `${outOfStock.length} item${outOfStock.length === 1 ? "" : "s"} out of stock`;

  tbody.innerHTML = "";
  if (outOfStock.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="no-results">Nothing on the 86 board.</td></tr>`;
    return;
  }

  const sorted = outOfStock.slice().sort((a, b) => new Date(b.pickedDate) - new Date(a.pickedDate));
  for (const item of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.description)} — ${escapeHtml(item.color)}</td>
      <td>${escapeHtml(item.size)}</td>
      <td>${item.pickedDate ? new Date(item.pickedDate).toLocaleString() : "—"}</td>
      <td><button class="btn secondary small board86-restock-btn" data-id="${escapeHtml(item.id)}">Restocked</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".board86-restock-btn").forEach((btn) => {
    btn.addEventListener("click", () => markBoard86Restocked(btn.dataset.id));
  });
}

async function markBoard86Restocked(id) {
  if (!navigator.onLine) {
    setStatus("board86-status-msg", "Offline — nothing was updated. Try again once you have a connection.", true);
    return;
  }

  const session = loadJSON(STORAGE.session, {});
  const initials = (session.initials || "").trim();
  const nowIso = new Date().toISOString();

  try {
    await postFloor86Restock(getWebhookUrl(), { initials, date: todayISO(), ids: [id] });

    const replen = loadJSON(STORAGE.floorReplen, []);
    const idx = replen.findIndex((p) => p.id === id);
    if (idx !== -1) {
      replen[idx].status = "restocked";
      replen[idx].restockedBy = initials;
      replen[idx].restockedDate = nowIso;
    }
    saveJSON(STORAGE.floorReplen, replen);

    renderBoard86List();
    setStatus("board86-status-msg", "Marked restocked.", false);
  } catch (e) {
    setStatus("board86-status-msg", "Couldn't reach the sheet — check your connection and try again.", true);
  }
}
