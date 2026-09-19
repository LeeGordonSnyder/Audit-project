"use strict";

let floorNeededItem = null; // FloorRestock item currently being sized in the "Needed" modal

function initFloorReplen() {
  document.getElementById("checkfloor-filter").addEventListener("input", renderCheckFloorList);

  document.getElementById("floor-needed-save-btn").addEventListener("click", saveFloorNeededModal);
  document.getElementById("floor-needed-cancel-btn").addEventListener("click", closeFloorNeededModal);

  document.getElementById("checkfloor-update-btn").addEventListener("click", commitCheckFloorUpdate);
  document.getElementById("replen-update-btn").addEventListener("click", commitReplenUpdate);

  renderCheckFloorList();
  renderCheckFloorHolding();
  renderReplenList();
  renderReplenHolding();
  renderLastFloorCheck();
}

/* ========== Check Floor ========== */

function loadCheckFloorHolding() {
  return loadJSON(STORAGE.checkFloorHolding, []);
}

function saveCheckFloorHolding(holding) {
  saveJSON(STORAGE.checkFloorHolding, holding);
}

function isCheckFloorHeld(sku) {
  return loadCheckFloorHolding().some((h) => h.sku === sku);
}

function renderCheckFloorList() {
  const tbody = document.getElementById("checkfloor-table-body");
  const restock = loadJSON(STORAGE.floorRestock, []);
  const filterVal = normalize(document.getElementById("checkfloor-filter").value);

  // A row disappears once it's been checked (Status set) — that's the end
  // of its life in this section. Anything currently staged shows in the
  // holding table instead, not duplicated here.
  const checkedCount = restock.filter(isFloorRestockChecked).length;
  const remaining = restock.filter((item) => !isFloorRestockChecked(item) && !isCheckFloorHeld(item.sku));

  const filtered = remaining.filter(
    (item) =>
      !filterVal ||
      normalize(item.description).includes(filterVal) ||
      normalize(item.sku).includes(filterVal) ||
      normalize(item.color).includes(filterVal)
  );

  const heldCount = restock.length - remaining.length - checkedCount;
  document.getElementById("checkfloor-count").textContent =
    `${filtered.length} of ${remaining.length} remaining` +
    (heldCount > 0 ? ` · ${heldCount} in holding` : "") +
    (checkedCount > 0 ? ` · ${checkedCount} checked` : "");

  tbody.innerHTML = "";

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="no-results">${
      restock.length === 0
        ? "No sold items yet — paste the MAO export into the FloorRestock sheet, then tap Refresh."
        : remaining.length === 0
        ? "All items checked — nothing left to review."
        : "No items match that filter."
    }</td></tr>`;
    return;
  }

  const sorted = filtered.slice().sort((a, b) => a.description.localeCompare(b.description));

  for (const item of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.color)}</td>
      <td>${escapeHtml(item.size)}</td>
      <td class="mono">${escapeHtml(item.sku)}</td>
      <td class="num">${item.qtySold}</td>
      <td class="num">${item.onHand}</td>
      <td>
        <button class="btn secondary small checkfloor-needed-btn" data-sku="${escapeHtml(item.sku)}">Needed</button>
        <button class="btn secondary small checkfloor-notneeded-btn" data-sku="${escapeHtml(item.sku)}">Not Needed</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".checkfloor-needed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = restock.find((p) => p.sku === btn.dataset.sku);
      if (item) openFloorNeededModal(item);
    });
  });
  tbody.querySelectorAll(".checkfloor-notneeded-btn").forEach((btn) => {
    btn.addEventListener("click", () => stageCheckFloorDecision(btn.dataset.sku, "Not Needed", []));
  });
}

function stageCheckFloorDecision(sku, status, sizes) {
  const holding = loadCheckFloorHolding();
  if (holding.some((h) => h.sku === sku)) return;
  const restock = loadJSON(STORAGE.floorRestock, []);
  const item = restock.find((p) => p.sku === sku);
  if (!item) return;

  holding.push({ sku, description: item.description, color: item.color, status, sizes });
  saveCheckFloorHolding(holding);

  renderCheckFloorList();
  renderCheckFloorHolding();
}

function removeCheckFloorHolding(sku) {
  saveCheckFloorHolding(loadCheckFloorHolding().filter((h) => h.sku !== sku));
  renderCheckFloorList();
  renderCheckFloorHolding();
}

function renderCheckFloorHolding() {
  const tbody = document.getElementById("checkfloor-holding-table-body");
  const wrap = document.getElementById("checkfloor-holding-table-wrap");
  const emptyMsg = document.getElementById("checkfloor-holding-empty");
  const holding = loadCheckFloorHolding();

  document.getElementById("checkfloor-holding-count").textContent = holding.length
    ? `${holding.length} item${holding.length === 1 ? "" : "s"} staged`
    : "";
  document.getElementById("checkfloor-update-btn").disabled = holding.length === 0;

  if (holding.length === 0) {
    emptyMsg.hidden = false;
    wrap.hidden = true;
    return;
  }
  emptyMsg.hidden = true;
  wrap.hidden = false;

  tbody.innerHTML = "";
  for (const h of holding) {
    const sizesText = h.status === "Needed" ? h.sizes.join(", ") : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(h.description)} — ${escapeHtml(h.color)}</td>
      <td>${escapeHtml(h.status)}</td>
      <td>${escapeHtml(sizesText)}</td>
      <td><button class="btn secondary small checkfloor-holding-remove-btn" data-sku="${escapeHtml(h.sku)}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".checkfloor-holding-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeCheckFloorHolding(btn.dataset.sku));
  });
}

/* ---------- "Needed" modal: pick one or more core sizes, or Other ---------- */

function openFloorNeededModal(item) {
  floorNeededItem = item;
  document.getElementById("floor-needed-label").textContent = `${item.description} — ${item.color}`;

  const wrap = document.getElementById("floor-needed-sizes");
  wrap.innerHTML =
    FLOOR_CORE_SIZES.map(
      (size) => `
      <label class="floor-size-checkbox">
        <input type="checkbox" class="floor-needed-size-cb" value="${escapeHtml(size)}">
        ${escapeHtml(size)}
      </label>`
    ).join("") +
    `<label class="floor-size-checkbox">
      <input type="checkbox" id="floor-needed-other-cb">
      Other (any size)
    </label>`;

  // Other means "any size" — mutually exclusive with picking specific sizes.
  wrap.querySelectorAll(".floor-needed-size-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) document.getElementById("floor-needed-other-cb").checked = false;
    });
  });
  document.getElementById("floor-needed-other-cb").addEventListener("change", (e) => {
    if (e.target.checked) {
      wrap.querySelectorAll(".floor-needed-size-cb").forEach((cb) => (cb.checked = false));
    }
  });

  document.getElementById("floor-needed-modal").hidden = false;
}

function closeFloorNeededModal() {
  floorNeededItem = null;
  document.getElementById("floor-needed-modal").hidden = true;
}

function saveFloorNeededModal() {
  if (!floorNeededItem) return;

  const wrap = document.getElementById("floor-needed-sizes");
  const checkedSizes = Array.from(wrap.querySelectorAll(".floor-needed-size-cb:checked")).map((cb) => cb.value);
  const otherChecked = document.getElementById("floor-needed-other-cb").checked;
  const sizes = otherChecked ? ["Other"] : checkedSizes;

  if (sizes.length === 0) {
    alert("Select at least one size, or Other.");
    return;
  }

  const sku = floorNeededItem.sku;
  closeFloorNeededModal();
  stageCheckFloorDecision(sku, "Needed", sizes);
}

/* ---------- Commit Check Floor holding to the sheet ---------- */

async function commitCheckFloorUpdate() {
  const holding = loadCheckFloorHolding();
  if (holding.length === 0) return;

  if (!navigator.onLine) {
    setStatus("checkfloor-status-msg", "Offline — nothing was updated. Try again once you have a connection.", true);
    return;
  }

  const session = loadJSON(STORAGE.session, {});
  const initials = (session.initials || "").trim();
  const date = todayISO();
  const nowIso = new Date().toISOString();

  setStatus("checkfloor-status-msg", `Updating ${holding.length} item${holding.length === 1 ? "" : "s"}…`, false);

  try {
    await postCheckFloorUpdate(getWebhookUrl(), {
      initials,
      date,
      decisions: holding.map((h) => ({ sku: h.sku, status: h.status, sizes: h.sizes })),
    });

    // Mirror the same effects locally instead of waiting on a fresh GET.
    const restock = loadJSON(STORAGE.floorRestock, []);
    const replen = loadJSON(STORAGE.floorReplen, []);

    for (const h of holding) {
      const idx = restock.findIndex((p) => p.sku === h.sku);
      if (idx !== -1) {
        restock[idx].status = h.status;
        restock[idx].checkedBy = initials;
        restock[idx].checkedDate = nowIso;
      }
      if (h.status === "Needed") {
        for (const size of h.sizes) {
          replen.push({
            id: uid(),
            sku: h.sku,
            description: h.description,
            color: h.color,
            size,
            status: "open",
            checkedBy: initials,
            checkedDate: nowIso,
            pickedBy: "",
            pickedDate: "",
            restockedBy: "",
            restockedDate: "",
          });
        }
      }
    }

    saveJSON(STORAGE.floorRestock, restock);
    saveJSON(STORAGE.floorReplen, replen);
    saveCheckFloorHolding([]);

    renderCheckFloorList();
    renderCheckFloorHolding();
    renderReplenList();
    renderLastFloorCheck();
    setStatus("checkfloor-status-msg", `Updated ${holding.length} item${holding.length === 1 ? "" : "s"}.`, false);
  } catch (e) {
    setStatus(
      "checkfloor-status-msg",
      "Couldn't reach the sheet — check your connection and try again. Items stay staged.",
      true
    );
  }
}

function renderLastFloorCheck() {
  const el = document.getElementById("last-floor-check");
  if (!el) return;

  const restock = loadJSON(STORAGE.floorRestock, []);
  const checked = restock.filter((item) => item.checkedDate);
  if (checked.length === 0) {
    el.textContent = "Floor not checked yet.";
    return;
  }
  const latest = checked.reduce((a, b) => (new Date(a.checkedDate) > new Date(b.checkedDate) ? a : b));
  el.textContent = `Last checked: ${new Date(latest.checkedDate).toLocaleString()} by ${latest.checkedBy || "—"}`;
}

/* ========== Replen (picking list) ========== */

function loadReplenHolding() {
  return loadJSON(STORAGE.replenHolding, []);
}

function saveReplenHolding(holding) {
  saveJSON(STORAGE.replenHolding, holding);
}

function isReplenHeld(id) {
  return loadReplenHolding().some((h) => h.id === id);
}

function renderReplenList() {
  const tbody = document.getElementById("replen-table-body");
  const replen = loadJSON(STORAGE.floorReplen, []);

  const remaining = replen.filter((item) => item.status === "open" && !isReplenHeld(item.id));

  document.getElementById("replen-count").textContent =
    `${remaining.length} item${remaining.length === 1 ? "" : "s"} to pick`;

  tbody.innerHTML = "";
  if (remaining.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="no-results">Nothing to pick right now.</td></tr>`;
    return;
  }

  const sorted = remaining.slice().sort((a, b) => a.description.localeCompare(b.description));
  for (const item of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.description)} — ${escapeHtml(item.color)}</td>
      <td>${escapeHtml(item.size)}</td>
      <td>
        <button class="btn secondary small replen-picked-btn" data-id="${escapeHtml(item.id)}">Picked</button>
        <button class="btn secondary small replen-oos-btn" data-id="${escapeHtml(item.id)}">Out of Stock</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".replen-picked-btn").forEach((btn) => {
    btn.addEventListener("click", () => stageReplenDecision(btn.dataset.id, "picked"));
  });
  tbody.querySelectorAll(".replen-oos-btn").forEach((btn) => {
    btn.addEventListener("click", () => stageReplenDecision(btn.dataset.id, "outOfStock"));
  });
}

function stageReplenDecision(id, action) {
  const holding = loadReplenHolding();
  if (holding.some((h) => h.id === id)) return;
  const replen = loadJSON(STORAGE.floorReplen, []);
  const item = replen.find((p) => p.id === id);
  if (!item) return;

  holding.push({ id, description: item.description, color: item.color, size: item.size, action });
  saveReplenHolding(holding);

  renderReplenList();
  renderReplenHolding();
}

function removeReplenHolding(id) {
  saveReplenHolding(loadReplenHolding().filter((h) => h.id !== id));
  renderReplenList();
  renderReplenHolding();
}

function renderReplenHolding() {
  const tbody = document.getElementById("replen-holding-table-body");
  const wrap = document.getElementById("replen-holding-table-wrap");
  const emptyMsg = document.getElementById("replen-holding-empty");
  const holding = loadReplenHolding();

  document.getElementById("replen-holding-count").textContent = holding.length ? `${holding.length} staged` : "";
  document.getElementById("replen-update-btn").disabled = holding.length === 0;

  if (holding.length === 0) {
    emptyMsg.hidden = false;
    wrap.hidden = true;
    return;
  }
  emptyMsg.hidden = true;
  wrap.hidden = false;

  tbody.innerHTML = "";
  for (const h of holding) {
    const actionLabel = h.action === "picked" ? "Picked" : "Out of Stock";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(h.description)} — ${escapeHtml(h.color)}</td>
      <td>${escapeHtml(h.size)}</td>
      <td>${escapeHtml(actionLabel)}</td>
      <td><button class="btn secondary small replen-holding-remove-btn" data-id="${escapeHtml(h.id)}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".replen-holding-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeReplenHolding(btn.dataset.id));
  });
}

async function commitReplenUpdate() {
  const holding = loadReplenHolding();
  if (holding.length === 0) return;

  if (!navigator.onLine) {
    setStatus("replen-status-msg", "Offline — nothing was updated. Try again once you have a connection.", true);
    return;
  }

  const session = loadJSON(STORAGE.session, {});
  const initials = (session.initials || "").trim();
  const nowIso = new Date().toISOString();

  setStatus("replen-status-msg", `Updating ${holding.length} item${holding.length === 1 ? "" : "s"}…`, false);

  try {
    await postFloorReplenUpdate(getWebhookUrl(), {
      initials,
      date: todayISO(),
      decisions: holding.map((h) => ({ id: h.id, action: h.action })),
    });

    const replen = loadJSON(STORAGE.floorReplen, []);
    for (const h of holding) {
      const idx = replen.findIndex((p) => p.id === h.id);
      if (idx === -1) continue;
      replen[idx].status = h.action;
      replen[idx].pickedBy = initials;
      replen[idx].pickedDate = nowIso;
    }
    saveJSON(STORAGE.floorReplen, replen);
    saveReplenHolding([]);

    renderReplenList();
    renderReplenHolding();
    setStatus("replen-status-msg", `Updated ${holding.length} item${holding.length === 1 ? "" : "s"}.`, false);
  } catch (e) {
    setStatus(
      "replen-status-msg",
      "Couldn't reach the sheet — check your connection and try again. Items stay staged.",
      true
    );
  }
}
