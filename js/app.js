"use strict";

const TAB_REFRESHERS = {
  taglookup: () => {
    renderTagResults(document.getElementById("tag-search-input").value.trim());
    renderTagAssignmentsList();
  },
  audit: () => renderAuditList(),
  master: () => renderMasterTable(),
  consol: () => {
    renderConsolList();
    renderConsolHolding();
    renderConsolLog();
  },
  receiving: () => {
    renderReceivingList();
    renderReceivingHolding();
  },
  floorreplen: () => {
    renderCheckFloorList();
    renderCheckFloorHolding();
    renderReplenList();
    renderReplenHolding();
    renderLastFloorCheck();
  },
  board86: () => renderBoard86List(),
};

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

      closeScanner();
      const refresh = TAB_REFRESHERS[btn.dataset.tab];
      if (refresh) refresh();
    });
  });
}

function setOffline(isOffline) {
  document.getElementById("offline-badge").hidden = !isOffline;
}

window.addEventListener("online", () => setOffline(false));
window.addEventListener("offline", () => setOffline(true));

// Re-fetches every shared sheet and re-renders whichever tab is currently
// open — lets staff pull the latest sheet data on demand instead of having
// to close the app and log back in just to force a refresh.
async function refreshSharedData() {
  const btn = document.getElementById("global-refresh-btn");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("spinning");

  await Promise.all([
    loadSharedProductMaster(),
    loadSharedHistory(),
    loadSharedConsolMaster(),
    loadSharedConsolLog(),
    loadSharedReceivingMaster(),
    loadSharedFloorRestock(),
  ]);

  const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
  const refresh = TAB_REFRESHERS[activeTab];
  if (refresh) refresh();

  btn.disabled = false;
  btn.classList.remove("spinning");
}

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  initScannerModal();

  // The staff roster itself now lives in the sheet (ProductMaster column
  // J), so it has to be fetched before the login gate can even render its
  // dropdown — this one fetch happens ahead of the gate instead of after,
  // unlike everything else which waits until initials are confirmed.
  await loadSharedStaffInitials();

  // Nothing else starts — no data load, no tab setup — until someone
  // confirms their initials on the mandatory login gate.
  initLoginGate(async () => {
    await Promise.all([
      loadSharedProductMaster(),
      loadSharedHistory(),
      loadSharedConsolMaster(),
      loadSharedConsolLog(),
      loadSharedReceivingMaster(),
      loadSharedFloorRestock(),
    ]);
    // Each tab's init runs independently — a bug tripped up by one tab's
    // real data (a bad row shape, a stale local-storage entry from before
    // a schema change, etc.) used to throw here and silently skip every
    // init call after it in this list, including Feedback, the offline
    // indicator, the Refresh button, and service worker registration
    // below. Now a broken tab logs to the console and initialization
    // moves on instead of taking the rest of the app down with it.
    [
      ["Tag Lookup", initTagLookup],
      ["Audit Dashboard", initAuditDashboard],
      ["Product Master", initMasterList],
      ["Consolidations", initConsol],
      ["Receiving Log", initReceiving],
      ["Floor Replen", initFloorReplen],
      ["86 Board", initBoard86],
      ["Feedback", initFeedback],
    ].forEach(([name, fn]) => {
      try {
        fn();
      } catch (e) {
        console.error(`Failed to initialize ${name}:`, e);
      }
    });

    setOffline(!navigator.onLine);

    const refreshBtn = document.getElementById("global-refresh-btn");
    refreshBtn.disabled = false;
    refreshBtn.addEventListener("click", refreshSharedData);

    if ("serviceWorker" in navigator) {
      // A controller already means some earlier visit's service worker is
      // running this page -- a later controllerchange is a genuine update
      // taking over. On a first-ever visit there's no controller yet, and
      // the very first activation (skipWaiting + clients.claim in sw.js)
      // fires this same event once purely from taking control for the
      // first time, which isn't something to prompt anyone about.
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register("sw.js").catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController) return;
        document.getElementById("update-banner").hidden = false;
      });
    }

    document.getElementById("update-reload-btn").addEventListener("click", () => window.location.reload());
  });
});
