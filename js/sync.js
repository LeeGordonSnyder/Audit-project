"use strict";

function getWebhookUrl() {
  return localStorage.getItem(STORAGE.webhookUrl) || DEFAULT_WEBHOOK_URL;
}

function setWebhookUrl(url) {
  localStorage.setItem(STORAGE.webhookUrl, url);
}

function getApiKey() {
  return localStorage.getItem(STORAGE.apiKey) || "";
}

function setApiKey(key) {
  localStorage.setItem(STORAGE.apiKey, key);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Apps Script Web Apps occasionally drop or time out a request under load —
// a few retries with backoff clears most of those without the caller (or
// the person tapping the button) needing to notice or intervene.
const SYNC_RETRIES = 3;
const SYNC_RETRY_DELAY_MS = 700;

async function postToSheet(url, payload, attempt = 1) {
  let data;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight Apps Script can't handle
      body: JSON.stringify({ ...payload, key: getApiKey() }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    // Apps Script Web Apps return HTTP 200 even when the underlying
    // function throws -- the body comes back as an HTML error page instead
    // of the JSON every handler actually returns, so status alone can't
    // tell success from failure. Without this, that kind of server-side
    // error looked exactly like success everywhere in this app: the modal
    // would close, no error would show, and nothing was ever written.
    data = JSON.parse(await res.text());
  } catch (e) {
    if (attempt >= SYNC_RETRIES) throw e;
    await sleep(SYNC_RETRY_DELAY_MS * attempt);
    return postToSheet(url, payload, attempt + 1);
  }
  // A handled, well-formed failure (a missing column, a bad id) isn't a
  // transient blip retrying would fix -- surface it immediately instead of
  // silently reporting success.
  if (data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}

async function fetchFromSheet(url, sheet, attempt = 1) {
  const sep = url.includes("?") ? "&" : "?";
  try {
    const res = await fetch(`${url}${sep}sheet=${sheet}&key=${encodeURIComponent(getApiKey())}`, { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) {
    if (attempt >= SYNC_RETRIES) throw e;
    await sleep(SYNC_RETRY_DELAY_MS * attempt);
    return fetchFromSheet(url, sheet, attempt + 1);
  }
}

function pushProductToSheet(url, item) {
  return postToSheet(url, { type: "master", ...item });
}

// Assigns one hard-tag location to every ProductMaster row sharing a
// style (column I) — a hard tag applies to the whole style, not one SKU,
// so the server writes the same value across every matching row.
function postTagAssign(url, payload) {
  return postToSheet(url, { type: "tagassign", ...payload });
}

// Adds one new initials value to the shared staff roster (ProductMaster
// column J).
function postStaffAdd(url, payload) {
  return postToSheet(url, { type: "staffadd", ...payload });
}

// Registers who closed a box, and when — deliberately just the reference
// number, initials, and date, nothing about what's inside it (that's
// looked up in MAO by the reference number instead). Independent of the
// Consolidation Holding/Update flow below.
function postConsolBoxCloseToSheet(url, payload) {
  return postToSheet(url, { type: "consolboxclose", ...payload });
}

// Commits every staged Consolidation decision in one request.
// payload.decisions is an array of { eccMaterial, description, color,
// status: "Actioned" }. Logs each in the consolidation log and flags every
// item Processed on the ConsolMaster sheet.
function postConsolUpdate(url, payload) {
  return postToSheet(url, { type: "consolupdate", ...payload });
}

// Pushes the current Actual Count for one consolidation line straight to
// the sheet — unlike postConsolUpdate above, this isn't staged through
// Holding; every tap of -/+ (or a typed value) calls this immediately, so
// it acts as its own "Update." See the matching note on
// handleConsolCountUpdate in Code.gs for how a repeat call overwrites the
// same ConsolLog row instead of appending a new one per tap.
function postConsolCountUpdate(url, payload) {
  return postToSheet(url, { type: "consolcountupdate", ...payload });
}

// Marks one ConsolLog "Needs Adjustment" entry Resolved. The row itself
// stays in the sheet (ConsolLog is a permanent history, like AuditLog) —
// this just flips its status so the app can stop showing it as something
// still needing attention.
function postConsolLogResolve(url, payload) {
  return postToSheet(url, { type: "consollogresolve", ...payload });
}

function pushReceivingItemToSheet(url, item) {
  return postToSheet(url, { type: "receivingimport", ...item });
}

// Marks a batch of scanned boxes "physical" or "mao" in one request.
function postReceivingStatusToSheet(url, payload) {
  return postToSheet(url, { type: "receivingstatus", ...payload });
}

// Commits every staged Check Floor decision in one request. payload.decisions
// is an array of { sku, size, status: "Needed"|"Not Needed", sizes: [...] } —
// a "Needed" decision also appends one new FloorRestock row for every size
// checked besides the row's own, server-side.
function postCheckFloorUpdate(url, payload) {
  return postToSheet(url, { type: "checkfloorupdate", ...payload });
}

// Commits every staged Replen picking decision in one request.
// payload.decisions is an array of { sku, size, action: "picked"|"outOfStock" }.
function postFloorPickUpdate(url, payload) {
  return postToSheet(url, { type: "floorpickupdate", ...payload });
}

// Closes out one or more 86 Board entries as restocked. payload.items is an
// array of { sku, size } — stamps the matching FloorRestock row's RESTOCKED
// column.
function postFloor86Restock(url, payload) {
  return postToSheet(url, { type: "floor86restock", ...payload });
}

// Appends one new blank-Status FloorRestock row from a ProductMaster item
// that isn't on the MAO "items sold" list — lands in Check Floor exactly
// like a pasted row, for a normal Needed/Not Needed decision.
function postFloorRestockAdd(url, payload) {
  return postToSheet(url, { type: "floorrestockadd", ...payload });
}

// Appends one row to the Feedback sheet: the free-text note plus who wrote
// it and when. One-way — the app never reads this back.
function postFeedback(url, payload) {
  return postToSheet(url, { type: "feedback", ...payload });
}

// Saves every unsynced audit entry in one request instead of one request
// per entry — a busy day's worth of counts used to mean one sequential
// round trip each, which is most of what made "Save to Sheet" feel slow.
function postAuditBatch(url, entries) {
  return postToSheet(url, { type: "auditbatch", entries });
}

// Shares a whole pasted MAO shipment list in one request instead of one
// sequential request per box — see pushReceivingItemToSheet for the
// single-item version still used by the "box not expected" scanner flow.
function pushReceivingItemsBatch(url, items) {
  return postToSheet(url, { type: "receivingimportbatch", items });
}

function initSync() {
  const settingsModal = document.getElementById("settings-modal");
  document.getElementById("settings-btn").addEventListener("click", () => (settingsModal.hidden = false));
  document.getElementById("settings-close-btn").addEventListener("click", () => (settingsModal.hidden = true));

  const urlInput = document.getElementById("sheet-url-input");
  urlInput.value = getWebhookUrl();

  document.getElementById("save-sheet-url-btn").addEventListener("click", () => {
    setWebhookUrl(urlInput.value.trim());
    setStatus("sheet-url-status", "Saved.", false);
  });

  // The backend now requires this on every request (see Code.gs) — without
  // it, every sync silently behaves like "offline" (reads keep whatever's
  // already cached locally, writes fail) rather than a clear error, since
  // that's the same fallback path a dropped connection already took.
  const keyInput = document.getElementById("api-key-input");
  keyInput.value = getApiKey();

  document.getElementById("save-api-key-btn").addEventListener("click", () => {
    setApiKey(keyInput.value.trim());
    setStatus("api-key-status", "Saved.", false);
  });

  document.getElementById("save-shared-btn").addEventListener("click", syncUnsyncedEntries);
}

async function syncUnsyncedEntries() {
  const url = getWebhookUrl();

  const entries = loadJSON(STORAGE.auditLog, []);
  const unsynced = entries.filter((e) => !e.synced);
  if (unsynced.length === 0) {
    setStatus("sync-status", "Nothing new to save — everything is already in the shared log.", false);
    return;
  }

  if (!navigator.onLine) {
    setStatus("sync-status", "Offline — nothing was saved. Try again once you have a connection.", true);
    return;
  }

  setStatus("sync-status", `Saving ${unsynced.length} entr${unsynced.length === 1 ? "y" : "ies"}…`, false);

  // One request for the whole batch — postAuditBatch() already retries
  // transient failures internally (same as every other sheet call), so
  // what's left after that is a real failure (offline, sheet unreachable)
  // rather than a one-off blip. That means this is all-or-nothing instead
  // of the old per-entry partial-success accounting: either every entry
  // here is now synced, or none of them are and everything stays queued
  // for the next tap of Save — nothing already in local storage is ever
  // lost either way.
  try {
    await postAuditBatch(url, unsynced);
    unsynced.forEach((entry) => (entry.synced = true));
    saveJSON(STORAGE.auditLog, entries);
    renderAuditList();
    setStatus("sync-status", `Saved ${unsynced.length} entr${unsynced.length === 1 ? "y" : "ies"} to the shared log.`, false);
  } catch (e) {
    setStatus("sync-status", "Couldn't reach the sheet — check your connection and try Save again.", true);
  }
}

async function loadSharedHistory() {
  const url = getWebhookUrl();

  try {
    const remoteRows = await fetchFromSheet(url, "auditlog");
    if (!Array.isArray(remoteRows) || remoteRows.length === 0) return;

    const entries = loadJSON(STORAGE.auditLog, []);
    const knownIds = new Set(entries.map((e) => e.id));
    let added = 0;

    for (const row of remoteRows) {
      if (!row.id || knownIds.has(row.id)) continue;
      entries.push({
        id: row.id,
        timestamp: row.timestamp,
        date: row.date,
        initials: row.initials,
        sku: row.sku,
        upc: row.upc,
        style: row.style,
        description: row.description,
        expected: Number(row.expected),
        counted: Number(row.counted),
        variance: Number(row.variance),
        result: row.result,
        synced: true,
      });
      knownIds.add(row.id);
      added++;
    }

    if (added > 0) {
      entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      saveJSON(STORAGE.auditLog, entries);
    }
  } catch (e) {
    // offline or unreachable — local data stands, next boot/refresh will retry
  }
}

// Full replace, like ConsolMaster — the sheet (ProductMaster column J) is
// the single source of truth for the roster. The "staff" endpoint returns
// a plain array of strings, not row objects, so no sheetRowToXItem mapper
// is needed.
async function loadSharedStaffInitials() {
  const url = getWebhookUrl();

  try {
    const remoteRows = await fetchFromSheet(url, "staff");
    if (!Array.isArray(remoteRows) || remoteRows.length === 0) return;
    saveJSON(STORAGE.staffInitials, remoteRows.map(String));
  } catch (e) {
    // offline or unreachable — whatever's cached from a previous
    // successful fetch stands, or the hardcoded fallback if there's none
  }
}

async function loadSharedProductMaster() {
  const url = getWebhookUrl();

  try {
    const remoteRows = await fetchFromSheet(url, "master");
    if (!Array.isArray(remoteRows) || remoteRows.length === 0) return;
    upsertProductMaster(remoteRows.map(sheetRowToMasterItem));
  } catch (e) {
    // offline or unreachable — local data stands, next boot/refresh will retry
  }
}

// The HQ list is now edited directly in the ConsolMaster sheet, so unlike
// the other loadShared*() functions this is a full replace, not a merge —
// the sheet is the single source of truth, rows deleted there should
// disappear here too, not linger from a stale local cache.
async function loadSharedConsolMaster() {
  const url = getWebhookUrl();

  try {
    const remoteRows = await fetchFromSheet(url, "consolmaster");
    if (!Array.isArray(remoteRows)) return;
    saveJSON(STORAGE.consolMaster, remoteRows.map(sheetRowToConsolItem));
  } catch (e) {
    // offline or unreachable — local data stands, next boot/refresh will retry
  }
}

// Full replace, like loadSharedConsolMaster() — this sheet holds both the
// expected-shipment facts AND the received-status fields in the same row,
// so the sheet is the single source of truth for the whole thing.
async function loadSharedReceivingMaster() {
  const url = getWebhookUrl();

  try {
    const remoteRows = await fetchFromSheet(url, "receiving");
    if (!Array.isArray(remoteRows)) return;
    saveJSON(STORAGE.receivingMaster, remoteRows.map(sheetRowToReceivingItem));
  } catch (e) {
    // offline or unreachable — local data stands, next boot/refresh will retry
  }
}

// Full replace, like ConsolMaster/ReceivingLog — the sheet is the single
// source of truth for both the raw import and the Status/Checked By/
// Checked Date columns the app writes onto the same rows.
async function loadSharedFloorRestock() {
  const url = getWebhookUrl();

  try {
    const remoteRows = await fetchFromSheet(url, "floorrestock");
    if (!Array.isArray(remoteRows)) return;
    const items = remoteRows
      .map(sheetRowToFloorRestockItem)
      .filter((item) => !isFloorRestockAccessoryGender(item.gender));
    saveJSON(STORAGE.floorRestock, items);
  } catch (e) {
    // offline or unreachable — local data stands, next boot/refresh will retry
  }
}

async function loadSharedConsolLog() {
  const url = getWebhookUrl();

  try {
    const remoteRows = await fetchFromSheet(url, "consollog");
    if (!Array.isArray(remoteRows) || remoteRows.length === 0) return;

    const log = loadJSON(STORAGE.consolLog, []);
    const byId = new Map(log.map((e) => [e.id, e]));
    let changed = false;

    for (const row of remoteRows) {
      if (!row.id) continue;
      const existing = byId.get(row.id);
      if (existing) {
        // Status and Actual Count are the only fields a row can change
        // after it's first written — a resolve from any device, or an
        // Actual Count tapped in on a different phone — so pick those up
        // here instead of only ever adding brand-new rows, or a change
        // made elsewhere would never show up on this device until its own
        // next write.
        if (row.status && existing.status !== row.status) {
          existing.status = row.status;
          changed = true;
        }
        if (row.entryType === "count") {
          const remoteCount = Number(row.actualCount) || 0;
          if (existing.actualCount !== remoteCount) {
            existing.actualCount = remoteCount;
            existing.timestamp = row.timestamp;
            changed = true;
          }
        }
        continue;
      }
      const entry = {
        id: row.id,
        entryType: row.entryType || "status",
        timestamp: row.timestamp,
        date: row.date,
        initials: row.initials,
        eccMaterial: row.eccMaterial,
        description: row.description,
        color: row.color,
        status: row.status,
        size: row.size,
        actualCount: Number(row.actualCount) || 0,
        referenceNumber: row.referenceNumber,
        synced: true,
      };
      log.push(entry);
      byId.set(row.id, entry);
      changed = true;
    }

    if (changed) {
      log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      saveJSON(STORAGE.consolLog, log);
    }
  } catch (e) {
    // offline or unreachable — local data stands, next boot/refresh will retry
  }
}
