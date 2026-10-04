"use strict";

// Coalesces rapid-fire Actual Count taps per ECC Material: if a sync is
// already in flight when another tap comes in, that tap just updates
// pendingValue instead of firing a second overlapping request — the
// in-flight request's own loop picks up the latest value once it finishes,
// so taps during a slow connection never pile up or land out of order.
const consolCountSyncState = {}; // eccMaterial -> { inFlight, pendingValue }

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

  document.getElementById("consol-update-btn").addEventListener("click", commitConsolUpdate);

  document.getElementById("export-consol-csv-btn").addEventListener("click", exportConsolCsv);

  renderConsolList();
  renderConsolHolding();
  renderConsolLog();
}

/* ---------- Holding (staged Actioned decisions) ----------
   Same pattern as Check Floor/Replen: nothing hits the sheet until Update
   commits everything staged in one request. Closing a box is a completely
   separate action now (see handleBoxCloseScan below) — it doesn't touch
   this holding area or ConsolMaster at all. Actual Count (below) is a
   third, independent thing again — it never stages here, it pushes on
   every tap. */

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
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(h.description)} — ${escapeHtml(h.color)}</td>
      <td>${escapeHtml(h.status)}</td>
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
      normalize(item.styleSku).includes(filterVal) ||
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
    tbody.innerHTML = `<tr><td colspan="7" class="no-results">${
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
    const actualCount = getConsolActualCount(item.eccMaterial);
    const complete = item.total > 0 && actualCount >= item.total;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.styleSku)}</td>
      <td>${escapeHtml(item.color)}</td>
      <td>${escapeHtml(item.destination)}</td>
      <td>
        <div class="consol-count-stepper${complete ? " consol-count-complete" : ""}">
          <button type="button" class="btn secondary small consol-count-minus" data-ecc="${escapeHtml(item.eccMaterial)}" aria-label="Decrease actual count">−</button>
          <input type="number" inputmode="numeric" min="0" class="consol-count-input" data-ecc="${escapeHtml(item.eccMaterial)}" value="${actualCount}" aria-label="Actual count for ${escapeHtml(item.description)}">
          <button type="button" class="btn secondary small consol-count-plus" data-ecc="${escapeHtml(item.eccMaterial)}" aria-label="Increase actual count">+</button>
        </div>
      </td>
      <td class="num">${item.total}</td>
      <td>
        <select class="consol-status-select" data-ecc="${escapeHtml(item.eccMaterial)}" aria-label="Status for ${escapeHtml(
      item.description
    )}">
          <option value="">Not actioned</option>
          <option value="Actioned">Actioned</option>
        </select>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".consol-status-select").forEach((sel) => {
    sel.addEventListener("change", () => handleConsolStatusChange(sel));
  });

  tbody.querySelectorAll(".consol-count-minus").forEach((btn) => {
    btn.addEventListener("click", () => adjustConsolActualCount(btn.dataset.ecc, -1));
  });
  tbody.querySelectorAll(".consol-count-plus").forEach((btn) => {
    btn.addEventListener("click", () => adjustConsolActualCount(btn.dataset.ecc, 1));
  });
  tbody.querySelectorAll(".consol-count-input").forEach((input) => {
    input.addEventListener("change", () => commitConsolActualCountInput(input.dataset.ecc, input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur(); // triggers the change handler above
    });
  });
}

function handleConsolStatusChange(sel) {
  const eccMaterial = sel.dataset.ecc;
  const status = sel.value;
  const master = loadJSON(STORAGE.consolMaster, []);
  const item = master.find((p) => p.eccMaterial === eccMaterial);
  if (!item) return;

  if (!status) return; // "Not actioned" is just a view state, nothing to do

  // Actioned — stage it into Holding, same as everything else; nothing
  // hits the sheet until Update.
  stageConsolDecision({ eccMaterial: item.eccMaterial, description: item.description, color: item.color, status: "Actioned" });
  renderConsolList();
}

/* ---------- Actual Count: the one field on this page that's never staged ----------
   Every other decision here (Actioned) goes through Holding/Update like
   the rest of the app. Actual Count deliberately doesn't -- it's how staff
   track what's physically been pulled against a line's Total *while*
   they're standing there pulling it, so every tap of -/+ (or a typed
   value) pushes immediately and acts as its own "Update." See
   handleConsolCountUpdate in Code.gs: a repeat push overwrites the same
   ConsolLog row (entryType "count", one per ECC Material) in place instead
   of appending a new history row per tap. */

function getConsolActualCount(eccMaterial) {
  const log = loadJSON(STORAGE.consolLog, []);
  const entry = log.find((e) => e.entryType === "count" && e.eccMaterial === eccMaterial);
  return entry ? Number(entry.actualCount) || 0 : 0;
}

function setConsolActualCountLocal(item, value) {
  const log = loadJSON(STORAGE.consolLog, []);
  let entry = log.find((e) => e.entryType === "count" && e.eccMaterial === item.eccMaterial);
  if (!entry) {
    entry = {
      id: "count-" + item.eccMaterial,
      entryType: "count",
      timestamp: new Date().toISOString(),
      date: todayISO(),
      initials: "",
      eccMaterial: item.eccMaterial,
      description: item.description,
      color: item.color,
      status: "",
      size: "",
      actualCount: 0,
      referenceNumber: "",
      synced: false,
    };
    log.unshift(entry);
  }
  entry.actualCount = value;
  entry.timestamp = new Date().toISOString();
  saveJSON(STORAGE.consolLog, log);
}

function adjustConsolActualCount(eccMaterial, delta) {
  const master = loadJSON(STORAGE.consolMaster, []);
  const item = master.find((p) => p.eccMaterial === eccMaterial);
  if (!item) return;
  const next = Math.max(0, getConsolActualCount(eccMaterial) + delta);
  setConsolActualCountLocal(item, next);
  renderConsolList();
  syncConsolActualCount(item);
}

function commitConsolActualCountInput(eccMaterial, inputEl) {
  const master = loadJSON(STORAGE.consolMaster, []);
  const item = master.find((p) => p.eccMaterial === eccMaterial);
  if (!item) return;
  const parsed = parseInt(inputEl.value, 10);
  const next = isNaN(parsed) || parsed < 0 ? 0 : parsed;
  setConsolActualCountLocal(item, next);
  renderConsolList();
  syncConsolActualCount(item);
}

// Pushes the current Actual Count to the sheet immediately, coalescing
// rapid taps: if a push is already in flight for this item, this just
// records the latest value for that in-flight push to pick up next,
// rather than firing a second overlapping request. postConsolCountUpdate
// (via postToSheet) already retries transient failures on its own; a
// request that fails outright is simply picked up again by the next tap,
// since every push sends the current absolute count, not a delta.
async function syncConsolActualCount(item) {
  const state = consolCountSyncState[item.eccMaterial] || (consolCountSyncState[item.eccMaterial] = { inFlight: false, pendingValue: null });
  state.pendingValue = getConsolActualCount(item.eccMaterial);
  if (state.inFlight) return;

  state.inFlight = true;
  const session = loadJSON(STORAGE.session, {});
  const initials = (session.initials || "").trim();

  while (state.pendingValue !== null) {
    const valueToSend = state.pendingValue;
    state.pendingValue = null;
    try {
      await postConsolCountUpdate(getWebhookUrl(), {
        eccMaterial: item.eccMaterial,
        description: item.description,
        color: item.color,
        actualCount: valueToSend,
        initials,
      });
      const log = loadJSON(STORAGE.consolLog, []);
      const entry = log.find((e) => e.entryType === "count" && e.eccMaterial === item.eccMaterial);
      if (entry && entry.actualCount === valueToSend) {
        entry.synced = true;
        saveJSON(STORAGE.consolLog, log);
      }
    } catch (e) {
      break; // offline or unreachable — the next tap (or Refresh) will retry
    }
  }
  state.inFlight = false;
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
      })),
    });

    // Mirror the same effect locally instead of waiting on a fresh GET:
    // flag every held item Processed and record its ConsolLog entry.
    const master = loadJSON(STORAGE.consolMaster, []);
    const log = loadJSON(STORAGE.consolLog, []);

    for (const h of holding) {
      const idx = master.findIndex((p) => p.eccMaterial === h.eccMaterial);
      if (idx !== -1) master[idx].processed = "Processed";

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
        actualCount: 0,
        referenceNumber: "",
        synced: true,
      });
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
      actualCount: 0,
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
  // off the everyday view instead of cluttering it forever. "count" entries
  // are filtered out entirely here (not just hidden once done) — they're a
  // live running number the Items to Consolidate table already shows, not
  // a discrete event worth a line in this history feed.
  const log = fullLog.filter((e) => e.status !== "Resolved" && e.entryType !== "count");
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
      // "Needs Adjustment" can't be created from the UI anymore (see
      // Actual Count above, which replaced it), but old entries logged
      // before that change still live in the sheet permanently — this
      // branch (and Resolve below) stays just to keep displaying and
      // resolving them.
      const pillClass = e.status === "Actioned" ? "match" : "under";
      const needsAdjustment = e.status === "Needs Adjustment";
      div.innerHTML = `
        <div class="audit-entry-top">
          <span>${escapeHtml(e.eccMaterial)}</span>
          <span class="result-pill ${pillClass}">${escapeHtml(e.status)}</span>
        </div>
        <div class="meta">${escapeHtml(e.description)} — ${escapeHtml(e.color)}</div>
        <div class="meta">
          ${
            needsAdjustment
              ? `Size ${escapeHtml(e.size)} · ${e.actualCount ?? e.unitsOut ?? 0} out · `
              : ""
          }${escapeHtml(e.initials || "—")} · ${escapeHtml(e.date)}
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
    "actualCount",
    "referenceNumber",
    "timestamp",
  ];
  const rows = [header, ...log.map((e) => header.map((k) => e[k]))];
  downloadCsv(`consolidation-log-${todayISO()}.csv`, rows);
}
