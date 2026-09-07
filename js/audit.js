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

  renderAuditList();
}

function handleProductScan(upc) {
  const master = loadJSON(STORAGE.master, []);
  const item = master.find((p) => p.upc === upc);
  const statusEl = document.getElementById("scan-status");

  if (!item) {
    statusEl.textContent = `UPC ${upc} not found in Product Master List. Import it on the Product Master tab first.`;
    statusEl.classList.add("error");
    clearActiveItem();
    return;
  }

  statusEl.textContent = "";
  statusEl.classList.remove("error");
  activeAuditItem = item;

  document.getElementById("active-item-card").hidden = false;
  document.getElementById("active-sku").textContent = item.sku;
  document.getElementById("active-upc").textContent = item.upc;
  document.getElementById("active-desc").textContent = combinedDescription(item);

  const maoHint = document.getElementById("active-mao-hint");
  maoHint.textContent = item.maoAvailable == null ? "" : `Manhattan Omni last showed ${item.maoAvailable} available — confirm or correct it below.`;

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
  };

  const entries = loadJSON(STORAGE.auditLog, []);
  entries.unshift(entry);
  saveJSON(STORAGE.auditLog, entries);

  if (variance !== 0) {
    const adjustments = loadJSON(STORAGE.adjustments, []);
    adjustments.unshift({
      id: uid(),
      auditEntryId: entry.id,
      type: variance > 0 ? "in" : "out",
      sku: entry.sku,
      upc: entry.upc,
      description: entry.description,
      variance,
      supervisorInitials: "",
      completed: false,
      completedDate: null,
      createdAt: entry.timestamp,
    });
    saveJSON(STORAGE.adjustments, adjustments);
  }

  renderAuditList();
  clearActiveItem();

  const statusEl = document.getElementById("scan-status");
  statusEl.classList.remove("error");
  statusEl.textContent =
    variance === 0
      ? "Logged — count matched, no adjustment needed."
      : `Logged — ${variance > 0 ? "over" : "under"} by ${Math.abs(variance)}. Sent to ${
          variance > 0 ? "Mark In" : "Mark Out"
        } on the Inventory Adjustment tab.`;
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
      <div class="meta">Expected ${e.expected} · Counted ${e.counted} · ${escapeHtml(e.initials || "—")} · ${escapeHtml(e.date)}</div>
    `;
    listEl.appendChild(div);
  }
}

function exportAuditCsv() {
  const entries = loadJSON(STORAGE.auditLog, []);
  const header = ["date", "initials", "sku", "upc", "style", "description", "expected", "counted", "variance", "result", "timestamp"];
  const rows = [header, ...entries.map((e) => header.map((k) => e[k]))];
  downloadCsv(`audit-log-${todayISO()}.csv`, rows);
}
