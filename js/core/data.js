"use strict";

/* ---------- Pulling shared data from the sheet ----------
   Each loader returns true on success, "unauthorized" when the backend
   rejected the access key, and false when the sheet couldn't be reached.
   On failure, whatever's already cached locally stands — reads never wipe
   local data. */

// Set by the last full pull: true when the backend rejected the access
// key, so Home and Settings can say so instead of a vague "offline".
let sheetAuthRejected = false;

async function loadSharedStaffInitials() {
  try {
    const rows = await fetchFromSheet("staff");
    if (!Array.isArray(rows)) return false;
    if (rows.length) saveJSON(STORE.staffInitials, rows.map(String));
    return true;
  } catch (e) {
    return isUnauthorized(e) ? "unauthorized" : false;
  }
}

function loadStaffRoster() {
  return loadJSON(STORE.staffInitials, null) || loadJSON(LEGACY_KEYS.staffInitials, null) || STAFF_INITIALS_FALLBACK;
}

// Merge, not replace: the catalog only ever grows from the sheet.
async function loadSharedProductMaster() {
  try {
    const rows = await fetchFromSheet("master");
    if (!Array.isArray(rows)) return false;
    if (rows.length) upsertProductMaster(rows.map(sheetRowToMasterItem));
    return true;
  } catch (e) {
    return isUnauthorized(e) ? "unauthorized" : false;
  }
}

async function loadSharedAuditLog() {
  try {
    const rows = await fetchFromSheet("auditlog");
    if (!Array.isArray(rows)) return false;
    const entries = loadJSON(STORE.auditLog, []);
    const known = new Set(entries.map((e) => e.id));
    let added = 0;
    for (const row of rows) {
      if (!row.id || known.has(row.id)) continue;
      entries.push({
        id: row.id,
        timestamp: row.timestamp,
        date: row.date,
        initials: row.initials,
        sku: String(row.sku ?? ""),
        upc: String(row.upc ?? ""),
        style: String(row.style ?? ""),
        description: row.description,
        expected: Number(row.expected),
        counted: Number(row.counted),
        variance: Number(row.variance),
        result: row.result,
        synced: true,
      });
      known.add(row.id);
      added++;
    }
    if (added) {
      entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      saveJSON(STORE.auditLog, entries);
    }
    return true;
  } catch (e) {
    return isUnauthorized(e) ? "unauthorized" : false;
  }
}

// Full replace — the sheet is the single source of truth for this list.
async function loadSharedConsolMaster() {
  try {
    const rows = await fetchFromSheet("consolmaster");
    if (!Array.isArray(rows)) return false;
    saveJSON(STORE.consolMaster, rows.map(sheetRowToConsolItem));
    return true;
  } catch (e) {
    return isUnauthorized(e) ? "unauthorized" : false;
  }
}

async function loadSharedConsolLog() {
  try {
    const rows = await fetchFromSheet("consollog");
    if (!Array.isArray(rows)) return false;
    const log = loadJSON(STORE.consolLog, []);
    const byId = new Map(log.map((e) => [e.id, e]));
    let changed = false;
    for (const row of rows) {
      if (!row.id) continue;
      const existing = byId.get(row.id);
      if (existing) {
        // Status (a resolve) and Actual Count are the only fields that
        // change after a row is first written — pick up changes made on
        // other devices.
        if (row.status && existing.status !== row.status) {
          existing.status = row.status;
          changed = true;
        }
        if (row.entryType === "count") {
          const remote = Number(row.actualCount) || 0;
          if (existing.actualCount !== remote) {
            existing.actualCount = remote;
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
        eccMaterial: String(row.eccMaterial ?? ""),
        description: row.description,
        color: row.color,
        status: row.status,
        size: row.size,
        actualCount: Number(row.actualCount) || 0,
        referenceNumber: String(row.referenceNumber ?? ""),
        synced: true,
      };
      log.push(entry);
      byId.set(row.id, entry);
      changed = true;
    }
    if (changed) {
      log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      saveJSON(STORE.consolLog, log);
    }
    return true;
  } catch (e) {
    return isUnauthorized(e) ? "unauthorized" : false;
  }
}

async function loadSharedReceivingMaster() {
  try {
    const rows = await fetchFromSheet("receiving");
    if (!Array.isArray(rows)) return false;
    saveJSON(STORE.receivingMaster, rows.map(sheetRowToReceivingItem));
    return true;
  } catch (e) {
    return isUnauthorized(e) ? "unauthorized" : false;
  }
}

async function loadSharedFloorRestock() {
  try {
    const rows = await fetchFromSheet("floorrestock");
    if (!Array.isArray(rows)) return false;
    saveJSON(
      STORE.floorRestock,
      rows.map(sheetRowToFloorRestockItem).filter((item) => !isFloorAccessory(item.gender))
    );
    return true;
  } catch (e) {
    return isUnauthorized(e) ? "unauthorized" : false;
  }
}

// Today's deployment grid (built in the sheet from When I Work). Optional:
// a backend without the Deployment.gs add-on answers this request with some
// other sheet's rows, so only a { deployment } object is accepted, and it
// never counts toward "fully synced".
// The last reason the deployment couldn't be read, shown on Home when there's
// nothing saved to fall back on.
let deploymentError = "";

async function loadSharedDeployment() {
  try {
    const data = await fetchFromSheet("deployment", { retries: 1 });
    if (!data || Array.isArray(data) || !("deployment" in data)) return false;
    deploymentError = "";
    const saved = loadJSON(STORE.deployment, null);
    // "No Deployment tab" never replaces one already on this phone: the tab can
    // be missing for a moment (renamed, or an older build swapping it in).
    // The next pull tries again.
    if (!data.deployment && saved && saved.deployment) return true;
    saveJSON(STORE.deployment, { deployment: data.deployment, codes: data.codes || [], fetchedAt: new Date().toISOString() });
    return true;
  } catch (e) {
    deploymentError = e.message || "couldn't reach the sheet";
    return false;
  }
}

// Pulls every shared sheet at once. Records when the last fully
// successful pull happened so Home can say how fresh its numbers are.
// Resolves to { ok, unauthorized }.
async function loadAllShared() {
  const [, ...results] = await Promise.all([
    loadSharedDeployment(),
    loadSharedProductMaster(),
    loadSharedAuditLog(),
    loadSharedConsolMaster(),
    loadSharedConsolLog(),
    loadSharedReceivingMaster(),
    loadSharedFloorRestock(),
  ]);
  const ok = results.every((r) => r === true);
  sheetAuthRejected = results.includes("unauthorized");
  if (ok) saveJSON(STORE.lastSync, new Date().toISOString());
  return { ok, unauthorized: sheetAuthRejected };
}
