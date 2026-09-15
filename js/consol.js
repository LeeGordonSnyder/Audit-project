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
    for (const item of parsed) {
      try {
        await pushConsolItemToSheet(url, item);
        shared++;
      } catch (e) {
        break; // likely offline — the rest stay local-only until the next import/sync
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
  renderConsolLog();
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

  // Anything actioned AND already uploaded to the sheet is done — drop it
  // from the working list entirely so the list shrinks as the team works
  // through it, instead of growing with dead rows.
  const remaining = master.filter((item) => {
    const latest = currentConsolStatus(item.eccMaterial);
    return !(latest && latest.synced);
  });

  const filtered = remaining.filter(
    (item) =>
      !filterVal ||
      normalize(item.description).includes(filterVal) ||
      normalize(item.color).includes(filterVal) ||
      normalize(item.eccMaterial).includes(filterVal) ||
      normalize(item.destination).includes(filterVal)
  );

  const doneCount = master.length - remaining.length;
  document.getElementById("consol-count").textContent =
    `${filtered.length} of ${remaining.length} remaining` +
    (doneCount > 0 ? ` · ${doneCount} completed & uploaded` : "");

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

  logConsolStatus(item, status, "", 0);
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

function handlePackoutScan(text) {
  const session = loadJSON(STORAGE.session, {});
  const entry = {
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
    unitsOut: 0,
    referenceNumber: text,
    synced: false,
  };

  const log = loadJSON(STORAGE.consolLog, []);
  log.unshift(entry);
  saveJSON(STORAGE.consolLog, log);

  renderConsolLog();
  setStatus("consol-packout-status", `Logged box closed — reference ${text}.`, false);
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

  setStatus("consol-sync-status", `Saving ${unsynced.length} entr${unsynced.length === 1 ? "y" : "ies"}…`, false);

  let successCount = 0;
  for (const entry of unsynced) {
    try {
      await postConsolLogToSheet(url, entry);
      entry.synced = true;
      successCount++;
    } catch (e) {
      break; // likely offline — stop here, leave the rest for next attempt
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
