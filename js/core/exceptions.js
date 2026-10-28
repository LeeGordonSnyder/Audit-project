"use strict";

/* ---------- The Exception & Confirmation Engine ----------
   One place that watches every module's local data and answers "what
   needs attention right now." Home renders this list; the nav badge shows
   its count. Everything here is computed from data already on the device
   (pulled from the sheet on sign-in/refresh) — no extra backend calls.

   The rule behind the MAO items: anywhere this app records something that
   implies MAO should also change, it stays visible here until the sheet
   shows that second step happened too. */

// Count variances outside this tolerance get flagged — whichever is
// larger of the unit or percent allowance. Phase 2 makes this configurable.
const COUNT_TOLERANCE = { units: 2, pct: 0.05 };
const COUNT_FLAG_WINDOW_DAYS = 14;
const RECEIVING_MAO_GRACE_DAYS = 1;
const CONSOL_HOLDING_STALE_DAYS = 1;
const FLOOR_NEEDED_STALE_DAYS = 3;
const SHEET_STALE_HOURS = 24;

function isFlaggedVariance(entry) {
  const v = Math.abs(Number(entry.variance) || 0);
  if (!v) return false;
  const allowed = Math.max(COUNT_TOLERANCE.units, Math.floor((Number(entry.expected) || 0) * COUNT_TOLERANCE.pct));
  return v > allowed;
}

// The latest count per SKU — a flagged count is cleared by a later
// recount of the same SKU that lands within tolerance.
function latestCountsBySku(entries) {
  const latest = new Map();
  for (const e of entries) {
    const prev = latest.get(e.sku);
    if (!prev || new Date(e.timestamp) > new Date(prev.timestamp)) latest.set(e.sku, e);
  }
  return [...latest.values()];
}

function flaggedCounts() {
  const entries = loadJSON(STORE.auditLog, []);
  return latestCountsBySku(entries)
    .filter((e) => {
      const age = daysAgo(e.date || e.timestamp);
      return age != null && age <= COUNT_FLAG_WINDOW_DAYS && isFlaggedVariance(e);
    })
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}

// Physically received, but the sheet doesn't show it received into MAO yet.
function receivingAwaitingMao() {
  return loadJSON(STORE.receivingMaster, [])
    .filter((b) => b.physicallyReceivedDate && !b.receivedIntoMaoDate)
    .map((b) => ({ ...b, age: daysAgo(b.physicallyReceivedDate) }))
    .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
}

function staleFloorNeeded() {
  return loadJSON(STORE.floorRestock, [])
    .filter(isFloorNeeded)
    .map((item) => ({ ...item, age: daysAgo(item.checkedDate) }))
    .filter((item) => item.age != null && item.age >= FLOOR_NEEDED_STALE_DAYS)
    .sort((a, b) => b.age - a.age);
}

function computeExceptions() {
  const out = [];

  // --- Receiving: physically received, not yet received into MAO ---
  const awaiting = receivingAwaitingMao().filter((b) => (b.age ?? 0) >= RECEIVING_MAO_GRACE_DAYS);
  if (awaiting.length) {
    out.push({
      key: "receiving-mao",
      severity: "high",
      module: "receiving",
      title: `${plural(awaiting.length, "box", "boxes")} on the shelf but not received into MAO`,
      detail: "Physically received over a day ago — MAO doesn't know yet.",
      items: awaiting.slice(0, 4).map((b) => `PO ${b.po} · ${b.barcode} · ${formatAge(b.age)}`),
      action: { label: "Open Receiving", route: "receiving" },
    });
  }

  // --- Counts: variances outside tolerance ---
  const flagged = flaggedCounts();
  if (flagged.length) {
    out.push({
      key: "counts-flagged",
      severity: "high",
      module: "counts",
      title: `${plural(flagged.length, "count")} outside tolerance`,
      detail: `Off by more than ${COUNT_TOLERANCE.units} units or ${Math.round(COUNT_TOLERANCE.pct * 100)}% — recount to confirm or clear.`,
      items: flagged.slice(0, 4).map((e) => `${e.description || e.sku} · ${e.variance > 0 ? "+" : ""}${e.variance}`),
      action: { label: "Open Counts", route: "counts" },
    });
  }

  // --- Counts: logged on this device, not saved to the sheet ---
  const unsynced = loadJSON(STORE.auditLog, []).filter((e) => !e.synced);
  if (unsynced.length) {
    out.push({
      key: "counts-unsynced",
      severity: "medium",
      module: "counts",
      title: `${plural(unsynced.length, "count")} not saved to the sheet`,
      detail: "Only on this device until you tap Save to Sheet.",
      action: { label: "Save now", route: "counts" },
    });
  }

  // --- Consolidations: staged in Holding but never Updated ---
  const consolHolding = loadJSON(STORE.consolHolding, []);
  if (consolHolding.length) {
    const stale = consolHolding.filter((h) => (daysAgo(h.stagedAt) ?? 0) >= CONSOL_HOLDING_STALE_DAYS);
    out.push({
      key: "consol-holding",
      severity: stale.length ? "medium" : "info",
      module: "consol",
      title: `${plural(consolHolding.length, "consolidation item")} waiting in Holding`,
      detail: stale.length ? `${stale.length} staged over a day ago — tap Update to push them.` : "Staged but not pushed — tap Update when ready.",
      action: { label: "Open Consolidations", route: "consol" },
    });
  }

  // --- Consolidations: legacy "Needs Adjustment" still unresolved ---
  const needsAdj = loadJSON(STORE.consolLog, []).filter((e) => e.status === "Needs Adjustment");
  if (needsAdj.length) {
    out.push({
      key: "consol-adjust",
      severity: "medium",
      module: "consol",
      title: `${plural(needsAdj.length, "consolidation adjustment")} unresolved`,
      detail: "Logged as Needs Adjustment and never resolved.",
      action: { label: "Review", route: "consol" },
    });
  }

  // --- Floor Stock: Needed for days without being picked ---
  const staleNeeded = staleFloorNeeded();
  if (staleNeeded.length) {
    out.push({
      key: "floor-stale",
      severity: "medium",
      module: "floor",
      title: `${plural(staleNeeded.length, "floor item")} Needed for ${FLOOR_NEEDED_STALE_DAYS}+ days`,
      detail: "Still on the Replen list — pick it or mark Out of Stock.",
      items: staleNeeded.slice(0, 4).map((i) => `${i.description} ${i.size ? "· " + i.size : ""} · ${formatAge(i.age)}`),
      action: { label: "Open Replen", route: "floor/replen" },
    });
  }

  // --- Staged-but-not-pushed elsewhere (this device only) ---
  const staged = [
    [loadJSON(STORE.receivingHolding, []).length, "box", "boxes", "Receiving", "receiving"],
    [loadJSON(STORE.checkFloorHolding, []).length, "Check Floor decision", null, "Check Floor", "floor/check"],
    [loadJSON(STORE.replenHolding, []).length, "Replen decision", null, "Replen", "floor/replen"],
  ];
  for (const [n, one, many, where, route] of staged) {
    if (!n) continue;
    out.push({
      key: `staged-${route}`,
      severity: "info",
      module: route.split("/")[0],
      title: `${plural(n, one, many)} staged in ${where}`,
      detail: "Held on this device — not on the sheet until you tap the update button.",
      action: { label: `Open ${where}`, route },
    });
  }

  // --- Access key rejected ---
  if (sheetAuthRejected) {
    out.push({
      key: "auth",
      severity: "high",
      module: "settings",
      title: "The sheet rejected this device's access key",
      detail: "Nothing syncs until it's fixed. Paste the correct key in Settings.",
      action: { label: "Open Settings", route: "settings" },
    });
  }

  // --- Data freshness ---
  const lastSync = loadJSON(STORE.lastSync, null);
  const hours = lastSync ? (Date.now() - new Date(lastSync)) / 3600000 : Infinity;
  if (!sheetAuthRejected && hours > SHEET_STALE_HOURS) {
    out.push({
      key: "stale-data",
      severity: "info",
      module: "settings",
      title: lastSync ? "Data may be out of date" : "Haven't reached the sheet yet",
      detail: lastSync
        ? `Last full refresh ${new Date(lastSync).toLocaleString()}. Tap ↻ to pull the latest.`
        : "Check your connection and the Sheet URL / Access Key in Settings.",
      action: { label: "Settings", route: "settings" },
    });
  }

  const rank = { high: 0, medium: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// Badge = things that need a person to act, not informational notes.
function actionableExceptionCount() {
  return computeExceptions().filter((e) => e.severity !== "info").length;
}
