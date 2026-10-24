"use strict";

/* ---------- Views & routing ----------
   One view per module, addressed by URL hash (#home, #floor/replen, …) so
   the back button and a home-screen relaunch both land somewhere sensible.
   Each view registers { init(root), show(sub) }: init runs once after
   sign-in, show runs every time the view is opened (and after a refresh). */

const VIEWS = {};
let currentRoute = { id: "home", sub: "" };

function registerView(id, view) {
  VIEWS[id] = view;
}

function parseRoute(hash) {
  const [id, sub = ""] = (hash || "").replace(/^#/, "").split("/");
  return VIEWS[id] ? { id, sub } : { id: "home", sub: "" };
}

let afterRoute = null; // one-shot callback for goTo(route, then)

// Anything that wants to send someone somewhere goes through here —
// "settings" is a modal rather than a page, everything else is a view.
// `then` runs once the new view is showing (e.g. open the scanner), since
// switching views closes any open scanner first.
function goTo(route, then) {
  if (route === "settings") {
    openSettings();
    return;
  }
  afterRoute = then || null;
  if (location.hash === "#" + route) applyRoute();
  else location.hash = route;
}

function applyRoute() {
  const route = parseRoute(location.hash);
  currentRoute = route;

  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${route.id}`));
  document.querySelectorAll(".nav-btn").forEach((b) => {
    const active = b.dataset.route === route.id;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });

  closeScanner();
  try {
    VIEWS[route.id].show(route.sub);
  } catch (e) {
    console.error(`Failed to render ${route.id}:`, e);
  }
  updateExceptionBadge();
  window.scrollTo(0, 0);

  const then = afterRoute;
  afterRoute = null;
  if (then) then();
}

function refreshCurrentView() {
  try {
    VIEWS[currentRoute.id].show(currentRoute.sub);
  } catch (e) {
    console.error(`Failed to refresh ${currentRoute.id}:`, e);
  }
  updateExceptionBadge();
}

// In-app badge on the Home nav item (and the home-screen icon, where the
// platform supports it) — the count of exceptions someone needs to act on.
function updateExceptionBadge() {
  const n = actionableExceptionCount();
  const badge = document.getElementById("nav-home-badge");
  badge.textContent = n > 9 ? "9+" : String(n);
  badge.hidden = n === 0;
  try {
    if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (!n && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch (e) {
    // not supported — the in-app badge is enough
  }
}
