"use strict";

function getWebhookUrl() {
  return localStorage.getItem(STORAGE.webhookUrl) || "";
}

function setWebhookUrl(url) {
  localStorage.setItem(STORAGE.webhookUrl, url);
}

async function postEntryToSheet(url, entry) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight Apps Script can't handle
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

async function fetchSheetHistory(url) {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
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
  if (!url) {
    setStatus("sync-status", "Add a Google Sheet URL under Shared Log Settings first.", true);
    return;
  }

  const entries = loadJSON(STORAGE.auditLog, []);
  const unsynced = entries.filter((e) => !e.synced);
  if (unsynced.length === 0) {
    setStatus("sync-status", "Nothing new to save — everything is already in the shared log.", false);
    return;
  }

  setStatus("sync-status", `Saving ${unsynced.length} entr${unsynced.length === 1 ? "y" : "ies"}…`, false);

  let successCount = 0;
  for (const entry of unsynced) {
    try {
      await postEntryToSheet(url, entry);
      entry.synced = true;
      successCount++;
    } catch (e) {
      break; // likely offline — stop here, leave the rest for next attempt
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
  if (!url) return;

  try {
    const remoteRows = await fetchSheetHistory(url);
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
