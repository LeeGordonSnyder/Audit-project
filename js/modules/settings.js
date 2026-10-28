"use strict";

/* ---------- Settings, roster & feedback ----------
   Everything administrative in one modal, reachable from any screen. */

const APP_VERSION = "2.1.0";

function openSettings() {
  document.getElementById("settings-url").value = getWebhookUrl();
  document.getElementById("settings-key").value = getApiKey();
  setStatus("settings-status", "", false);
  renderSettingsRoster();
  const lastSync = loadJSON(STORE.lastSync, null);
  document.getElementById("settings-about").textContent =
    `Version ${APP_VERSION} · signed in as ${currentInitials() || "—"} · ` +
    (lastSync ? `last full sync ${new Date(lastSync).toLocaleString()}` : "never fully synced");
  openModal("settings-modal");
}

function renderSettingsRoster() {
  document.getElementById("settings-roster").innerHTML = loadStaffRoster()
    .map((i) => `<span class="chip static">${escapeHtml(i)}</span>`)
    .join("");
}

function saveSettings() {
  const url = document.getElementById("settings-url").value.trim();
  const key = document.getElementById("settings-key").value.trim();
  if (url && !/^https:\/\//.test(url)) {
    setStatus("settings-status", "The Sheet URL should start with https://", true);
    return;
  }
  setWebhookUrl(url);
  setApiKey(key);
  setStatus("settings-status", "Saved. Pulling from the sheet…", false);
  refreshSharedData().then(({ ok, unauthorized }) =>
    setStatus(
      "settings-status",
      ok ? "Saved and synced." : unauthorized ? "Saved, but the sheet rejected this access key." : "Saved, but couldn't reach the sheet.",
      !ok
    )
  );
}

/* ---------- Roster: shared "+ Add initials" flow ---------- */

async function addStaffInitials(input, statusEl, onAdded) {
  const initials = input.value.trim().toUpperCase();
  if (!initials) {
    setStatus(statusEl, "Enter initials first.", true);
    return;
  }
  const roster = loadStaffRoster();
  if (roster.some((i) => i.toUpperCase() === initials)) {
    setStatus(statusEl, "Already on the list.", true);
    return;
  }
  if (!requireOnline(statusEl, "added")) return;
  setStatus(statusEl, "Adding…", false);
  try {
    await api.staffAdd({ initials });
    saveJSON(STORE.staffInitials, [...roster, initials]);
    input.value = "";
    setStatus(statusEl, `Added ${initials}.`, false);
    onAdded(initials);
  } catch (e) {
    setStatus(statusEl, "Couldn't reach the sheet — try again.", true);
  }
}

/* ---------- Feedback (one-way, to the Feedback sheet) ---------- */

function openFeedback() {
  closeModal("settings-modal");
  document.getElementById("feedback-text").value = "";
  setStatus("feedback-status", "", false);
  openModal("feedback-modal");
  document.getElementById("feedback-text").focus();
}

async function submitFeedback(btn) {
  const text = document.getElementById("feedback-text").value.trim();
  if (!text) {
    setStatus("feedback-status", "Type something first.", true);
    return;
  }
  if (!requireOnline("feedback-status", "sent")) return;
  setStatus("feedback-status", "Sending…", false);
  await withBusy(btn, async () => {
    try {
      await api.feedback({
        id: uid(),
        initials: currentInitials(),
        date: todayISO(),
        // Tagged so feedback on the rebuild is easy to tell apart in the
        // shared Feedback sheet while both versions are in use.
        feedback: `[v2] ${text}`,
        timestamp: new Date().toISOString(),
      });
      closeModal("feedback-modal");
      toast("Thanks — feedback sent");
    } catch (e) {
      setStatus("feedback-status", "Couldn't reach the sheet — try again.", true);
    }
  });
}

function initSettings() {
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("settings-save-btn").addEventListener("click", saveSettings);
  document.getElementById("settings-feedback-btn").addEventListener("click", openFeedback);
  document.getElementById("feedback-submit-btn").addEventListener("click", (e) => submitFeedback(e.currentTarget));
  document.getElementById("settings-add-btn").addEventListener("click", () =>
    addStaffInitials(document.getElementById("settings-add-input"), "settings-add-status", renderSettingsRoster)
  );
}
