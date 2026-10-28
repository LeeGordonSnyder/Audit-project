"use strict";

/* ---------- Counts ----------
   Scan (or search) → confirm expected → enter actual → logged locally →
   "Save to Sheet" pushes every unsaved count in one batch. Counts outside
   tolerance are flagged here and on Home until a recount lands within it. */

let countActiveItem = null;
let countFilter = "all"; // all | flagged | unsaved

function startCountScan() {
  openScanner("Scan a product to count…", handleCountScan);
}

function handleCountScan(upc) {
  setStatus("count-status", "", false);
  const item = findProductByUpc(upc);
  if (!item) {
    clearCountActive();
    showCountAddCard(upc);
    return;
  }
  hideCountAddCard();
  selectCountItem(item.sku);
}

function selectCountItem(sku) {
  const item = findProductBySku(sku);
  if (!item) return;
  document.getElementById("count-search").value = "";
  renderProductResults(document.getElementById("count-results"), "");
  hideCountAddCard();

  countActiveItem = item;
  const card = document.getElementById("count-active-card");
  card.hidden = false;
  document.getElementById("count-active-sku").textContent = `${item.sku} · UPC ${item.upc}`;
  document.getElementById("count-active-desc").textContent = combinedDescription(item);

  const last = loadJSON(STORE.auditLog, [])
    .filter((e) => e.sku === item.sku)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  document.getElementById("count-active-last").textContent = last
    ? `Last counted ${formatDay(last.date || last.timestamp)} by ${last.initials || "—"}: expected ${last.expected}, counted ${last.counted}.`
    : "Never counted before.";

  const expected = document.getElementById("count-expected");
  const actual = document.getElementById("count-actual");
  expected.value = item.expectedCount == null ? "" : item.expectedCount;
  actual.value = "";
  card.scrollIntoView({ block: "nearest" });
  (item.expectedCount == null ? expected : actual).focus();
}

function clearCountActive() {
  countActiveItem = null;
  document.getElementById("count-active-card").hidden = true;
}

function showCountAddCard(upc) {
  const card = document.getElementById("count-add-card");
  card.hidden = false;
  card.dataset.upc = upc;
  document.getElementById("count-add-upc").textContent = `UPC ${upc}`;
  card.querySelectorAll("input").forEach((i) => (i.value = ""));
  document.getElementById("count-add-sku").focus();
}

function hideCountAddCard() {
  document.getElementById("count-add-card").hidden = true;
}

async function saveCountNewProduct(btn) {
  const card = document.getElementById("count-add-card");
  const val = (id) => document.getElementById(id).value.trim();
  const item = {
    sku: val("count-add-sku"),
    upc: card.dataset.upc,
    description: val("count-add-description"),
    style: val("count-add-style"),
    dept: val("count-add-dept"),
    color: val("count-add-color"),
    size: val("count-add-size"),
  };
  if (!item.sku || !item.description) {
    setStatus("count-add-status", "SKU and Description are required.", true);
    return;
  }

  upsertProductMaster([item]);
  hideCountAddCard();
  selectCountItem(item.sku);
  setStatus("count-status", "Added — sharing with the catalog sheet…", false);

  await withBusy(btn, async () => {
    try {
      await api.pushProduct(item);
      setStatus("count-status", "Added and shared with the catalog sheet.", false);
    } catch (e) {
      setStatus("count-status", "Added on this device, but couldn't share it yet — re-add or import it once you're connected.", true);
    }
  });
}

function parseCountInput(id, label) {
  const el = document.getElementById(id);
  const n = parseInt(el.value, 10);
  if (el.value === "" || isNaN(n) || n < 0) {
    setStatus("count-entry-status", `Enter a valid ${label}.`, true);
    el.focus();
    return null;
  }
  return n;
}

function logCount() {
  if (!countActiveItem) return;
  const expected = parseCountInput("count-expected", "expected count");
  if (expected == null) return;
  const counted = parseCountInput("count-actual", "actual count");
  if (counted == null) return;
  setStatus("count-entry-status", "", false);

  if (expected !== countActiveItem.expectedCount) setExpectedCount(countActiveItem.sku, expected);

  const variance = counted - expected;
  const entry = {
    id: uid(),
    timestamp: new Date().toISOString(),
    date: todayISO(),
    initials: currentInitials(),
    sku: countActiveItem.sku,
    upc: countActiveItem.upc,
    style: countActiveItem.style,
    description: combinedDescription(countActiveItem),
    expected,
    counted,
    variance,
    result: variance === 0 ? "match" : variance > 0 ? "over" : "under",
    synced: false,
  };
  const entries = loadJSON(STORE.auditLog, []);
  entries.unshift(entry);
  saveJSON(STORE.auditLog, entries);

  clearCountActive();
  renderCountList();
  updateExceptionBadge();

  setStatus(
    "count-status",
    variance === 0
      ? "Logged — count matched."
      : `Logged — ${variance > 0 ? "over" : "under"} by ${Math.abs(variance)}${isFlaggedVariance(entry) ? " (outside tolerance — flagged for a recount)" : ""}.`,
    isFlaggedVariance(entry)
  );
}

async function saveCountsToSheet(btn) {
  const entries = loadJSON(STORE.auditLog, []);
  const unsynced = entries.filter((e) => !e.synced);
  if (!unsynced.length) {
    setStatus("count-sync-status", "Nothing new to save — everything's already on the sheet.", false);
    return;
  }
  if (!requireOnline("count-sync-status")) return;

  setStatus("count-sync-status", `Saving ${plural(unsynced.length, "count")}…`, false);
  await withBusy(btn, async () => {
    // All-or-nothing: either every count here is now on the sheet, or none
    // are and they all stay queued — nothing local is ever lost.
    try {
      await api.auditBatch(unsynced);
      const ids = new Set(unsynced.map((e) => e.id));
      const fresh = loadJSON(STORE.auditLog, []);
      fresh.forEach((e) => {
        if (ids.has(e.id)) e.synced = true;
      });
      saveJSON(STORE.auditLog, fresh);
      setStatus("count-sync-status", `Saved ${plural(unsynced.length, "count")} to the sheet.`, false);
      renderCountList();
      updateExceptionBadge();
    } catch (e) {
      setStatus("count-sync-status", "Couldn't reach the sheet — check your connection and try Save again.", true);
    }
  });
}

function renderCountList() {
  const entries = loadJSON(STORE.auditLog, []);
  const flaggedIds = new Set(flaggedCounts().map((e) => e.id));
  const unsaved = entries.filter((e) => !e.synced).length;

  document.getElementById("count-save-btn").textContent = unsaved ? `Save ${unsaved} to Sheet` : "Save to Sheet";
  document.querySelectorAll("#count-filters [data-filter]").forEach((b) => {
    b.classList.toggle("active", b.dataset.filter === countFilter);
    const n = b.dataset.filter === "flagged" ? flaggedIds.size : b.dataset.filter === "unsaved" ? unsaved : null;
    b.querySelector(".chip-n").textContent = n ? n : "";
  });

  const shown = entries.filter((e) =>
    countFilter === "flagged" ? flaggedIds.has(e.id) : countFilter === "unsaved" ? !e.synced : true
  );

  const listEl = document.getElementById("count-list");
  if (!shown.length) {
    listEl.innerHTML = `<p class="hint">${
      countFilter === "flagged" ? "No counts outside tolerance." : countFilter === "unsaved" ? "Everything is saved." : "No counts yet."
    }</p>`;
    return;
  }
  listEl.innerHTML = shown
    .slice(0, 60)
    .map((e) => {
      const flagged = flaggedIds.has(e.id);
      const pill = e.variance === 0 ? "match" : `${e.variance > 0 ? "+" : ""}${e.variance}`;
      return `
      <div class="entry${flagged ? " entry-flagged" : ""}">
        <div class="entry-top">
          <span class="entry-title">${escapeHtml(e.description || e.sku)}</span>
          <span class="pill ${flagged ? "pill-danger" : e.variance ? "pill-warn" : "pill-ok"}">${escapeHtml(pill)}</span>
        </div>
        <div class="entry-meta">
          <span class="mono">${escapeHtml(e.sku)}</span> · exp ${escapeHtml(e.expected)} · got ${escapeHtml(e.counted)} ·
          ${escapeHtml(e.initials || "—")} · ${escapeHtml(formatDay(e.date || e.timestamp))}
          ${e.synced ? "" : `<span class="pill pill-muted">not saved</span>`}
          ${flagged ? `<button type="button" class="link-btn" data-action="recount" data-sku="${escapeHtml(e.sku)}">Recount</button>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

function exportCountsCsv() {
  const header = ["date", "initials", "sku", "upc", "style", "description", "expected", "counted", "variance", "result", "timestamp", "synced"];
  downloadCsv(`counts-${todayISO()}.csv`, [header, ...loadJSON(STORE.auditLog, []).map((e) => header.map((k) => e[k]))]);
}

registerView("counts", {
  init(root) {
    const search = document.getElementById("count-search");
    search.addEventListener("input", () =>
      renderProductResults(document.getElementById("count-results"), search.value.trim(), {
        action: "select-count",
        actionLabel: "Count",
      })
    );
    ["count-expected", "count-actual"].forEach((id) =>
      document.getElementById(id).addEventListener("keydown", (e) => {
        if (e.key === "Enter") logCount();
      })
    );

    onAction(root, {
      "count-scan": startCountScan,
      "count-clear": () => {
        search.value = "";
        renderProductResults(document.getElementById("count-results"), "");
        search.focus();
      },
      "select-count": (el) => selectCountItem(el.dataset.sku),
      recount: (el) => selectCountItem(el.dataset.sku),
      "count-log": logCount,
      "count-cancel": clearCountActive,
      "count-add-save": saveCountNewProduct,
      "count-add-cancel": hideCountAddCard,
      "count-save": saveCountsToSheet,
      "count-export": exportCountsCsv,
      "count-filter": (el) => {
        countFilter = el.dataset.filter;
        renderCountList();
      },
    });
  },

  show() {
    renderCountList();
  },
});
