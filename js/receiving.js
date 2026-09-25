"use strict";

function initReceiving() {
  document.getElementById("receiving-import-btn").addEventListener("click", async () => {
    const textarea = document.getElementById("receiving-paste-area");
    const parsed = parseReceivingPaste(textarea.value);
    if (!parsed.length) {
      setStatus(
        "receiving-import-status",
        "No boxes found — check it's pasted with ETA/Package/PO # lines.",
        true
      );
      return;
    }

    const result = upsertReceivingMaster(parsed);
    textarea.value = "";
    renderReceivingList();

    setStatus("receiving-import-status", `Added ${result.added}, updated ${result.updated}. Sharing with the sheet…`, false);

    const url = getWebhookUrl();
    let shared = 0;
    if (navigator.onLine) {
      // pushReceivingItemToSheet() already retries transient failures
      // internally, so keep going through the rest of the batch rather
      // than stopping at the first one that still fails.
      for (const item of parsed) {
        try {
          await pushReceivingItemToSheet(url, item);
          shared++;
        } catch (e) {
          // leave this one local-only, keep going with the rest
        }
      }
    }

    setStatus(
      "receiving-import-status",
      shared === parsed.length
        ? `Added ${result.added}, updated ${result.updated}, and shared all ${shared} with the sheet.`
        : `Added ${result.added}, updated ${result.updated} locally. Only shared ${shared} of ${parsed.length} with the sheet — check your connection and import again to finish sharing.`,
      shared !== parsed.length
    );
  });

  document.getElementById("receiving-filter").addEventListener("input", renderReceivingList);

  document.getElementById("receiving-scan-btn").addEventListener("click", () => {
    openScanner("Scanning boxes…", handleReceivingScan, { continuous: true });
  });

  document.getElementById("receiving-mark-physical-btn").addEventListener("click", () => markHeldReceiving("physical"));
  document.getElementById("receiving-mark-mao-btn").addEventListener("click", () => markHeldReceiving("mao"));

  document.getElementById("receiving-add-selected-btn").addEventListener("click", addSelectedToHolding);
  document.getElementById("receiving-select-all").addEventListener("change", (e) => {
    document.querySelectorAll(".receiving-select-checkbox").forEach((cb) => (cb.checked = e.target.checked));
  });

  document.getElementById("export-receiving-csv-btn").addEventListener("click", exportReceivingCsv);

  document.getElementById("receiving-add-box-save-btn").addEventListener("click", saveReceivingAddBoxModal);
  document.getElementById("receiving-add-box-cancel-btn").addEventListener("click", closeReceivingAddBoxModal);

  renderReceivingList();
  renderReceivingHolding();
}

/* ---------- Holding (scanned, not yet actioned) ---------- */

function loadReceivingHolding() {
  return loadJSON(STORAGE.receivingHolding, []);
}

function saveReceivingHolding(holding) {
  saveJSON(STORAGE.receivingHolding, holding);
}

function isHeld(barcode) {
  return loadReceivingHolding().some((b) => b.barcode === barcode);
}

// Shared by both the scanner and the manual checkbox picker below — the
// two are just different ways of choosing the same barcode.
function addBoxToHolding(barcode) {
  const master = loadJSON(STORAGE.receivingMaster, []);
  const item = master.find((p) => p.barcode === barcode);

  if (!item) return { ok: false, reason: "not-expected", message: `${barcode} — not in the expected shipment list.` };
  if (item.receivedIntoMaoDate) return { ok: false, reason: "already-mao", message: `${barcode} — already received into MAO.` };

  const holding = loadReceivingHolding();
  if (holding.some((b) => b.barcode === barcode)) {
    return { ok: false, reason: "already-held", message: `${barcode} — already in the holding list.` };
  }

  holding.push({ barcode: item.barcode, po: item.po });
  saveReceivingHolding(holding);
  return { ok: true, message: `Added ${barcode} (PO ${item.po}).`, heldCount: holding.length };
}

// Called on every decode while the continuous scanner is open — feedback
// goes into the scanner modal itself (scanner-modal-feedback) since the
// modal covers the whole page while scanning. A barcode that isn't in the
// expected shipment list at all stops the scan and hands off to the
// "add manually" modal instead of just reporting an error — that's the
// one case where staff actually need to do something about it.
function handleReceivingScan(text) {
  const barcode = text.trim();
  const result = addBoxToHolding(barcode);

  if (result.ok) {
    renderReceivingList();
    renderReceivingHolding();
    setStatus(
      "scanner-modal-feedback",
      `${result.message} ${result.heldCount} box${result.heldCount === 1 ? "" : "es"} held.`,
      false
    );
    return;
  }

  if (result.reason === "not-expected") {
    closeScanner();
    openReceivingAddBoxModal(barcode);
    return;
  }

  setStatus("scanner-modal-feedback", result.message, true);
}

/* ---------- "Box not in expected shipments" manual add ---------- */

function openReceivingAddBoxModal(barcode) {
  document.getElementById("receiving-add-box-barcode").value = barcode;
  document.getElementById("receiving-add-box-po").value = "";
  setStatus("receiving-add-box-status", "", false);
  document.getElementById("receiving-add-box-modal").hidden = false;
  document.getElementById("receiving-add-box-po").focus();
}

function closeReceivingAddBoxModal() {
  document.getElementById("receiving-add-box-modal").hidden = true;
}

// Adds locally first (so the box lands in holding right away, no
// connection required to keep working), then tries to share it — same
// resilience pattern as adding a new catalog product from the Audit
// Dashboard. It reuses the same "receivingimport" endpoint the paste
// import uses, just with one item instead of a batch.
async function saveReceivingAddBoxModal() {
  const barcode = document.getElementById("receiving-add-box-barcode").value;
  const po = document.getElementById("receiving-add-box-po").value.trim();

  if (!po) {
    setStatus("receiving-add-box-status", "Enter the PO # first.", true);
    return;
  }

  const item = { barcode, po, expectedDate: "" };
  upsertReceivingMaster([item]);
  addBoxToHolding(barcode);

  renderReceivingList();
  renderReceivingHolding();
  closeReceivingAddBoxModal();
  setStatus("receiving-status-msg", `Added ${barcode} (PO ${po}) and put it in holding — sharing with the sheet…`, false);

  try {
    await pushReceivingItemToSheet(getWebhookUrl(), item);
    setStatus("receiving-status-msg", `Added ${barcode} (PO ${po}) to holding and shared it with the sheet.`, false);
  } catch (e) {
    setStatus(
      "receiving-status-msg",
      `Added ${barcode} (PO ${po}) to holding locally, but couldn't share it yet — check your connection. It'll stay local until the next successful import/scan.`,
      true
    );
  }
}

// No camera handy (e.g. working from a computer)? Check boxes in the
// Expected Boxes table and add them the same way a scan would.
function addSelectedToHolding() {
  const checkboxes = document.querySelectorAll(".receiving-select-checkbox:checked");
  if (checkboxes.length === 0) return;

  let addedCount = 0;
  checkboxes.forEach((cb) => {
    if (addBoxToHolding(cb.dataset.barcode).ok) addedCount++;
  });

  document.getElementById("receiving-select-all").checked = false;
  renderReceivingList();
  renderReceivingHolding();
  setStatus("receiving-status-msg", `Added ${addedCount} box${addedCount === 1 ? "" : "es"} to holding.`, false);
}

function removeFromHolding(barcode) {
  saveReceivingHolding(loadReceivingHolding().filter((b) => b.barcode !== barcode));
  renderReceivingList();
  renderReceivingHolding();
}

function renderReceivingHolding() {
  const tbody = document.getElementById("receiving-holding-table-body");
  const wrap = document.getElementById("receiving-holding-table-wrap");
  const emptyMsg = document.getElementById("receiving-holding-empty");
  const holding = loadReceivingHolding();

  document.getElementById("receiving-holding-count").textContent = holding.length
    ? `${holding.length} box${holding.length === 1 ? "" : "es"} held`
    : "";

  document.getElementById("receiving-mark-physical-btn").disabled = holding.length === 0;
  document.getElementById("receiving-mark-mao-btn").disabled = holding.length === 0;

  if (holding.length === 0) {
    emptyMsg.hidden = false;
    wrap.hidden = true;
    return;
  }

  emptyMsg.hidden = true;
  wrap.hidden = false;

  tbody.innerHTML = "";
  for (const item of holding) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${escapeHtml(item.barcode)}</td>
      <td>${escapeHtml(item.po)}</td>
      <td><button class="btn secondary small receiving-holding-remove-btn" data-barcode="${escapeHtml(item.barcode)}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".receiving-holding-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeFromHolding(btn.dataset.barcode));
  });
}

async function markHeldReceiving(status) {
  const holding = loadReceivingHolding();
  if (holding.length === 0) return;

  if (!navigator.onLine) {
    setStatus("receiving-status-msg", "Offline — nothing was marked. Try again once you have a connection.", true);
    return;
  }

  const session = loadJSON(STORAGE.session, {});
  const date = todayISO();
  const initials = (session.initials || "").trim();
  const barcodes = holding.map((b) => b.barcode);
  const label = status === "mao" ? "Received into MAO" : "Physically Received";

  setStatus("receiving-status-msg", `Marking ${barcodes.length} box${barcodes.length === 1 ? "" : "es"} as ${label}…`, false);

  try {
    await postReceivingStatusToSheet(getWebhookUrl(), { status, date, initials, barcodes });

    // Success — mirror the same update locally instead of waiting on a
    // fresh GET, so the list reflects it immediately.
    const master = loadJSON(STORAGE.receivingMaster, []);
    for (const barcode of barcodes) {
      const idx = master.findIndex((p) => p.barcode === barcode);
      if (idx === -1) continue;
      if (status === "mao") {
        master[idx].receivedIntoMaoDate = date;
        master[idx].receivedIntoMaoBy = initials;
      } else {
        master[idx].physicallyReceivedDate = date;
        master[idx].physicallyReceivedBy = initials;
      }
    }
    saveJSON(STORAGE.receivingMaster, master);
    saveReceivingHolding([]);

    renderReceivingList();
    renderReceivingHolding();
    setStatus("receiving-status-msg", `Marked ${barcodes.length} box${barcodes.length === 1 ? "" : "es"} as ${label}.`, false);
  } catch (e) {
    setStatus(
      "receiving-status-msg",
      "Couldn't reach the sheet — check your connection and try again. Boxes stay in the holding list.",
      true
    );
  }
}

/* ---------- Expected Boxes list ---------- */

function renderReceivingList() {
  const tbody = document.getElementById("receiving-table-body");
  const master = loadJSON(STORAGE.receivingMaster, []);
  const filterVal = normalize(document.getElementById("receiving-filter").value);

  // A box disappears once it's been received into MAO — that's the end of
  // its lifecycle here. Anything currently held is shown in the holding
  // table instead, not duplicated in this list.
  const maoCount = master.filter((item) => item.receivedIntoMaoDate).length;
  const remaining = master.filter((item) => !item.receivedIntoMaoDate && !isHeld(item.barcode));

  const filtered = remaining.filter(
    (item) =>
      !filterVal || normalize(item.po).includes(filterVal) || normalize(item.barcode).includes(filterVal)
  );

  const heldCount = master.length - remaining.length - maoCount;
  document.getElementById("receiving-count").textContent =
    `${filtered.length} of ${remaining.length} remaining` +
    (heldCount > 0 ? ` · ${heldCount} in holding` : "") +
    (maoCount > 0 ? ` · ${maoCount} received into MAO` : "");

  tbody.innerHTML = "";

  document.getElementById("receiving-select-all").checked = false;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="no-results">${
      master.length === 0
        ? "No expected shipments yet — paste the MAO list above."
        : remaining.length === 0
        ? "All boxes received into MAO — nothing left."
        : "No boxes match that filter."
    }</td></tr>`;
    return;
  }

  const sorted = filtered.slice().sort((a, b) => a.po.localeCompare(b.po) || a.barcode.localeCompare(b.barcode));

  for (const item of sorted) {
    const tr = document.createElement("tr");
    const status = item.physicallyReceivedDate
      ? `On shelf · ${escapeHtml(item.physicallyReceivedBy || "—")} ${escapeHtml(item.physicallyReceivedDate)}`
      : "Not yet received";
    tr.innerHTML = `
      <td><input type="checkbox" class="receiving-select-checkbox" data-barcode="${escapeHtml(item.barcode)}" aria-label="Select ${escapeHtml(item.barcode)}"></td>
      <td class="mono">${escapeHtml(item.barcode)}</td>
      <td>${escapeHtml(item.po)}</td>
      <td>${escapeHtml(item.expectedDate)}</td>
      <td>${status}</td>
    `;
    tbody.appendChild(tr);
  }
}

function exportReceivingCsv() {
  const master = loadJSON(STORAGE.receivingMaster, []);
  const header = [
    "barcode",
    "po",
    "expectedDate",
    "physicallyReceivedDate",
    "physicallyReceivedBy",
    "receivedIntoMaoDate",
    "receivedIntoMaoBy",
  ];
  const rows = [header, ...master.map((item) => header.map((k) => item[k]))];
  downloadCsv(`receiving-log-${todayISO()}.csv`, rows);
}
