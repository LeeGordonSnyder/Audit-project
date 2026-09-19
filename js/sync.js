"use strict";

function getWebhookUrl() {
  return localStorage.getItem(STORAGE.webhookUrl) || DEFAULT_WEBHOOK_URL;
}

function setWebhookUrl(url) {
  localStorage.setItem(STORAGE.webhookUrl, url);
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
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight Apps Script can't handle
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
  } catch (e) {
    if (attempt >= SYNC_RETRIES) throw e;
    await sleep(SYNC_RETRY_DELAY_MS * attempt);
    return postToSheet(url, payload, attempt + 1);
  }
}

async function fetchFromSheet(url, sheet, attempt = 1) {
  const sep = url.includes("?") ? "&" : "?";
  try {
    const res = await fetch(`${url}${sep}sheet=${sheet}`, { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) {
    if (attempt >= SYNC_RETRIES) throw e;
    await sleep(SYNC_RETRY_DELAY_MS * attempt);
    return fetchFromSheet(url, sheet, attempt + 1);
  }
}

function postEntryToSheet(url, entry) {
  return postToSheet(url, { type: "audit", ...entry });
}

function pushProductToSheet(url, item) {
  return postToSheet(url, { type: "master", ...item });
}

// Closes a Packed Box: logs every staged item as Completed under one
// packing-slip reference number, plus a closure record, and flags each as
// Processed on the ConsolMaster sheet — all in a single request.
function postConsolBoxCloseToSheet(url, payload) {
  return postToSheet(url, { type: "consolboxclose", ...payload });
}

// Logs a "Needs Adjustment" consolidation mark-out for one or more sizes of
// the same style in one request: records each in the consolidation log,
// pushes each chosen UPC/units into the AuditLog's Mark Out section, and
// flags the item Processed on the ConsolMaster sheet once. payload.items
// is an array of { upc, size, units, productDescription }.
function postConsolMarkoutToSheet(url, payload) {
  return postToSheet(url, { type: "consolmarkoutbatch", ...payload });
}

function pushReceivingItemToSheet(url, item) {
  return postToSheet(url, { type: "receivingimport", ...item });
}

// Marks a batch of scanned boxes "physical" or "mao" in one request.
function postReceivingStatusToSheet(url, payload) {
  return postToSheet(url, { type: "receivingstatus", ...payload });
}

// Commits every staged Check Floor decision in one request. payload.decisions
// is an array of { sku, status: "Needed"|"Not Needed", sizes: [...] } — a
// "Needed" decision also creates one FloorReplen row per size server-side.
function postCheckFloorUpdate(url, payload) {
  return postToSheet(url, { type: "checkfloorupdate", ...payload });
}

// Commits every staged Replen picking decision in one request.
// payload.decisions is an array of { id, action: "picked"|"outOfStock" }.
function postFloorReplenUpdate(url, payload) {
  return postToSheet(url, { type: "floorreplenupdate", ...payload });
}

// Closes out one or more 86 Board entries as restocked. payload.items is an
// array of { id, sku, size } — id when the entry only exists in FloorReplen,
// sku+size when a matching FloorRestock row should get its RESTOCKED column
// stamped (either or both may apply to the same entry).
function postFloor86Restock(url, payload) {
  return postToSheet(url, { type: "floor86restock", ...payload });
}

function initSync() {
  const urlInput = document.getElementById("sheet-url-input");
  urlInput.value = getWebhookUrl();

  document.getElementById("save-sheet-url-btn").addEventListener("click", () => {
    setWebhookUrl(urlInput.value.trim());
    setStatus("sheet-url-status", "Saved.", false);
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

  // Each postEntryToSheet() already retries transient failures internally,
  // so a failure surviving that is worth logging and moving on from rather
  // than aborting the whole batch over one bad entry.
  let successCount = 0;
  for (const entry of unsynced) {
    try {
      await postEntryToSheet(url, entry);
      entry.synced = true;
      successCount++;
    } catch (e) {
      // leave this one unsynced for next attempt, keep going with the rest
    }
  }

  saveJSON(STORAGE.auditLog, entries);
  renderAuditList();

  if (successCount === unsynced.length) {
    setStatus("sync-status", `Saved ${successCount} entr${successCount === 1 ? "y" : "ies"} to the shared log.`, false);
  } else {
    setStatus("sync-status", `Saved ${successCount} of ${unsynced.length} — check your connection and try Save again.`, true);
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
    saveJSON(STORAGE.floorRestock, remoteRows.map(sheetRowToFloorRestockItem));
  } catch (e) {
    // offline or unreachable — local data stands, next boot/refresh will retry
  }
}

// Full replace — FloorReplen is fully app-managed (like ReceivingLog), one
// row per size, whose own status field moves through the picking and
// 86 Board lifecycle.
async function loadSharedFloorReplen() {
  const url = getWebhookUrl();

  try {
    const remoteRows = await fetchFromSheet(url, "floorreplen");
    if (!Array.isArray(remoteRows)) return;
    saveJSON(STORAGE.floorReplen, remoteRows.map(sheetRowToFloorReplenItem));
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
    const knownIds = new Set(log.map((e) => e.id));
    let added = 0;

    for (const row of remoteRows) {
      if (!row.id || knownIds.has(row.id)) continue;
      log.push({
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
        unitsOut: Number(row.unitsOut) || 0,
        referenceNumber: row.referenceNumber,
        synced: true,
      });
      knownIds.add(row.id);
      added++;
    }

    if (added > 0) {
      log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      saveJSON(STORAGE.consolLog, log);
    }
  } catch (e) {
    // offline or unreachable — local data stands, next boot/refresh will retry
  }
}
