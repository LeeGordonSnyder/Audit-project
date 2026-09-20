"use strict";

// Mandatory on every fresh load — asked for specifically so a device
// changing hands between staff can't silently keep the previous person's
// initials. onReady() only runs once someone actually confirms who they
// are; nothing else in the app initializes before that.
function initLoginGate(onReady) {
  const gate = document.getElementById("login-gate");
  const select = document.getElementById("login-initials-select");

  renderLoginInitialsOptions();

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

  document.getElementById("login-add-user-toggle-btn").addEventListener("click", () => {
    document.getElementById("login-add-user-row").hidden = false;
    document.getElementById("login-add-user-toggle-btn").hidden = true;
    document.getElementById("login-new-initials-input").focus();
  });

  document.getElementById("login-add-user-cancel-btn").addEventListener("click", closeLoginAddUser);
  document.getElementById("login-add-user-save-btn").addEventListener("click", saveLoginAddUser);

  gate.hidden = false;
}

// The roster comes from the shared sheet (loaded into STORAGE.staffInitials
// before the gate ever renders — see app.js's boot sequence), falling back
// to a hardcoded list only if nothing's ever been fetched successfully.
function renderLoginInitialsOptions(preselect) {
  const select = document.getElementById("login-initials-select");
  const selected = preselect || loadJSON(STORAGE.session, {}).initials || "";
  const roster = loadJSON(STORAGE.staffInitials, STAFF_INITIALS_FALLBACK);

  select.innerHTML =
    `<option value="" disabled ${selected ? "" : "selected"}>Select initials…</option>` +
    roster
      .map((i) => `<option value="${escapeHtml(i)}" ${i === selected ? "selected" : ""}>${escapeHtml(i)}</option>`)
      .join("");
}

function closeLoginAddUser() {
  document.getElementById("login-add-user-row").hidden = true;
  document.getElementById("login-add-user-toggle-btn").hidden = false;
  document.getElementById("login-new-initials-input").value = "";
  setStatus("login-add-user-status", "", false);
}

async function saveLoginAddUser() {
  const input = document.getElementById("login-new-initials-input");
  const initials = input.value.trim().toUpperCase();

  if (!initials) {
    setStatus("login-add-user-status", "Enter your initials first.", true);
    return;
  }

  const roster = loadJSON(STORAGE.staffInitials, STAFF_INITIALS_FALLBACK);
  if (roster.some((i) => i.toUpperCase() === initials)) {
    setStatus("login-add-user-status", "Already on the list — just select it above.", true);
    return;
  }

  if (!navigator.onLine) {
    setStatus("login-add-user-status", "Offline — can't add a new user without a connection.", true);
    return;
  }

  setStatus("login-add-user-status", "Adding…", false);

  try {
    await postStaffAdd(getWebhookUrl(), { initials });

    roster.push(initials);
    saveJSON(STORAGE.staffInitials, roster);
    renderLoginInitialsOptions(initials);
    closeLoginAddUser();
  } catch (e) {
    setStatus("login-add-user-status", "Couldn't reach the sheet — check your connection and try again.", true);
  }
}
