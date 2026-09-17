"use strict";

let consolAdjustItem = null;
let consolAdjustVariants = [];

function initConsol() {
  document.getElementById("consol-refresh-btn").addEventListener("click", async () => {
    setStatus("consol-list-status", "Refreshing from the sheet…", false);
    await loadSharedConsolMaster();
    renderConsolList();
    setStatus("consol-list-status", "Refreshed from the sheet.", false);
  });

  document.getElementById("consol-filter").addEventListener("input", renderConsolList);

  document.getElementById("scan-packout-btn").addEventListener("click", () => {
    openScanner("Scanning packing slip…", handlePackoutScan);
  });

  document.getElementById("consol-adjust-save-btn").addEventListener("click", saveConsolAdjustModal);
  document.getElementById("consol-adjust-cancel-btn").addEventListener("click", closeConsolAdjustModal);

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

/* ---------- Items to Consolidate ---------- */

function renderConsolList() {
  const tbody = document.getElementById("consol-table-body");
  const master = loadJSON(STORAGE.consolMaster, []);
  const filterVal = normalize(document.getElementById("consol-filter").value);

  // ConsolMaster's own PROCESSED column is the source of truth for "done" —
  // set server-side when a box closes or an item is marked Needs Adjustment.
  // Anything currently staged in the Packed Box is also hidden here (it's
  // showing there instead) until it's actually processed.
  const processedCount = master.filter(isConsolProcessed).length;

  const remaining = master.filter((item) => !isConsolProcessed(item) && !isBoxed(item.eccMaterial));

  const filtered = remaining.filter(
    (item) =>
      !filterVal ||
      normalize(item.description).includes(filterVal) ||
      normalize(item.color).includes(filterVal) ||
      normalize(item.eccMaterial).includes(filterVal) ||
      normalize(item.destination).includes(filterVal)
  );

  const boxedCount = master.length - remaining.length - processedCount;
  document.getElementById("consol-count").textContent =
    `${filtered.length} of ${remaining.length} remaining` +
    (boxedCount > 0 ? ` · ${boxedCount} in packed box` : "") +
    (processedCount > 0 ? ` · ${processedCount} processed` : "");

  tbody.innerHTML = "";

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="no-results">${
      master.length === 0
        ? "No consolidation items yet — paste the HQ list into the ConsolMaster sheet, then tap Refresh."
        : remaining.length === 0
        ? "All items processed — nothing left to consolidate."
        : "No items match that filter."
    }</td></tr>`;
    return;
  }

  const sorted = filtered
    .slice()
    .sort((a, b) => a.description.localeCompare(b.description) || a.color.localeCompare(b.color));

  for (const item of sorted) {
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
          <option value="Completed">Completed</option>
          <option value="Needs Adjustment">Needs Adjustment</option>
        </select>
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

  if (!status) return; // "Not actioned" is just a view state, nothing to do

  if (status === "Needs Adjustment") {
    openConsolAdjustModal(item);
    return; // logging + push happens once the modal is saved
  }

  // Completed — stage it in the Packed Box instead of processing it right
  // away; it's actually logged and flagged Processed once the box is
  // scanned and closed out.
  addItemToBox(item);
  renderConsolList();
  renderConsolBox();
}

/* ---------- Needs Adjustment: cross-reference Product Master by style ---------- */

function openConsolAdjustModal(item) {
  consolAdjustItem = item;
  const master = loadJSON(STORAGE.master, []);
  consolAdjustVariants = master.filter((p) => item.styleSku && p.style === item.styleSku);

  document.getElementById("consol-adjust-label").textContent = `${item.description} — ${item.color}`;

  const select = document.getElementById("consol-adjust-variant");
  const saveBtn = document.getElementById("consol-adjust-save-btn");

  if (consolAdjustVariants.length === 0) {
    select.innerHTML = `<option value="">No sizes found for style ${escapeHtml(item.styleSku || "—")}</option>`;
    select.disabled = true;
    saveBtn.disabled = true;
  } else {
    select.innerHTML = consolAdjustVariants
      .map((v) => `<option value="${escapeHtml(v.upc)}">${escapeHtml(v.color)} — ${escapeHtml(v.size)}</option>`)
      .join("");
    select.disabled = false;
    saveBtn.disabled = false;
  }

  document.getElementById("consol-adjust-units").value = "";
  document.getElementById("consol-adjust-modal").hidden = false;
}

function closeConsolAdjustModal() {
  consolAdjustItem = null;
  consolAdjustVariants = [];
  document.getElementById("consol-adjust-modal").hidden = true;
  renderConsolList(); // dropdown falls back to "Not actioned" since nothing changed
}

async function saveConsolAdjustModal() {
  if (!consolAdjustItem) return;

  const upc = document.getElementById("consol-adjust-variant").value;
  const unitsRaw = document.getElementById("consol-adjust-units").value;
  const units = parseInt(unitsRaw, 10);

  const variant = consolAdjustVariants.find((v) => String(v.upc) === upc);
  if (!variant) {
    alert("Select a size/colour first.");
    return;
  }
  if (isNaN(units) || units <= 0) {
    alert("Enter a valid number of units to mark out.");
    return;
  }

  if (!navigator.onLine) {
    alert("Offline — can't mark out right now. Try again once you have a connection.");
    return;
  }

  const item = consolAdjustItem;
  const session = loadJSON(STORAGE.session, {});
  const date = todayISO();
  const initials = (session.initials || "").trim();
  const productDescription = combinedDescription(variant);

  setStatus("consol-list-status", `Marking out ${units} × ${variant.upc}…`, false);

  try {
    await postConsolMarkoutToSheet(getWebhookUrl(), {
      date,
      initials,
      eccMaterial: item.eccMaterial,
      description: item.description,
      color: item.color,
      size: variant.size,
      units,
      upc: variant.upc,
      productDescription,
    });

    // Mark it Processed locally so it drops off the list immediately —
    // the server just did the same to the sheet.
    const master = loadJSON(STORAGE.consolMaster, []);
    const idx = master.findIndex((p) => p.eccMaterial === item.eccMaterial);
    if (idx !== -1) {
      master[idx].processed = "Processed";
      saveJSON(STORAGE.consolMaster, master);
    }

    const log = loadJSON(STORAGE.consolLog, []);
    log.unshift({
      id: uid(),
      entryType: "status",
      timestamp: new Date().toISOString(),
      date,
      initials,
      eccMaterial: item.eccMaterial,
      description: item.description,
      color: item.color,
      status: "Needs Adjustment",
      size: variant.size,
      unitsOut: units,
      referenceNumber: "",
      synced: true,
    });
    saveJSON(STORAGE.consolLog, log);

    consolAdjustItem = null;
    consolAdjustVariants = [];
    document.getElementById("consol-adjust-modal").hidden = true;

    renderConsolList();
    renderConsolLog();
    setStatus("consol-list-status", `Marked out ${units} × ${variant.upc} — pushed to the Mark Out queue.`, false);
  } catch (e) {
    setStatus("consol-list-status", "Couldn't reach the sheet — check your connection and try again.", true);
  }
}

/* ---------- Packing slip scan: close the box as a group ---------- */

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

  const session = loadJSON(STORAGE.session, {});
  const date = todayISO();
  const initials = (session.initials || "").trim();

  try {
    await postConsolBoxCloseToSheet(getWebhookUrl(), {
      referenceNumber: text,
      date,
      initials,
      items: box.map((item) => ({ eccMaterial: item.eccMaterial, description: item.description, color: item.color })),
    });

    // Success — mirror the same effects locally: flag every boxed item
    // Processed, record the log entries, and clear the box.
    const master = loadJSON(STORAGE.consolMaster, []);
    for (const boxItem of box) {
      const idx = master.findIndex((p) => p.eccMaterial === boxItem.eccMaterial);
      if (idx !== -1) master[idx].processed = "Processed";
    }
    saveJSON(STORAGE.consolMaster, master);

    const log = loadJSON(STORAGE.consolLog, []);
    const timestamp = new Date().toISOString();
    for (const boxItem of box) {
      log.unshift({
        id: uid(),
        entryType: "status",
        timestamp,
        date,
        initials,
        eccMaterial: boxItem.eccMaterial,
        description: boxItem.description,
        color: boxItem.color,
        status: "Completed",
        size: "",
        unitsOut: 0,
        referenceNumber: text,
        synced: true,
      });
    }
    log.unshift({
      id: uid(),
      entryType: "packout",
      timestamp,
      date,
      initials,
      eccMaterial: "",
      description: "",
      color: "",
      status: "",
      size: "",
      unitsOut: box.length,
      referenceNumber: text,
      synced: true,
    });
    saveJSON(STORAGE.consolLog, log);

    saveConsolBox([]);

    renderConsolLog();
    renderConsolList();
    renderConsolBox();

    setStatus("consol-packout-status", `Box ${text} closed — ${box.length} item${box.length === 1 ? "" : "s"} logged and uploaded.`, false);
  } catch (e) {
    setStatus(
      "consol-packout-status",
      `Box ${text}: couldn't reach the sheet — check your connection. Items stay staged, scan again to retry.`,
      true
    );
  }
}

/* ---------- Consolidation Log (history) ---------- */

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
          ${e.unitsOut} item${e.unitsOut === 1 ? "" : "s"} · ${escapeHtml(e.initials || "—")} · ${escapeHtml(e.date)}
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
  ];
  const rows = [header, ...log.map((e) => header.map((k) => e[k]))];
  downloadCsv(`consolidation-log-${todayISO()}.csv`, rows);
}
