"use strict";

let consolAdjustItem = null;
let consolAdjustVariants = [];
// Staged size/unit rows for the current "Needs Adjustment" modal session —
// more than one size of a style can be short, so the modal collects
// several before Save submits all of them together.
let consolAdjustRows = [];

function initConsol() {
  document.getElementById("consol-refresh-btn").addEventListener("click", async () => {
    setStatus("consol-list-status", "Refreshing from the sheet…", false);
    await Promise.all([loadSharedConsolMaster(), loadSharedConsolLog()]);
    renderConsolList();
    renderConsolLog();
    setStatus("consol-list-status", "Refreshed from the sheet.", false);
  });

  document.getElementById("consol-filter").addEventListener("input", renderConsolList);

  document.getElementById("scan-close-box-btn").addEventListener("click", () => {
    openScanner("Scanning packing slip…", handleBoxCloseScan);
  });

  document.getElementById("consol-adjust-add-row-btn").addEventListener("click", addConsolAdjustRow);
  document.getElementById("consol-adjust-save-btn").addEventListener("click", saveConsolAdjustModal);
  document.getElementById("consol-adjust-cancel-btn").addEventListener("click", closeConsolAdjustModal);

  document.getElementById("consol-update-btn").addEventListener("click", commitConsolUpdate);

  document.getElementById("export-consol-csv-btn").addEventListener("click", exportConsolCsv);

  renderConsolList();
  renderConsolHolding();
  renderConsolLog();
}

/* ---------- Holding (staged Actioned/Needs Adjustment decisions) ----------
   Same pattern as Check Floor/Replen: nothing hits the sheet until Update
   commits everything staged in one request. Closing a box is a completely
   separate action now (see handleBoxCloseScan below) — it doesn't touch
   this holding area or ConsolMaster at all. */

function loadConsolHolding() {
  return loadJSON(STORAGE.consolHolding, []);
}

function saveConsolHolding(holding) {
  saveJSON(STORAGE.consolHolding, holding);
}

function isConsolHeld(eccMaterial) {
  return loadConsolHolding().some((h) => h.eccMaterial === eccMaterial);
}

function stageConsolDecision(decision) {
  const holding = loadConsolHolding();
  if (holding.some((h) => h.eccMaterial === decision.eccMaterial)) return;
  holding.push(decision);
  saveConsolHolding(holding);
  renderConsolHolding();
}

function removeConsolHolding(eccMaterial) {
  saveConsolHolding(loadConsolHolding().filter((h) => h.eccMaterial !== eccMaterial));
  renderConsolList();
  renderConsolHolding();
}

function renderConsolHolding() {
  const tbody = document.getElementById("consol-holding-table-body");
  const wrap = document.getElementById("consol-holding-table-wrap");
  const emptyMsg = document.getElementById("consol-holding-empty");
  const holding = loadConsolHolding();

  document.getElementById("consol-holding-count").textContent = holding.length ? `${holding.length} staged` : "";
  document.getElementById("consol-update-btn").disabled = holding.length === 0;

  if (holding.length === 0) {
    emptyMsg.hidden = false;
    wrap.hidden = true;
    return;
  }
  emptyMsg.hidden = true;
  wrap.hidden = false;

  tbody.innerHTML = "";
  for (const h of holding) {
    const sizesText = h.status === "Needs Adjustment" ? h.items.map((i) => `${i.size} ×${i.units}`).join(", ") : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(h.description)} — ${escapeHtml(h.color)}</td>
      <td>${escapeHtml(h.status)}</td>
      <td>${escapeHtml(sizesText)}</td>
      <td><button class="btn secondary small consol-holding-remove-btn" data-ecc="${escapeHtml(h.eccMaterial)}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".consol-holding-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeConsolHolding(btn.dataset.ecc));
  });
}

/* ---------- Items to Consolidate ---------- */

function renderConsolList() {
  const tbody = document.getElementById("consol-table-body");
  const master = loadJSON(STORAGE.consolMaster, []);
  const filterVal = normalize(document.getElementById("consol-filter").value);

  // ConsolMaster's own PROCESSED column is the source of truth for "done" —
  // set server-side once a staged decision actually commits via Update.
  // Anything currently staged in Holding is also hidden here (it's showing
  // there instead) until it's actually processed.
  const processedCount = master.filter(isConsolProcessed).length;

  const remaining = master.filter((item) => !isConsolProcessed(item) && !isConsolHeld(item.eccMaterial));

  const filtered = remaining.filter(
    (item) =>
      !filterVal ||
      normalize(item.description).includes(filterVal) ||
      normalize(item.color).includes(filterVal) ||
      normalize(item.eccMaterial).includes(filterVal) ||
      normalize(item.destination).includes(filterVal)
  );

  const heldCount = master.length - remaining.length - processedCount;
  document.getElementById("consol-count").textContent =
    `${filtered.length} of ${remaining.length} remaining` +
    (heldCount > 0 ? ` · ${heldCount} in holding` : "") +
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
          <option value="Actioned">Actioned</option>
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
    return; // staging happens once the modal is saved
  }

  // Actioned — stage it into Holding, same as everything else; nothing
  // hits the sheet until Update.
  stageConsolDecision({ eccMaterial: item.eccMaterial, description: item.description, color: item.color, status: "Actioned" });
  renderConsolList();
}

/* ---------- Needs Adjustment: cross-reference Product Master by style ---------- */

function openConsolAdjustModal(item) {
  consolAdjustItem = item;
  consolAdjustRows = [];
  const master = loadJSON(STORAGE.master, []);
  consolAdjustVariants = master.filter((p) => item.styleSku && p.style === item.styleSku);

  document.getElementById("consol-adjust-label").textContent = `${item.description} — ${item.color}`;

  const select = document.getElementById("consol-adjust-variant");
  const addBtn = document.getElementById("consol-adjust-add-row-btn");

  if (consolAdjustVariants.length === 0) {
    select.innerHTML = `<option value="">No sizes found for style ${escapeHtml(item.styleSku || "—")}</option>`;
    select.disabled = true;
    addBtn.disabled = true;
  } else {
    select.innerHTML = consolAdjustVariants
      .map((v) => `<option value="${escapeHtml(v.upc)}">${escapeHtml(v.color)} — ${escapeHtml(v.size)}</option>`)
      .join("");
    select.disabled = false;
    addBtn.disabled = false;
  }

  document.getElementById("consol-adjust-units").value = "";
  renderConsolAdjustRows();
  document.getElementById("consol-adjust-modal").hidden = false;
}

function closeConsolAdjustModal() {
  consolAdjustItem = null;
  consolAdjustVariants = [];
  consolAdjustRows = [];
  document.getElementById("consol-adjust-modal").hidden = true;
  renderConsolList(); // dropdown falls back to "Not actioned" since nothing changed
}

function addConsolAdjustRow() {
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
  if (consolAdjustRows.some((r) => r.upc === variant.upc)) {
    alert("That size is already added — remove it below first if you need to change the units.");
    return;
  }

  consolAdjustRows.push({
    upc: variant.upc,
    size: variant.size,
    color: variant.color,
    units,
    productDescription: combinedDescription(variant),
  });

  document.getElementById("consol-adjust-units").value = "";
  renderConsolAdjustRows();
}

function removeConsolAdjustRow(upc) {
  consolAdjustRows = consolAdjustRows.filter((r) => r.upc !== upc);
  renderConsolAdjustRows();
}

function renderConsolAdjustRows() {
  const wrap = document.getElementById("consol-adjust-rows");
  const saveBtn = document.getElementById("consol-adjust-save-btn");

  if (consolAdjustRows.length === 0) {
    wrap.innerHTML = `<p class="hint">No sizes added yet — pick one above and tap + Add Size.</p>`;
    saveBtn.disabled = true;
    return;
  }

  wrap.innerHTML = consolAdjustRows
    .map(
      (r) => `
      <div class="consol-adjust-row">
        <span>${escapeHtml(r.color)} — ${escapeHtml(r.size)} × ${r.units}</span>
        <button type="button" class="btn secondary small consol-adjust-row-remove" data-upc="${escapeHtml(r.upc)}">Remove</button>
      </div>
    `
    )
    .join("");
  saveBtn.disabled = false;

  wrap.querySelectorAll(".consol-adjust-row-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeConsolAdjustRow(btn.dataset.upc));
  });
}

function saveConsolAdjustModal() {
  if (!consolAdjustItem || consolAdjustRows.length === 0) return;

  stageConsolDecision({
    eccMaterial: consolAdjustItem.eccMaterial,
    description: consolAdjustItem.description,
    color: consolAdjustItem.color,
    status: "Needs Adjustment",
    items: consolAdjustRows.map((r) => ({ upc: r.upc, size: r.size, units: r.units, productDescription: r.productDescription })),
  });

  consolAdjustItem = null;
  consolAdjustVariants = [];
  consolAdjustRows = [];
  document.getElementById("consol-adjust-modal").hidden = true;

  renderConsolList();
}

/* ---------- Update: commit every staged Holding decision in one request ---------- */

async function commitConsolUpdate() {
  const holding = loadConsolHolding();
  if (holding.length === 0) return;

  if (!navigator.onLine) {
    setStatus("consol-list-status", "Offline — nothing was updated. Try again once you have a connection.", true);
    return;
  }

  const session = loadJSON(STORAGE.session, {});
  const initials = (session.initials || "").trim();
  const date = todayISO();
  const nowIso = new Date().toISOString();

  setStatus("consol-list-status", `Updating ${holding.length} item${holding.length === 1 ? "" : "s"}…`, false);

  try {
    await postConsolUpdate(getWebhookUrl(), {
      initials,
      date,
      decisions: holding.map((h) => ({
        eccMaterial: h.eccMaterial,
        description: h.description,
        color: h.color,
        status: h.status,
        items: h.status === "Needs Adjustment" ? h.items : undefined,
      })),
    });

    // Mirror the same effects locally instead of waiting on a fresh GET:
    // flag every held item Processed and record its ConsolLog entry (or
    // entries — one per size for Needs Adjustment).
    const master = loadJSON(STORAGE.consolMaster, []);
    const log = loadJSON(STORAGE.consolLog, []);

    for (const h of holding) {
      const idx = master.findIndex((p) => p.eccMaterial === h.eccMaterial);
      if (idx !== -1) master[idx].processed = "Processed";

      if (h.status === "Actioned") {
        log.unshift({
          id: uid(),
          entryType: "status",
          timestamp: nowIso,
          date,
          initials,
          eccMaterial: h.eccMaterial,
          description: h.description,
          color: h.color,
          status: "Actioned",
          size: "",
          unitsOut: 0,
          referenceNumber: "",
          synced: true,
        });
      } else {
        for (const it of h.items) {
          log.unshift({
            id: uid(),
            entryType: "status",
            timestamp: nowIso,
            date,
            initials,
            eccMaterial: h.eccMaterial,
            description: h.description,
            color: h.color,
            status: "Needs Adjustment",
            size: it.size,
            unitsOut: it.units,
            referenceNumber: "",
            synced: true,
          });
        }
      }
    }

    saveJSON(STORAGE.consolMaster, master);
    saveJSON(STORAGE.consolLog, log);
    saveConsolHolding([]);

    renderConsolList();
    renderConsolHolding();
    renderConsolLog();
    setStatus("consol-list-status", `Updated ${holding.length} item${holding.length === 1 ? "" : "s"}.`, false);
  } catch (e) {
    setStatus(
      "consol-list-status",
      "Couldn't reach the sheet — check your connection and try again. Items stay staged.",
      true
    );
  }
}

/* ---------- Packing slip scan: register who closed a box, and when ----------
   Deliberately doesn't know or care what's in the box — the reference
   number alone is enough to look its contents up in MAO, so this is
   completely independent of the Holding/Update flow above. */

async function handleBoxCloseScan(text) {
  if (!navigator.onLine) {
    setStatus("consol-packout-status", "Offline — nothing was logged. Scan again once you're connected.", true);
    return;
  }

  setStatus("consol-packout-status", `Logging box ${text} closed…`, false);

  const session = loadJSON(STORAGE.session, {});
  const date = todayISO();
  const initials = (session.initials || "").trim();

  try {
    await postConsolBoxCloseToSheet(getWebhookUrl(), { referenceNumber: text, date, initials });

    const log = loadJSON(STORAGE.consolLog, []);
    log.unshift({
      id: uid(),
      entryType: "packout",
      timestamp: new Date().toISOString(),
      date,
      initials,
      eccMaterial: "",
      description: "",
      color: "",
      status: "",
      size: "",
      unitsOut: 0,
      referenceNumber: text,
      synced: true,
    });
    saveJSON(STORAGE.consolLog, log);

    renderConsolLog();
    setStatus("consol-packout-status", `Box ${text} closed and logged.`, false);
  } catch (e) {
    setStatus(
      "consol-packout-status",
      `Box ${text}: couldn't reach the sheet — check your connection and scan again.`,
      true
    );
  }
}

/* ---------- Consolidation Log (history) ---------- */

function renderConsolLog() {
  const listEl = document.getElementById("consol-log-list");
  const fullLog = loadJSON(STORAGE.consolLog, []);
  // Resolved entries stay in the sheet/local storage permanently (and in
  // Export CSV) — same as Check Floor/Replen, once actioned they just drop
  // off the everyday view instead of cluttering it forever.
  const log = fullLog.filter((e) => e.status !== "Resolved");
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
        </div>
      `;
    } else {
      const pillClass = e.status === "Actioned" ? "match" : "under";
      const needsAdjustment = e.status === "Needs Adjustment";
      div.innerHTML = `
        <div class="audit-entry-top">
          <span>${escapeHtml(e.eccMaterial)}</span>
          <span class="result-pill ${pillClass}">${escapeHtml(e.status)}</span>
        </div>
        <div class="meta">${escapeHtml(e.description)} — ${escapeHtml(e.color)}</div>
        <div class="meta">
          ${needsAdjustment ? `Size ${escapeHtml(e.size)} · ${e.unitsOut} out · ` : ""}${escapeHtml(
        e.initials || "—"
      )} · ${escapeHtml(e.date)}
        </div>
        ${
          needsAdjustment
            ? `<button class="btn secondary small consol-log-resolve-btn" data-id="${escapeHtml(e.id)}">Resolve</button>`
            : ""
        }
      `;
    }
    listEl.appendChild(div);
  }

  listEl.querySelectorAll(".consol-log-resolve-btn").forEach((btn) => {
    btn.addEventListener("click", () => resolveConsolLogEntry(btn.dataset.id));
  });
}

// Flips one "Needs Adjustment" entry to Resolved server-side and mirrors
// it locally — the underlying row stays in ConsolLog forever (it's a
// permanent history, like AuditLog), this just stops the app from
// treating it as something still needing attention.
async function resolveConsolLogEntry(id) {
  if (!navigator.onLine) {
    setStatus("consol-log-status", "Offline — nothing was updated. Try again once you have a connection.", true);
    return;
  }

  setStatus("consol-log-status", "Resolving…", false);

  try {
    await postConsolLogResolve(getWebhookUrl(), { id });

    const log = loadJSON(STORAGE.consolLog, []);
    const entry = log.find((e) => e.id === id);
    if (entry) entry.status = "Resolved";
    saveJSON(STORAGE.consolLog, log);

    renderConsolLog();
    setStatus("consol-log-status", "Resolved.", false);
  } catch (e) {
    setStatus("consol-log-status", "Couldn't reach the sheet — check your connection and try again.", true);
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
