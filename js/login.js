"use strict";

// Mandatory on every fresh load — asked for specifically so a device
// changing hands between staff can't silently keep the previous person's
// initials. onReady() only runs once someone actually confirms who they
// are; nothing else in the app initializes before that.
function initLoginGate(onReady) {
  const gate = document.getElementById("login-gate");
  const select = document.getElementById("login-initials-select");
  const lastUsed = loadJSON(STORAGE.session, {}).initials || "";

  select.innerHTML =
    `<option value="" disabled ${lastUsed ? "" : "selected"}>Select initials…</option>` +
    STAFF_INITIALS.map(
      (i) => `<option value="${escapeHtml(i)}" ${i === lastUsed ? "selected" : ""}>${escapeHtml(i)}</option>`
    ).join("");

  document.getElementById("login-continue-btn").addEventListener("click", () => {
    const initials = select.value;
    if (!initials) {
      alert("Select your initials first.");
      return;
    }
    saveJSON(STORAGE.session, { initials });
    gate.hidden = true;
    onReady();
  });

  gate.hidden = false;
}
