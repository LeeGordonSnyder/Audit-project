"use strict";

// Mandatory on every fresh load — asked for specifically so a device
// changing hands between staff can't silently keep the previous person's
// initials. onReady() only runs once someone actually confirms who they
// are; nothing else in the app initializes before that.
function initLoginGate(onReady) {
  const gate = document.getElementById("login-gate");
  const select = document.getElementById("login-initials-select");

  renderInitialsOptions(select);

  document.getElementById("login-continue-btn").addEventListener("click", () => {
    const initials = select.value;
    if (!initials) {
      alert("Select your initials first.");
      return;
    }
    saveJSON(STORAGE.session, { initials });
    updateHeaderUserBadge();
    gate.hidden = true;
    onReady();
  });

  initAddUserWidget({
    toggleBtnId: "login-add-user-toggle-btn",
    rowId: "login-add-user-row",
    inputId: "login-new-initials-input",
    saveBtnId: "login-add-user-save-btn",
    cancelBtnId: "login-add-user-cancel-btn",
    statusId: "login-add-user-status",
    select,
  });

  gate.hidden = false;
}

// Lets staff check or switch the active user at any point after boot, e.g.
// if a device gets handed off mid-shift. Deliberately separate from the
// mandatory gate above: that one's Continue button re-runs the app's full
// init pipeline (data loads + every tab's event listeners), which would
// double up listeners if triggered a second time after boot. This one just
// updates the session.
function initChangeUserButton() {
  const modal = document.getElementById("change-user-modal");
  const select = document.getElementById("change-user-select");

  function open() {
    const current = loadJSON(STORAGE.session, {}).initials || "";
    document.getElementById("change-user-current").textContent = current || "nobody yet";
    renderInitialsOptions(select, current);
    modal.hidden = false;
  }
  function close() {
    modal.hidden = true;
  }

  document.getElementById("change-user-btn").addEventListener("click", open);
  document.getElementById("change-user-cancel-btn").addEventListener("click", close);

  document.getElementById("change-user-save-btn").addEventListener("click", () => {
    const initials = select.value;
    if (!initials) {
      alert("Select initials first.");
      return;
    }
    saveJSON(STORAGE.session, { initials });
    updateHeaderUserBadge();
    close();
  });

  initAddUserWidget({
    toggleBtnId: "change-user-add-toggle-btn",
    rowId: "change-user-add-row",
    inputId: "change-user-new-initials-input",
    saveBtnId: "change-user-add-save-btn",
    cancelBtnId: "change-user-add-cancel-btn",
    statusId: "change-user-add-status",
    select,
  });

  updateHeaderUserBadge();
}

// Keeps the header's "who's active" pill in sync — called after login and
// after every change-user switch.
function updateHeaderUserBadge() {
  const el = document.getElementById("header-user-initials");
  if (!el) return;
  el.textContent = loadJSON(STORAGE.session, {}).initials || "—";
}

// The roster comes from the shared sheet (loaded into STORAGE.staffInitials
// before the login gate ever renders — see app.js's boot sequence), falling
// back to a hardcoded list only if nothing's ever been fetched successfully.
function renderInitialsOptions(select, preselect) {
  const selected = preselect || loadJSON(STORAGE.session, {}).initials || "";
  const roster = loadJSON(STORAGE.staffInitials, STAFF_INITIALS_FALLBACK);

  select.innerHTML =
    `<option value="" disabled ${selected ? "" : "selected"}>Select initials…</option>` +
    roster
      .map((i) => `<option value="${escapeHtml(i)}" ${i === selected ? "selected" : ""}>${escapeHtml(i)}</option>`)
      .join("");
}

// Shared "+ Add User" mini-flow used by both the mandatory login gate and
// the Change User modal — adds new initials to the shared roster sheet and
// re-renders+selects it in whichever dropdown triggered it.
function initAddUserWidget({ toggleBtnId, rowId, inputId, saveBtnId, cancelBtnId, statusId, select }) {
  const toggleBtn = document.getElementById(toggleBtnId);
  const row = document.getElementById(rowId);
  const input = document.getElementById(inputId);

  function close() {
    row.hidden = true;
    toggleBtn.hidden = false;
    input.value = "";
    setStatus(statusId, "", false);
  }

  toggleBtn.addEventListener("click", () => {
    row.hidden = false;
    toggleBtn.hidden = true;
    input.focus();
  });

  document.getElementById(cancelBtnId).addEventListener("click", close);

  document.getElementById(saveBtnId).addEventListener("click", async () => {
    const initials = input.value.trim().toUpperCase();

    if (!initials) {
      setStatus(statusId, "Enter your initials first.", true);
      return;
    }

    const roster = loadJSON(STORAGE.staffInitials, STAFF_INITIALS_FALLBACK);
    if (roster.some((i) => i.toUpperCase() === initials)) {
      setStatus(statusId, "Already on the list — just select it above.", true);
      return;
    }

    if (!navigator.onLine) {
      setStatus(statusId, "Offline — can't add a new user without a connection.", true);
      return;
    }

    setStatus(statusId, "Adding…", false);

    try {
      await postStaffAdd(getWebhookUrl(), { initials });

      roster.push(initials);
      saveJSON(STORAGE.staffInitials, roster);
      renderInitialsOptions(select, initials);
      close();
    } catch (e) {
      setStatus(statusId, "Couldn't reach the sheet — check your connection and try again.", true);
    }
  });
}
