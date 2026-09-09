"use strict";

let activeAuditItem = null;

function initAuditDashboard() {
  const session = loadJSON(STORAGE.session, {});
  const dateInput = document.getElementById("audit-date");
  const initialsInput = document.getElementById("audit-initials");
  dateInput.value = session.date || todayISO();
  initialsInput.value = session.initials || "";

  function saveSession() {
    saveJSON(STORAGE.session, { date: dateInput.value || todayISO(), initials: initialsInput.value.trim() });
  }
  dateInput.addEventListener("change", saveSession);
  initialsInput.addEventListener("change", saveSession);
  saveSession();

  document.getElementById("scan-product-btn").addEventListener("click", () => {
    openScanner("Scanning product to count…", handleProductScan);
  });

  document.getElementById("cancel-count-btn").addEventListener("click", clearActiveItem);
  document.getElementById("submit-count-btn").addEventListener("click", submitCount);
  document.getElementById("export-audit-csv-btn").addEventListener("click", exportAuditCsv);

  document.getElementById("add-product-cancel-btn").addEventListener("click", clearAddProductCard);
  document.getElementById("add-product-save-btn").addEventListener("click", saveNewProduct);

  initSync();
  renderAuditList();
}

function handleProductScan(upc) {
  const master = loadJSON(STORAGE.master, []);
  const item = master.find((p) => p.upc === upc);

  if (!item) {
    clearScanStatus();
    clearActiveItem();
    showAddProductCard(upc);
    return;
  }

  clearScanStatus();
  clearAddProductCard();
  populateActiveItemCard(item);
}

function clearScanStatus() {
  const statusEl = document.getElementById("scan-status");
  statusEl.textContent = "";
  statusEl.classList.remove("error");
}

function populateActiveItemCard(item) {
  activeAuditItem = item;
  document.getElementById("active-item-card").hidden = false;
  document.getElementById("active-sku").textContent = item.sku;
  document.getElementById("active-upc").textContent = item.upc;
  document.getElementById("active-desc").textContent = combinedDescription(item);

  const expectedInput = document.getElementById("expected-input");
  expectedInput.value = item.expectedCount == null ? "" : item.expectedCount;

  const countInput = document.getElementById("count-input");
  countInput.value = "";
  (item.expectedCount == null ? expectedInput : countInput).focus();
}

function clearActiveItem() {
  activeAuditItem = null;
  document.getElementById("active-item-card").hidden = true;
}

function showAddProductCard(upc) {
  document.getElementById("add-product-card").hidden = false;
  document.getElementById("add-product-upc").textContent = `UPC ${upc}`;
  for (const id of ["add-sku", "add-description", "add-style", "add-dept", "add-color", "add-size"]) {
    document.getElementById(id).value = "";
  }
  document.getElementById("add-product-card").dataset.upc = upc;
  document.getElementById("add-sku").focus();
}

function clearAddProductCard() {
  document.getElementById("add-product-card").hidden = true;
}

async function saveNewProduct() {
  const upc = document.getElementById("add-product-card").dataset.upc;
  const sku = document.getElementById("add-sku").value.trim();
  const description = document.getElementById("add-description").value.trim();

  if (!sku || !description) {
    alert("SKU and Description are required.");
    return;
  }

  const item = {
    sku,
    upc,
    description,
    style: document.getElementById("add-style").value.trim(),
    dept: document.getElementById("add-dept").value.trim(),
    color: document.getElementById("add-color").value.trim(),
    size: document.getElementById("add-size").value.trim(),
  };

  upsertProductMaster([item]);
  clearAddProductCard();

  const statusEl = document.getElementById("scan-status");
  statusEl.classList.remove("error");
  statusEl.textContent = "Added — sharing with the catalog sheet…";

  try {
    await pushProductToSheet(getWebhookUrl(), item);
    statusEl.textContent = "Added and shared with the catalog sheet.";
  } catch (e) {
    statusEl.classList.add("error");
    statusEl.textContent = "Added on this device, but couldn't share it yet — check your connection. It'll stay local until the next successful import/sync.";
  }

  // Continue straight into counting it, same as a normal scan hit — without
  // clobbering the status message above via handleProductScan()'s own reset.
  const master = loadJSON(STORAGE.master, []);
  const stored = master.find((p) => p.sku === sku);
  if (stored) populateActiveItemCard(stored);
}

function submitCount() {
  if (!activeAuditItem) return;

  const expectedInput = document.getElementById("expected-input");
  const expectedRaw = expectedInput.value;
  if (expectedRaw === "") {
    alert("Enter the expected count first.");
    expectedInput.focus();
    return;
  }
  const expected = parseInt(expectedRaw, 10);
  if (isNaN(expected) || expected < 0) {
    alert("Enter a valid non-negative expected count.");
    expectedInput.focus();
    return;
  }

  const countInput = document.getElementById("count-input");
  const countedRaw = countInput.value;
  if (countedRaw === "") {
    alert("Enter the actual count.");
    countInput.focus();
    return;
  }
  const counted = parseInt(countedRaw, 10);
  if (isNaN(counted) || counted < 0) {
    alert("Enter a valid non-negative actual count.");
    countInput.focus();
    return;
  }

  if (expected !== activeAuditItem.expectedCount) {
    setExpectedCount(activeAuditItem.sku, expected);
  }

  const session = loadJSON(STORAGE.session, {});
  const variance = counted - expected;
  const result = variance === 0 ? "match" : variance > 0 ? "over" : "under";

  const entry = {
    id: uid(),
    timestamp: new Date().toISOString(),
    date: session.date || todayISO(),
    initials: (session.initials || "").trim(),
    sku: activeAuditItem.sku,
    upc: activeAuditItem.upc,
    style: activeAuditItem.style,
    description: combinedDescription(activeAuditItem),
    expected,
    counted,
    variance,
    result,
    synced: false,
  };

  const entries = loadJSON(STORAGE.auditLog, []);
  entries.unshift(entry);
  saveJSON(STORAGE.auditLog, entries);

  renderAuditList();
  clearActiveItem();

  const statusEl = document.getElementById("scan-status");
  statusEl.classList.remove("error");
  statusEl.textContent =
    variance === 0
      ? "Logged — count matched."
      : `Logged — ${variance > 0 ? "over" : "under"} by ${Math.abs(variance)}.`;
}

function renderAuditList() {
  const listEl = document.getElementById("audit-list");
  const entries = loadJSON(STORAGE.auditLog, []);
  listEl.innerHTML = "";

  if (entries.length === 0) {
    listEl.innerHTML = `<p class="hint">No audit entries yet.</p>`;
    return;
  }

  for (const e of entries.slice(0, 50)) {
    const div = document.createElement("div");
    div.className = "audit-entry";
    const pillLabel = e.result === "match" ? "match" : e.variance > 0 ? `+${e.variance}` : `${e.variance}`;
    div.innerHTML = `
      <div class="audit-entry-top">
        <span>${escapeHtml(e.sku)}</span>
        <span class="result-pill ${e.result}">${escapeHtml(pillLabel)}</span>
      </div>
      <div class="meta">${escapeHtml(e.description)}</div>
      <div class="meta">
        Expected ${e.expected} · Counted ${e.counted} · ${escapeHtml(e.initials || "—")} · ${escapeHtml(e.date)}
        · <span class="sync-pill">${e.synced ? "synced" : "not synced"}</span>
      </div>
    `;
    listEl.appendChild(div);
  }
}

function exportAuditCsv() {
  const entries = loadJSON(STORAGE.auditLog, []);
  const header = ["date", "initials", "sku", "upc", "style", "description", "expected", "counted", "variance", "result", "timestamp", "synced"];
  const rows = [header, ...entries.map((e) => header.map((k) => e[k]))];
  downloadCsv(`audit-log-${todayISO()}.csv`, rows);
}
