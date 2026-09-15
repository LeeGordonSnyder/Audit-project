"use strict";

let consolAdjustItem = null;

function initConsol() {
  document.getElementById("consol-import-btn").addEventListener("click", async () => {
    const textarea = document.getElementById("consol-paste-area");
    const parsed = parseConsolPaste(textarea.value);
    if (!parsed.length) {
      setStatus(
        "consol-import-status",
        "No rows found — check it's pasted with Description/Colour/Generic Material/ECC Generic Material/Destination/Total columns.",
        true
      );
      return;
    }

    const result = upsertConsolMaster(parsed);
    textarea.value = "";
    renderConsolList();

    setStatus("consol-import-status", `Added ${result.added}, updated ${result.updated}. Sharing with the sheet…`, false);

    const url = getWebhookUrl();
    let shared = 0;
    if (navigator.onLine) {
      // pushConsolItemToSheet() already retries transient failures internally,
      // so keep going through the rest of the batch rather than stopping at
      // the first one that still fails.
      for (const item of parsed) {
        try {
          await pushConsolItemToSheet(url, item);
          shared++;
        } catch (e) {
          // leave this one local-only, keep going with the rest
        }
      }
    }

    setStatus(
      "consol-import-status",
      shared === parsed.length
        ? `Added ${result.added}, updated ${result.updated}, and shared all ${shared} with the sheet.`
        : `Added ${result.added}, updated ${result.updated} locally. Only shared ${shared} of ${parsed.length} with the sheet — check your connection and import again to finish sharing.`,
      shared !== parsed.length
    );
  });

  document.getElementById("consol-filter").addEventListener("input", renderConsolList);

  document.getElementById("scan-packout-btn").addEventListener("click", () => {
    openScanner("Scanning packing slip…", handlePackoutScan);
  });

  document.getElementById("consol-adjust-save-btn").addEventListener("click", saveConsolAdjustModal);
  document.getElementById("consol-adjust-cancel-btn").addEventListener("click", closeConsolAdjustModal);

  document.getElementById("save-consol-btn").addEventListener("click", syncConsolData);
  document.getElementById("export-consol-csv-btn").addEventListener("click", exportConsolCsv);

  renderConsolList();
  renderConsolBox();
  renderConsolLog();
}

/* ---------- Packed Box (local staging before a packing-slip scan) ---------- */

function loadConsolBox() {
  return loadJSON(STORAGE.consolBox, []);
}

function saveConsolBox(box) {
  saveJSON(STORAGE.consolBox, box);
}

function isBoxed(eccMaterial) {
  return loadConsolBox().some((b) => b.eccMaterial === eccMaterial);
}

function addItemToBox(item) {
  const box = loadConsolBox();
  if (box.some((b) => b.eccMaterial === item.eccMaterial)) return;
  box.push({
    eccMaterial: item.eccMaterial,
    description: item.description,
    color: item.color,
    destination: item.destination,
    total: item.total,
  });
  saveConsolBox(box);
}

function removeItemFromBox(eccMaterial) {
  saveConsolBox(loadConsolBox().filter((b) => b.eccMaterial !== eccMaterial));
  renderConsolList();
  renderConsolBox();
}

function renderConsolBox() {
  const tbody = document.getElementById("consol-box-table-body");
  const wrap = document.getElementById("consol-box-table-wrap");
  const emptyMsg = document.getElementById("consol-box-empty");
  const scanBtn = document.getElementById("scan-packout-btn");
  const box = loadConsolBox();

  document.getElementById("consol-box-count").textContent = box.length
    ? `${box.length} item${box.length === 1 ? "" : "s"} staged`
    : "";

  if (box.length === 0) {
    emptyMsg.hidden = false;
    wrap.hidden = true;
    scanBtn.disabled = true;
    return;
  }

  emptyMsg.hidden = true;
  wrap.hidden = false;
  scanBtn.disabled = false;

  tbody.innerHTML = "";
  for (const item of box) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.color)}</td>
      <td class="num">${item.total}</td>
      <td><button class="btn secondary small consol-box-remove-btn" data-ecc="${escapeHtml(item.eccMaterial)}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".consol-box-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeItemFromBox(btn.dataset.ecc));
  });
}

// Most recent logged status entry for a given item, or null if never actioned.
function currentConsolStatus(eccMaterial) {
  const log = loadJSON(STORAGE.consolLog, []);
  const entries = log.filter((e) => e.entryType === "status" && e.eccMaterial === eccMaterial);
  if (!entries.length) return null;
  entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return entries[0];
}

// A short "Completed · JD · 2026-09-15" (or size/units, or "not synced") line
// shown under the status dropdown for anything already actioned.
function statusHint(latest) {
  if (!latest) return "";
  const parts = [latest.status];
  if (latest.status === "Needs Adjustment") parts.push(`Sz ${latest.size} × ${latest.unitsOut}`);
  parts.push(latest.initials || "—", latest.date);
  if (!latest.synced) parts.push("not synced yet");
  return parts.filter(Boolean).join(" · ");
}

function renderConsolList() {
  const tbody = document.getElementById("consol-table-body");
  const master = loadJSON(STORAGE.consolMaster, []);
  const filterVal = normalize(document.getElementById("consol-filter").value);

  // Drop anything already synced-and-done, or currently staged in the
  // Packed Box, from the working list — so it shrinks as the team works
  // through it instead of accumulating dead rows.
  const syncedDoneCount = master.filter((item) => {
    const latest = currentConsolStatus(item.eccMaterial);
    return latest && latest.synced;
  }).length;

  const remaining = master.filter((item) => {
    const latest = currentConsolStatus(item.eccMaterial);
    if (latest && latest.synced) return false;
    if (isBoxed(item.eccMaterial)) return false;
    return true;
  });

  const filtered = remaining.filter(
    (item) =>
      !filterVal ||
      normalize(item.description).includes(filterVal) ||
      normalize(item.color).includes(filterVal) ||
      normalize(item.eccMaterial).includes(filterVal) ||
      normalize(item.destination).includes(filterVal)
  );

  const boxedCount = master.length - remaining.length - syncedDoneCount;
  document.getElementById("consol-count").textContent =
    `${filtered.length} of ${remaining.length} remaining` +
    (boxedCount > 0 ? ` · ${boxedCount} in packed box` : "") +
    (syncedDoneCount > 0 ? ` · ${syncedDoneCount} completed & uploaded` : "");

  tbody.innerHTML = "";

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="no-results">${
      master.length === 0
        ? "No consolidation items yet — paste the HQ list above."
        : remaining.length === 0
        ? "All items actioned and uploaded — nothing left to consolidate."
        : "No items match that filter."
    }</td></tr>`;
    return;
  }

  const sorted = filtered
    .slice()
    .sort((a, b) => a.description.localeCompare(b.description) || a.color.localeCompare(b.color));

  for (const item of sorted) {
    const latest = currentConsolStatus(item.eccMaterial);
    const currentStatusValue = latest ? latest.status : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.color)}</td>
      <td>${escapeHtml(item.destination)}</td>
      <td class="num">${item.total}</td>
      <td>
        <select class="consol-status-select" data-ecc="${escapeHtml(item.eccMaterial)}" aria-label="Status for ${escapeHtml(
      item.description
    )}">
          <option value="">Not actioned</option>
          <option value="Completed" ${currentStatusValue === "Completed" ? "selected" : ""}>Completed</option>
          <option value="Needs Adjustment" ${currentStatusValue === "Needs Adjustment" ? "selected" : ""}>Needs Adjustment</option>
        </select>
        ${latest ? `<div class="row-hint">${escapeHtml(statusHint(latest))}</div>` : ""}
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".consol-status-select").forEach((sel) => {
    sel.addEventListener("change", () => handleConsolStatusChange(sel));
  });
}

function handleConsolStatusChange(sel) {
  const eccMaterial = sel.dataset.ecc;
  const status = sel.value;
  const master = loadJSON(STORAGE.consolMaster, []);
  const item = master.find((p) => p.eccMaterial === eccMaterial);
  if (!item) return;

  if (!status) return; // "Not yet actioned" is just a view state, nothing to log

  if (status === "Needs Adjustment") {
    openConsolAdjustModal(item);
    return; // logging happens once the modal is saved
  }

  // Completed — stage it in the Packed Box instead of logging right away;
  // it's actually logged (with the packing slip's reference number) once
  // the box is scanned and closed out.
  addItemToBox(item);
  renderConsolList();
  renderConsolBox();
}

function openConsolAdjustModal(item) {
  consolAdjustItem = item;
  document.getElementById("consol-adjust-label").textContent = `${item.description} — ${item.color}`;
  document.getElementById("consol-adjust-size").value = "";
  document.getElementById("consol-adjust-units").value = "";
  document.getElementById("consol-adjust-modal").hidden = false;
  document.getElementById("consol-adjust-size").focus();
}

function closeConsolAdjustModal() {
  consolAdjustItem = null;
  document.getElementById("consol-adjust-modal").hidden = true;
  // Re-render so the dropdown falls back to its last actual logged status.
  renderConsolList();
}

function saveConsolAdjustModal() {
  if (!consolAdjustItem) return;

  const size = document.getElementById("consol-adjust-size").value.trim();
  const unitsRaw = document.getElementById("consol-adjust-units").value;
  const units = parseInt(unitsRaw, 10);

  if (!size) {
    alert("Enter the size.");
    return;
  }
  if (isNaN(units) || units <= 0) {
    alert("Enter a valid number of units to mark out.");
    return;
  }

  const item = consolAdjustItem;
  consolAdjustItem = null;
  document.getElementById("consol-adjust-modal").hidden = true;
  logConsolStatus(item, "Needs Adjustment", size, units);
}

function logConsolStatus(item, status, size, unitsOut) {
  const session = loadJSON(STORAGE.session, {});
  const entry = {
    id: uid(),
    entryType: "status",
    timestamp: new Date().toISOString(),
    date: session.date || todayISO(),
    initials: (session.initials || "").trim(),
    eccMaterial: item.eccMaterial,
    description: item.description,
    color: item.color,
    status,
    size,
    unitsOut,
    referenceNumber: "",
    synced: false,
  };

  const log = loadJSON(STORAGE.consolLog, []);
  log.unshift(entry);
  saveJSON(STORAGE.consolLog, log);

  renderConsolList();
  renderConsolLog();
}

async function handlePackoutScan(text) {
  const box = loadConsolBox();
  if (box.length === 0) {
    setStatus("consol-packout-status", "Nothing staged in the box yet — mark items Completed above first.", true);
    return;
  }

  if (!navigator.onLine) {
    setStatus("consol-packout-status", "Offline — nothing was logged. Items stay in the box, try scanning again once you're connected.", true);
    return;
  }

  setStatus("consol-packout-status", `Logging ${box.length} item${box.length === 1 ? "" : "s"} for box ${text}…`, false);

  const url = getWebhookUrl();
  const session = loadJSON(STORAGE.session, {});
  const log = loadJSON(STORAGE.consolLog, []);
  const stillBoxed = [];
  let successCount = 0;

  // Each item is only ever added to the log once its POST actually
  // succeeds — a failure just leaves it staged in the box for a retry
  // (re-scan), rather than creating an unsynced log entry that would also
  // need separate tracking to get out of the box.
  for (const item of box) {
    const entry = {
      id: uid(),
      entryType: "status",
      timestamp: new Date().toISOString(),
      date: session.date || todayISO(),
      initials: (session.initials || "").trim(),
      eccMaterial: item.eccMaterial,
      description: item.description,
      color: item.color,
      status: "Completed",
      size: "",
      unitsOut: 0,
      referenceNumber: text,
      synced: true,
    };

    try {
      await postConsolLogToSheet(url, entry);
      log.unshift(entry);
      successCount++;
    } catch (e) {
      stillBoxed.push(item);
    }
  }

  if (successCount > 0) {
    const packoutEntry = {
      id: uid(),
      entryType: "packout",
      timestamp: new Date().toISOString(),
      date: session.date || todayISO(),
      initials: (session.initials || "").trim(),
      eccMaterial: "",
      description: "",
      color: "",
      status: "",
      size: "",
      unitsOut: successCount,
      referenceNumber: text,
      synced: true,
    };
    try {
      await postConsolLogToSheet(url, packoutEntry);
      log.unshift(packoutEntry);
    } catch (e) {
      // The box's items are already logged — just note the closure record itself didn't upload.
    }
  }

  saveJSON(STORAGE.consolLog, log);
  saveConsolBox(stillBoxed);

  renderConsolLog();
  renderConsolList();
  renderConsolBox();

  if (stillBoxed.length === 0) {
    setStatus("consol-packout-status", `Box ${text} closed — ${successCount} item${successCount === 1 ? "" : "s"} logged and uploaded.`, false);
  } else {
    setStatus(
      "consol-packout-status",
      `Box ${text}: ${successCount} of ${box.length} uploaded. ${stillBoxed.length} couldn't sync (check your connection) — still staged, scan again to retry.`,
      true
    );
  }
}

function renderConsolLog() {
  const listEl = document.getElementById("consol-log-list");
  const log = loadJSON(STORAGE.consolLog, []);
  listEl.innerHTML = "";

  if (log.length === 0) {
    listEl.innerHTML = `<p class="hint">No consolidation activity logged yet.</p>`;
    return;
  }

  for (const e of log.slice(0, 50)) {
    const div = document.createElement("div");
    div.className = "audit-entry";

    if (e.entryType === "packout") {
      div.innerHTML = `
        <div class="audit-entry-top">
          <span>📦 Box Closed</span>
          <span class="result-pill match">${escapeHtml(e.referenceNumber)}</span>
        </div>
        <div class="meta">
          ${escapeHtml(e.initials || "—")} · ${escapeHtml(e.date)}
          · <span class="sync-pill">${e.synced ? "synced" : "not synced"}</span>
        </div>
      `;
    } else {
      const pillClass = e.status === "Completed" ? "match" : "under";
      div.innerHTML = `
        <div class="audit-entry-top">
          <span>${escapeHtml(e.eccMaterial)}</span>
          <span class="result-pill ${pillClass}">${escapeHtml(e.status)}</span>
        </div>
        <div class="meta">${escapeHtml(e.description)} — ${escapeHtml(e.color)}</div>
        <div class="meta">
          ${e.status === "Needs Adjustment" ? `Size ${escapeHtml(e.size)} · ${e.unitsOut} out · ` : ""}${escapeHtml(
        e.initials || "—"
      )} · ${escapeHtml(e.date)}
          · <span class="sync-pill">${e.synced ? "synced" : "not synced"}</span>
        </div>
      `;
    }
    listEl.appendChild(div);
  }
}

function exportConsolCsv() {
  const log = loadJSON(STORAGE.consolLog, []);
  const header = [
    "date",
    "initials",
    "entryType",
    "eccMaterial",
    "description",
    "color",
    "status",
    "size",
    "unitsOut",
    "referenceNumber",
    "timestamp",
    "synced",
  ];
  const rows = [header, ...log.map((e) => header.map((k) => e[k]))];
  downloadCsv(`consolidation-log-${todayISO()}.csv`, rows);
}

async function syncConsolData() {
  const url = getWebhookUrl();

  const log = loadJSON(STORAGE.consolLog, []);
  const unsynced = log.filter((e) => !e.synced);
  if (unsynced.length === 0) {
    setStatus("consol-sync-status", "Nothing new to save — everything is already in the shared log.", false);
    return;
  }

  if (!navigator.onLine) {
    setStatus("consol-sync-status", "Offline — nothing was saved. Try again once you have a connection.", true);
    return;
  }

  setStatus("consol-sync-status", `Saving ${unsynced.length} entr${unsynced.length === 1 ? "y" : "ies"}…`, false);

  // postConsolLogToSheet() already retries transient failures internally,
  // so keep going through the rest of the batch rather than stopping at
  // the first one that still fails.
  let successCount = 0;
  for (const entry of unsynced) {
    try {
      await postConsolLogToSheet(url, entry);
      entry.synced = true;
      successCount++;
    } catch (e) {
      // leave this one unsynced for next attempt, keep going with the rest
    }
  }

  saveJSON(STORAGE.consolLog, log);
  renderConsolLog();
  renderConsolList(); // drop any items that just became synced-and-done from the working list

  if (successCount === unsynced.length) {
    setStatus("consol-sync-status", `Saved ${successCount} entr${successCount === 1 ? "y" : "ies"} to the shared log.`, false);
  } else {
    setStatus("consol-sync-status", `Saved ${successCount} of ${unsynced.length} — check your connection and try Save again.`, true);
  }
}
