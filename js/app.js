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
    renderConsolBox();
    renderConsolLog();
  },
  receiving: () => {
    renderReceivingList();
    renderReceivingHolding();
  },
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

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initScannerModal();

  // Nothing else starts — no data load, no tab setup — until someone
  // confirms their initials on the mandatory login gate.
  initLoginGate(async () => {
    await Promise.all([
      loadSharedProductMaster(),
      loadSharedHistory(),
      loadSharedConsolMaster(),
      loadSharedConsolLog(),
      loadSharedReceivingMaster(),
    ]);
    initTagLookup();
    initAuditDashboard();
    initMasterList();
    initConsol();
    initReceiving();
    setOffline(!navigator.onLine);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  });
});
