"use strict";

let floorNeededItem = null; // FloorRestock item currently being sized in the "Needed" modal
let replenManualDescription = ""; // description staged for the manual-entry size modal

function initFloorReplen() {
  document.getElementById("checkfloor-filter").addEventListener("input", renderCheckFloorList);

  const lookupInput = document.getElementById("floor-lookup-input");
  lookupInput.addEventListener("input", () => renderFloorLookupResults(lookupInput.value.trim()));
  document.getElementById("floor-lookup-clear-btn").addEventListener("click", () => {
    lookupInput.value = "";
    lookupInput.focus();
    renderFloorLookupResults("");
  });

  document.getElementById("floor-needed-save-btn").addEventListener("click", saveFloorNeededModal);
  document.getElementById("floor-needed-cancel-btn").addEventListener("click", closeFloorNeededModal);

  document.getElementById("checkfloor-update-btn").addEventListener("click", commitCheckFloorUpdate);
  document.getElementById("replen-update-btn").addEventListener("click", commitReplenUpdate);

  document.getElementById("replen-manual-add-btn").addEventListener("click", openReplenManualSizeModal);
  document.getElementById("replen-manual-size-save-btn").addEventListener("click", saveReplenManualEntry);
  document.getElementById("replen-manual-size-cancel-btn").addEventListener("click", closeReplenManualSizeModal);

  renderCheckFloorList();
  renderCheckFloorHolding();
  renderReplenList();
  renderReplenHolding();
  renderLastFloorCheck();
}

/* ---------- Add a Product: catalog lookup for anything not on the
   MAO "items sold" export ---------- */

function renderFloorLookupResults(query) {
  const resultsEl = document.getElementById("floor-lookup-results");

  if (!query) {
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    return;
  }
  resultsEl.hidden = false;

  const matches = findMasterMatches(query);
  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="no-results">No matches for "${escapeHtml(query)}".</div>`;
    return;
  }

  resultsEl.innerHTML = "";
  for (const item of matches) {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="sku">${escapeHtml(item.sku)} · UPC ${escapeHtml(item.upc)}</div>
      <h3>${escapeHtml(combinedDescription(item))}</h3>
      <button class="btn secondary small floor-lookup-add-btn" data-sku="${escapeHtml(item.sku)}">Add to Check Floor</button>
    `;
    resultsEl.appendChild(card);
  }

  resultsEl.querySelectorAll(".floor-lookup-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => addProductToCheckFloor(btn.dataset.sku));
  });
}

async function addProductToCheckFloor(sku) {
  const master = loadJSON(STORAGE.master, []);
  const item = master.find((p) => p.sku === sku);
  if (!item) return;

  // Only block on a row still awaiting a Check Floor decision for this
  // exact sku+size — a previously resolved row (Not Needed, Picked,
  // restocked, etc.) is fine to add fresh, same as a genuine re-sale.
  const restock = loadJSON(STORAGE.floorRestock, []);
  const alreadyPending = restock.some((p) => p.sku === item.sku && p.size === item.size && !isFloorRestockChecked(p));
  if (alreadyPending) {
    setStatus("floor-lookup-status", "Already on the Check Floor list below.", true);
    return;
  }

  if (!navigator.onLine) {
    setStatus("floor-lookup-status", "Offline — nothing was added. Try again once you have a connection.", true);
    return;
  }

  setStatus("floor-lookup-status", "Adding…", false);

  try {
    await postFloorRestockAdd(getWebhookUrl(), {
      sku: item.sku,
      size: item.size,
      description: item.description,
      color: item.color,
    });

    restock.push({
      gender: "",
      category: "",
      description: item.description,
      color: item.color,
      size: item.size,
      sku: item.sku,
      qtySold: 0,
      onHand: 0,
      status: "",
      checkedBy: "",
      checkedDate: "",
      outOfStock: "",
      restocked: "",
    });
    saveJSON(STORAGE.floorRestock, restock);

    document.getElementById("floor-lookup-input").value = "";
    renderFloorLookupResults("");
    renderCheckFloorList();
    setStatus("floor-lookup-status", `Added ${combinedDescription(item)} to Check Floor.`, false);
  } catch (e) {
    setStatus("floor-lookup-status", "Couldn't reach the sheet — check your connection and try again.", true);
  }
}

/* ========== Check Floor ========== */

function loadCheckFloorHolding() {
  return loadJSON(STORAGE.checkFloorHolding, []);
}

function saveCheckFloorHolding(holding) {
  saveJSON(STORAGE.checkFloorHolding, holding);
}

function isCheckFloorHeld(sku, size) {
  return loadCheckFloorHolding().some((h) => h.sku === sku && h.size === size);
}

function renderCheckFloorList() {
  const tbody = document.getElementById("checkfloor-table-body");
  const restock = loadJSON(STORAGE.floorRestock, []);
  const filterVal = normalize(document.getElementById("checkfloor-filter").value);

  // A row disappears once it's been checked (Status set) — that's the end
  // of its life in this section. Anything currently staged shows in the
  // holding table instead, not duplicated here.
  const checkedCount = restock.filter(isFloorRestockChecked).length;
  const remaining = restock.filter((item) => !isFloorRestockChecked(item) && !isCheckFloorHeld(item.sku, item.size));

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
        <button class="btn secondary small checkfloor-needed-btn" data-sku="${escapeHtml(item.sku)}" data-size="${escapeHtml(item.size)}">Needed</button>
        <button class="btn secondary small checkfloor-notneeded-btn" data-sku="${escapeHtml(item.sku)}" data-size="${escapeHtml(item.size)}">Not Needed</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".checkfloor-needed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = restock.find(
        (p) => p.sku === btn.dataset.sku && p.size === btn.dataset.size && !isFloorRestockChecked(p)
      );
      if (item) openFloorNeededModal(item);
    });
  });
  tbody.querySelectorAll(".checkfloor-notneeded-btn").forEach((btn) => {
    btn.addEventListener("click", () => stageCheckFloorDecision(btn.dataset.sku, btn.dataset.size, "Not Needed", []));
  });
}

function stageCheckFloorDecision(sku, size, status, sizes) {
  const holding = loadCheckFloorHolding();
  if (holding.some((h) => h.sku === sku && h.size === size)) return;
  const restock = loadJSON(STORAGE.floorRestock, []);
  // sku+size alone isn't a stable key — the same product can sell out, get
  // restocked, and sell out again, leaving an older row sharing this exact
  // sku+size. Only a still-unchecked row is eligible for a Check Floor
  // decision.
  const item = restock.find((p) => p.sku === sku && p.size === size && !isFloorRestockChecked(p));
  if (!item) return;

  holding.push({ sku, size, description: item.description, color: item.color, status, sizes });
  saveCheckFloorHolding(holding);

  renderCheckFloorList();
  renderCheckFloorHolding();
}

function removeCheckFloorHolding(sku, size) {
  saveCheckFloorHolding(loadCheckFloorHolding().filter((h) => !(h.sku === sku && h.size === size)));
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
      <td><button class="btn secondary small checkfloor-holding-remove-btn" data-sku="${escapeHtml(h.sku)}" data-size="${escapeHtml(h.size)}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".checkfloor-holding-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeCheckFloorHolding(btn.dataset.sku, btn.dataset.size));
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

  const { sku, size } = floorNeededItem;
  closeFloorNeededModal();
  stageCheckFloorDecision(sku, size, "Needed", sizes);
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
      decisions: holding.map((h) => ({ sku: h.sku, size: h.size, status: h.status, sizes: h.sizes })),
    });

    // Mirror the same effects locally instead of waiting on a fresh GET —
    // matches handleCheckFloorUpdate in the Apps Script: the checked row
    // gets Status/Checked By/Checked Date, and every extra size (besides
    // the row's own) becomes a new FloorRestock row in the Replen queue.
    // Only match a still-unchecked row, same reasoning as stageCheckFloorDecision.
    const restock = loadJSON(STORAGE.floorRestock, []);

    for (const h of holding) {
      const idx = restock.findIndex((p) => p.sku === h.sku && p.size === h.size && !isFloorRestockChecked(p));
      if (idx === -1) continue;
      const item = restock[idx];
      item.status = h.status;
      item.checkedBy = initials;
      item.checkedDate = nowIso;

      if (h.status === "Needed") {
        const extraSizes = h.sizes.filter((size) => size !== h.size);
        for (const size of extraSizes) {
          restock.push({
            gender: item.gender,
            category: item.category,
            description: item.description,
            color: item.color,
            size,
            sku: item.sku,
            qtySold: 0,
            onHand: 0,
            status: "Needed",
            checkedBy: initials,
            checkedDate: nowIso,
            outOfStock: "",
            restocked: "",
          });
        }
      }
    }

    saveJSON(STORAGE.floorRestock, restock);
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

function isReplenHeld(sku, size) {
  return loadReplenHolding().some((h) => h.sku === sku && h.size === size);
}

function renderReplenList() {
  const tbody = document.getElementById("replen-table-body");
  const restock = loadJSON(STORAGE.floorRestock, []);

  const remaining = restock.filter((item) => isFloorRestockNeeded(item) && !isReplenHeld(item.sku, item.size));

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
        <button class="btn secondary small replen-picked-btn" data-sku="${escapeHtml(item.sku)}" data-size="${escapeHtml(item.size)}">Picked</button>
        <button class="btn secondary small replen-oos-btn" data-sku="${escapeHtml(item.sku)}" data-size="${escapeHtml(item.size)}">Out of Stock</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".replen-picked-btn").forEach((btn) => {
    btn.addEventListener("click", () => stageReplenDecision(btn.dataset.sku, btn.dataset.size, "picked"));
  });
  tbody.querySelectorAll(".replen-oos-btn").forEach((btn) => {
    btn.addEventListener("click", () => stageReplenDecision(btn.dataset.sku, btn.dataset.size, "outOfStock"));
  });
}

function stageReplenDecision(sku, size, action) {
  const holding = loadReplenHolding();
  if (holding.some((h) => h.sku === sku && h.size === size)) return;
  const restock = loadJSON(STORAGE.floorRestock, []);
  // Only a row still "Needed" is eligible — same sku+size reasoning as
  // stageCheckFloorDecision.
  const item = restock.find((p) => p.sku === sku && p.size === size && isFloorRestockNeeded(p));
  if (!item) return;

  holding.push({ sku, size, description: item.description, color: item.color, action });
  saveReplenHolding(holding);

  renderReplenList();
  renderReplenHolding();
}

function removeReplenHolding(sku, size) {
  saveReplenHolding(loadReplenHolding().filter((h) => !(h.sku === sku && h.size === size)));
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
      <td><button class="btn secondary small replen-holding-remove-btn" data-sku="${escapeHtml(h.sku)}" data-size="${escapeHtml(h.size)}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".replen-holding-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeReplenHolding(btn.dataset.sku, btn.dataset.size));
  });
}

async function commitReplenUpdate() {
  const holding = loadReplenHolding();
  if (holding.length === 0) return;

  if (!navigator.onLine) {
    setStatus("replen-status-msg", "Offline — nothing was updated. Try again once you have a connection.", true);
    return;
  }

  setStatus("replen-status-msg", `Updating ${holding.length} item${holding.length === 1 ? "" : "s"}…`, false);

  const nowIso = new Date().toISOString();

  try {
    await postFloorPickUpdate(getWebhookUrl(), {
      date: todayISO(),
      decisions: holding.map((h) => ({ sku: h.sku, size: h.size, action: h.action })),
    });

    const restock = loadJSON(STORAGE.floorRestock, []);
    for (const h of holding) {
      const idx = restock.findIndex((p) => p.sku === h.sku && p.size === h.size && isFloorRestockNeeded(p));
      if (idx === -1) continue;
      restock[idx].status = h.action === "picked" ? "Picked" : "Out of Stock";
      if (h.action === "outOfStock") restock[idx].outOfStock = nowIso;
    }
    saveJSON(STORAGE.floorRestock, restock);
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

/* ---------- Manual entry: not on the MAO export or in the catalog at all ----------
   Skips Check Floor entirely — typing it in by hand *is* the Needed decision.
   There's no real SKU for a hand-typed product, so a synthetic one is
   generated to key it through the same FloorRestock sku+size matching every
   other Floor Replen action relies on. Gender/Category/Color are left blank,
   same as a catalog "Add a Product" — nothing in the matching or lifecycle
   logic (Check Floor -> Replen -> 86 Board) ever keys off those, only
   sku+size, so they aren't needed for the site to pick the entry up. */

function openReplenManualSizeModal() {
  const descInput = document.getElementById("replen-manual-desc");
  const description = descInput.value.trim();
  if (!description) {
    setStatus("replen-manual-status", "Type a description first.", true);
    return;
  }
  replenManualDescription = description;
  document.getElementById("replen-manual-size-label").textContent = description;

  const wrap = document.getElementById("replen-manual-sizes");
  const otherInput = document.getElementById("replen-manual-other-size");
  otherInput.value = "";
  otherInput.hidden = true;

  wrap.innerHTML =
    FLOOR_CORE_SIZES.map(
      (size) => `
      <label class="floor-size-checkbox">
        <input type="radio" name="replen-manual-size-radio" class="replen-manual-size-radio" value="${escapeHtml(size)}">
        ${escapeHtml(size)}
      </label>`
    ).join("") +
    `<label class="floor-size-checkbox">
      <input type="radio" name="replen-manual-size-radio" id="replen-manual-other-radio">
      Other
    </label>`;

  wrap.querySelectorAll('input[name="replen-manual-size-radio"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      otherInput.hidden = radio.id !== "replen-manual-other-radio";
      if (!otherInput.hidden) otherInput.focus();
    });
  });

  document.getElementById("replen-manual-size-modal").hidden = false;
}

function closeReplenManualSizeModal() {
  document.getElementById("replen-manual-size-modal").hidden = true;
}

async function saveReplenManualEntry() {
  const wrap = document.getElementById("replen-manual-sizes");
  const checked = wrap.querySelector(".replen-manual-size-radio:checked");
  const otherRadio = document.getElementById("replen-manual-other-radio");
  const size = checked ? checked.value : otherRadio.checked ? document.getElementById("replen-manual-other-size").value.trim() : "";

  if (!size) {
    alert("Pick a size, or enter one under Other.");
    return;
  }

  if (!navigator.onLine) {
    setStatus("replen-manual-status", "Offline — nothing was added. Try again once you have a connection.", true);
    return;
  }

  const description = replenManualDescription;
  const sku = "MANUAL-" + uid();
  const session = loadJSON(STORAGE.session, {});
  const initials = (session.initials || "").trim();
  const nowIso = new Date().toISOString();

  closeReplenManualSizeModal();
  setStatus("replen-manual-status", "Adding…", false);

  try {
    // A single call, not two chained ones — postToSheet retries any
    // request it thinks failed (Apps Script's doPost can be slow enough to
    // look like a dropped request even after it already succeeded), and
    // two separate appending/matching calls doubled that risk: a retried
    // "add" could land a second blank row, or a retried "update" could
    // match a different one than the first attempt did. handleReplenManualAdd
    // on the server is idempotent by sku (a fresh one per submission), so
    // even a retried request just no-ops instead of duplicating anything.
    await postReplenManualAdd(getWebhookUrl(), { sku, size, description, initials });

    const restock = loadJSON(STORAGE.floorRestock, []);
    restock.push({
      gender: "",
      category: "",
      description,
      color: "",
      size,
      sku,
      qtySold: 0,
      onHand: 0,
      status: "Needed",
      checkedBy: initials,
      checkedDate: nowIso,
      outOfStock: "",
      restocked: "",
    });
    saveJSON(STORAGE.floorRestock, restock);

    document.getElementById("replen-manual-desc").value = "";
    renderReplenList();
    setStatus("replen-manual-status", `Added ${description} — size ${size} to Replen.`, false);
  } catch (e) {
    setStatus(
      "replen-manual-status",
      "Couldn't reach the sheet — check your connection and try again.",
      true
    );
  }
}
