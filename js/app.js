"use strict";

/* ---------- Constants ---------- */
const LS_KEYS = {
  data: "tagLookup.skuData.v1",
  dataFetchedAt: "tagLookup.skuData.fetchedAt",
  auditLog: "tagLookup.auditLog.v1",
  webhookUrl: "tagLookup.webhookUrl.v1",
};

let skuItems = [];
let html5QrCode = null;
let activeScanTarget = null; // "lookup" | "audit"

/* ---------- Tabs ---------- */
function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");

      document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
      document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;

      stopScanner();
    });
  });
}

/* ---------- Data loading ---------- */
async function loadData(forceNetwork = false) {
  const statusEl = document.getElementById("data-status");
  if (!forceNetwork) {
    const cached = localStorage.getItem(LS_KEYS.data);
    if (cached) {
      try {
        skuItems = JSON.parse(cached).items || [];
      } catch (e) {
        skuItems = [];
      }
    }
  }

  try {
    const res = await fetch("data/skus.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    skuItems = json.items || [];
    localStorage.setItem(LS_KEYS.data, JSON.stringify(json));
    localStorage.setItem(LS_KEYS.dataFetchedAt, new Date().toISOString());
    setOffline(false);
    if (statusEl) statusEl.textContent = `Loaded ${skuItems.length} SKUs (updated just now).`;
  } catch (err) {
    setOffline(true);
    if (skuItems.length === 0) {
      const cached = localStorage.getItem(LS_KEYS.data);
      if (cached) {
        try {
          skuItems = JSON.parse(cached).items || [];
        } catch (e) {}
      }
    }
    const fetchedAt = localStorage.getItem(LS_KEYS.dataFetchedAt);
    if (statusEl) {
      statusEl.textContent = skuItems.length
        ? `Offline — using cached data (${skuItems.length} SKUs${fetchedAt ? ", from " + new Date(fetchedAt).toLocaleString() : ""}).`
        : "Offline and no cached data available yet.";
    }
  }
}

function setOffline(isOffline) {
  document.getElementById("offline-badge").hidden = !isOffline;
}

/* ---------- Lookup ---------- */
function normalize(s) {
  return (s || "").toString().trim().toLowerCase();
}

function searchItems(query) {
  const q = normalize(query);
  if (!q) return [];
  return skuItems.filter((item) => {
    return (
      normalize(item.sku).includes(q) ||
      normalize(item.description).includes(q) ||
      normalize(item.category).includes(q)
    );
  });
}

function renderResults(items, query) {
  const resultsEl = document.getElementById("results");
  const emptyEl = document.getElementById("empty-state");
  resultsEl.innerHTML = "";

  if (!query) {
    emptyEl.hidden = false;
    resultsEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  resultsEl.hidden = false;

  if (items.length === 0) {
    resultsEl.innerHTML = `<div class="no-results">No matches for "${escapeHtml(query)}".<br>Check the SKU or try a keyword.</div>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="sku">${escapeHtml(item.sku)}</div>
      <h3>${escapeHtml(item.description)}</h3>
      <div class="result-field">
        <div class="label">Category</div>
        <div class="value">${escapeHtml(item.category || "—")}</div>
      </div>
      <div class="result-field">
        <div class="label">Tag Placement</div>
        <div class="value">${escapeHtml(item.tagLocation || "Not specified")}</div>
      </div>
      ${
        item.exceptionNotes
          ? `<div class="exception-box">
               <div class="label">⚠ HQ Exception</div>
               <div class="value">${escapeHtml(item.exceptionNotes)}</div>
             </div>`
          : ""
      }
    `;
    resultsEl.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function initSearch() {
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-btn");

  input.addEventListener("input", () => {
    renderResults(searchItems(input.value), input.value.trim());
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    input.focus();
    renderResults([], "");
  });

  renderResults([], "");
}

/* ---------- Camera scanning (html5-qrcode) ---------- */
function initScanButtons() {
  document.getElementById("scan-btn").addEventListener("click", () => startScanner("lookup"));
  document.getElementById("audit-scan-btn").addEventListener("click", () => startScanner("audit"));
  document.getElementById("scan-stop-btn").addEventListener("click", stopScanner);
}

async function startScanner(target) {
  if (typeof Html5Qrcode === "undefined") {
    alert("Camera scanner library failed to load (needs an internet connection the first time). You can still type or use a handheld scanner.");
    return;
  }
  activeScanTarget = target;
  const wrap = document.getElementById("scanner-wrap");
  wrap.hidden = false;
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });

  try {
    html5QrCode = new Html5Qrcode("scanner-view");
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 120 } },
      onScanSuccess,
      () => {} /* ignore per-frame decode errors */
    );
  } catch (err) {
    wrap.hidden = true;
    alert("Couldn't start the camera. Check camera permission for this site in Settings > Safari.");
  }
}

function onScanSuccess(decodedText) {
  const value = decodedText.trim();
  if (activeScanTarget === "lookup") {
    const input = document.getElementById("search-input");
    input.value = value;
    renderResults(searchItems(value), value);
  } else if (activeScanTarget === "audit") {
    document.getElementById("audit-sku").value = value;
    autofillAuditDescription(value);
  }
  stopScanner();
  if (navigator.vibrate) navigator.vibrate(80);
}

function stopScanner() {
  const wrap = document.getElementById("scanner-wrap");
  if (html5QrCode) {
    html5QrCode
      .stop()
      .then(() => html5QrCode.clear())
      .catch(() => {});
    html5QrCode = null;
  }
  wrap.hidden = true;
  activeScanTarget = null;
}

/* ---------- Audit log ---------- */
function getAuditLog() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS.auditLog) || "[]");
  } catch (e) {
    return [];
  }
}

function saveAuditLog(entries) {
  localStorage.setItem(LS_KEYS.auditLog, JSON.stringify(entries));
}

function autofillAuditDescription(sku) {
  const match = skuItems.find((i) => normalize(i.sku) === normalize(sku));
  const descInput = document.getElementById("audit-desc");
  if (match && !descInput.value) {
    descInput.value = match.description;
  }
}

function initAuditForm() {
  const form = document.getElementById("audit-form");
  const skuInput = document.getElementById("audit-sku");
  const statusEl = document.getElementById("audit-status");

  skuInput.addEventListener("blur", () => autofillAuditDescription(skuInput.value));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const entry = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      associate: document.getElementById("audit-name").value.trim(),
      sku: skuInput.value.trim(),
      description: document.getElementById("audit-desc").value.trim(),
      result: form.querySelector('input[name="audit-result"]:checked').value,
      notes: document.getElementById("audit-notes").value.trim(),
      synced: false,
    };

    const entries = getAuditLog();
    entries.unshift(entry);
    saveAuditLog(entries);
    renderAuditList();

    form.reset();
    document.getElementById("audit-name").value = entry.associate; // keep associate name for the next scan
    statusEl.textContent = "Saved to this device.";
    statusEl.classList.remove("error");

    trySyncEntry(entry);
    skuInput.focus();
  });

  document.getElementById("export-csv-btn").addEventListener("click", exportCsv);
  document.getElementById("clear-log-btn").addEventListener("click", () => {
    if (confirm("Clear all locally saved audit entries? This can't be undone. (Already-synced entries stay in the Google Sheet.)")) {
      saveAuditLog([]);
      renderAuditList();
    }
  });

  renderAuditList();
}

function renderAuditList() {
  const listEl = document.getElementById("audit-list");
  const entries = getAuditLog();
  listEl.innerHTML = "";

  if (entries.length === 0) {
    listEl.innerHTML = `<p class="hint">No entries logged yet.</p>`;
    return;
  }

  for (const entry of entries.slice(0, 50)) {
    const div = document.createElement("div");
    div.className = "audit-entry";
    const when = new Date(entry.timestamp).toLocaleString();
    div.innerHTML = `
      <div class="audit-entry-top">
        <span>${escapeHtml(entry.sku || "(no SKU)")}</span>
        <span class="result-pill ${entry.result}">${entry.result}</span>
      </div>
      <div class="meta">${escapeHtml(entry.description || "")}</div>
      <div class="meta">${escapeHtml(entry.associate)} · ${when} · <span class="sync-pill">${entry.synced ? "synced" : "not synced"}</span></div>
      ${entry.notes ? `<div class="notes">${escapeHtml(entry.notes)}</div>` : ""}
    `;
    listEl.appendChild(div);
  }
}

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportCsv() {
  const entries = getAuditLog();
  const header = ["timestamp", "associate", "sku", "description", "result", "notes"];
  const rows = [header.join(",")];
  for (const e of entries) {
    rows.push(header.map((k) => csvEscape(e[k])).join(","));
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Optional Google Sheet sync ---------- */
function getWebhookUrl() {
  return localStorage.getItem(LS_KEYS.webhookUrl) || "";
}

async function trySyncEntry(entry) {
  const url = getWebhookUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(entry),
    });
    // "no-cors" responses are opaque, so we can't confirm success — mark optimistically.
    const entries = getAuditLog();
    const idx = entries.findIndex((e) => e.id === entry.id);
    if (idx !== -1) {
      entries[idx].synced = true;
      saveAuditLog(entries);
      renderAuditList();
    }
  } catch (err) {
    // stays unsynced; retried on next "sync now" pass
  }
}

async function retryUnsyncedEntries() {
  const url = getWebhookUrl();
  if (!url) return;
  const entries = getAuditLog();
  const pending = entries.filter((e) => !e.synced);
  for (const entry of pending) {
    await trySyncEntry(entry);
  }
}

function initSettings() {
  const urlInput = document.getElementById("webhook-url");
  const statusEl = document.getElementById("webhook-status");
  urlInput.value = getWebhookUrl();

  document.getElementById("save-webhook-btn").addEventListener("click", () => {
    const val = urlInput.value.trim();
    localStorage.setItem(LS_KEYS.webhookUrl, val);
    statusEl.textContent = val ? "Saved. New entries will sync to your Google Sheet." : "Cleared — entries will only save on this device.";
    statusEl.classList.remove("error");
    if (val) retryUnsyncedEntries();
  });

  document.getElementById("reload-data-btn").addEventListener("click", () => loadData(true));
}

/* ---------- Init ---------- */
window.addEventListener("online", () => {
  setOffline(false);
  retryUnsyncedEntries();
});
window.addEventListener("offline", () => setOffline(true));

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  initSearch();
  initScanButtons();
  initAuditForm();
  initSettings();
  setOffline(!navigator.onLine);
  await loadData();
  retryUnsyncedEntries();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
