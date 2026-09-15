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

function renderConsolList() {
  const listEl = document.getElementById("consol-list");
  const master = loadJSON(STORAGE.consolMaster, []);
  const filterVal = normalize(document.getElementById("consol-filter").value);

  const filtered = master.filter(
    (item) =>
      !filterVal ||
      normalize(item.description).includes(filterVal) ||
      normalize(item.color).includes(filterVal) ||
      normalize(item.eccMaterial).includes(filterVal) ||
      normalize(item.destination).includes(filterVal)
  );

  document.getElementById("consol-count").textContent = `${filtered.length} of ${master.length} item(s)`;
  listEl.innerHTML = "";

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="hint">${
      master.length === 0 ? "No consolidation items yet — paste the HQ list above." : "No items match that filter."
    }</p>`;
    return;
  }

  const sorted = filtered
    .slice()
    .sort((a, b) => a.description.localeCompare(b.description) || a.color.localeCompare(b.color));

  for (const item of sorted) {
    const latest = currentConsolStatus(item.eccMaterial);
    const currentStatusValue = latest ? latest.status : "";

    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="sku">${escapeHtml(item.eccMaterial)}</div>
      <h3>${escapeHtml(item.description)}</h3>
      <div class="result-field">
        <div class="label">Colour</div>
        <div class="value">${escapeHtml(item.color)}</div>
      </div>
      <div class="result-field">
        <div class="label">Destination</div>
        <div class="value">${escapeHtml(item.destination)}</div>
      </div>
      <div class="result-field">
        <div class="label">Total</div>
        <div class="value">${escapeHtml(item.total)}</div>
      </div>
      <label>Status
        <select class="consol-status-select" data-ecc="${escapeHtml(item.eccMaterial)}">
          <option value="">Not yet actioned</option>
          <option value="Completed" ${currentStatusValue === "Completed" ? "selected" : ""}>Completed</option>
          <option value="Needs Adjustment" ${currentStatusValue === "Needs Adjustment" ? "selected" : ""}>Needs Adjustment</option>
        </select>
      </label>
      ${
        latest
          ? `<div class="meta">Last: ${escapeHtml(latest.status)} · ${escapeHtml(latest.initials || "—")} · ${escapeHtml(
              latest.date
            )}${
              latest.status === "Needs Adjustment"
                ? ` · size ${escapeHtml(latest.size)} · ${latest.unitsOut} out`
                : ""
            }</div>`
          : ""
      }
    `;
    listEl.appendChild(card);
  }

  listEl.querySelectorAll(".consol-status-select").forEach((sel) => {
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

  if (successCount === unsynced.length) {
    setStatus("consol-sync-status", `Saved ${successCount} entr${successCount === 1 ? "y" : "ies"} to the shared log.`, false);
  } else {
    setStatus("consol-sync-status", `Saved ${successCount} of ${unsynced.length} — check your connection and try Save again.`, true);
  }
}
