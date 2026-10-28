"use strict";

function setOffline(isOffline) {
  document.getElementById("offline-badge").hidden = !isOffline;
}

window.addEventListener("online", () => setOffline(false));
window.addEventListener("offline", () => setOffline(true));

let refreshing = null;

function warnUnauthorized() {
  toast("The sheet rejected this device's access key — update it in Settings.", true);
}

// Re-pulls every shared sheet and re-renders whatever's open.
// Resolves to { ok, unauthorized }.
function refreshSharedData() {
  if (refreshing) return refreshing;
  const btn = document.getElementById("refresh-btn");
  btn.classList.add("spinning");
  refreshing = loadAllShared()
    .then((result) => {
      refreshCurrentView();
      if (result.unauthorized) warnUnauthorized();
      else if (!result.ok) toast("Couldn't reach the sheet — showing what's saved on this device.", true);
      return result;
    })
    .finally(() => {
      btn.classList.remove("spinning");
      refreshing = null;
    });
  return refreshing;
}

// Leads change the deployment during the day (moving breaks and roles), so
// it's re-pulled on its own, one small request, whenever the app comes back
// on screen and every few minutes while it's open. Everything else waits for
// ↻ as before.
const DEPLOYMENT_STALE_MS = 2 * 60 * 1000;

async function refreshDeploymentIfStale() {
  if (document.hidden || !navigator.onLine || refreshing || !currentInitials()) return;
  const saved = loadJSON(STORE.deployment, null);
  if (saved && Date.now() - new Date(saved.fetchedAt).getTime() < DEPLOYMENT_STALE_MS) return;
  if ((await loadSharedDeployment()) === true && currentRoute.id === "home" && !document.hidden) renderShiftCard();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // A controller already present means an earlier visit's worker is
  // running this page; a later controllerchange is then a real update.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) document.getElementById("update-banner").hidden = false;
  });
  document.getElementById("update-reload-btn").addEventListener("click", () => window.location.reload());
}

// Waits for the first full pull, but never indefinitely: after a few
// seconds the person can carry on with what's already on the phone, and
// the pull keeps going in the background and refreshes the view when done.
const BOOT_SKIP_AFTER_MS = 6000;

function initialLoad() {
  const overlay = document.getElementById("boot-loading");
  const skip = document.getElementById("boot-skip");
  overlay.hidden = false;
  skip.hidden = true;
  const skipTimer = setTimeout(() => (skip.hidden = false), BOOT_SKIP_AFTER_MS);

  const load = loadAllShared();
  const skipped = new Promise((resolve) => skip.addEventListener("click", () => resolve("skipped"), { once: true }));

  return Promise.race([load, skipped]).then((first) => {
    clearTimeout(skipTimer);
    overlay.hidden = true;
    if (first === "skipped") {
      load.then((result) => {
        refreshCurrentView();
        if (result.unauthorized) warnUnauthorized();
      });
      return null;
    }
    return first;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  carryOverOriginalAppWork();
  initScannerModal();
  initChangeUser();
  initSettings();
  document.getElementById("refresh-btn").addEventListener("click", refreshSharedData);
  document.addEventListener("visibilitychange", refreshDeploymentIfStale);
  setInterval(refreshDeploymentIfStale, 60 * 1000);
  setOffline(!navigator.onLine);
  registerServiceWorker();

  initLoginGate(async () => {
    const result = await initialLoad();

    // Each view initializes independently — one view tripping over odd
    // data must not take the rest of the app down with it.
    for (const [id, view] of Object.entries(VIEWS)) {
      try {
        view.init(document.getElementById(`view-${id}`));
      } catch (e) {
        console.error(`Failed to initialize ${id}:`, e);
      }
    }

    window.addEventListener("hashchange", applyRoute);
    document.getElementById("app").hidden = false;
    applyRoute();

    if (result && result.unauthorized) {
      warnUnauthorized();
      openSettings();
      setStatus("settings-status", "The sheet rejected this access key. Paste the correct one and tap Save & sync.", true);
    } else if (result && !result.ok) {
      toast("Couldn't reach the sheet — showing what's saved on this device.", true);
    }
  });
});
