"use strict";

function initFeedback() {
  document.getElementById("feedback-btn").addEventListener("click", openFeedbackModal);
  document.getElementById("feedback-submit-btn").addEventListener("click", submitFeedback);
  document.getElementById("feedback-cancel-btn").addEventListener("click", closeFeedbackModal);
}

function openFeedbackModal() {
  document.getElementById("feedback-text").value = "";
  setStatus("feedback-status", "", false);
  document.getElementById("feedback-modal").hidden = false;
  document.getElementById("feedback-text").focus();
}

function closeFeedbackModal() {
  document.getElementById("feedback-modal").hidden = true;
}

async function submitFeedback() {
  const textEl = document.getElementById("feedback-text");
  const text = textEl.value.trim();
  if (!text) {
    setStatus("feedback-status", "Type something before submitting.", true);
    return;
  }

  if (!navigator.onLine) {
    setStatus("feedback-status", "Offline — try again once you have a connection.", true);
    return;
  }

  const session = loadJSON(STORAGE.session, {});
  const initials = (session.initials || "").trim();
  const submitBtn = document.getElementById("feedback-submit-btn");

  setStatus("feedback-status", "Sending…", false);
  submitBtn.disabled = true;

  try {
    await postFeedback(getWebhookUrl(), {
      id: uid(),
      initials,
      date: todayISO(),
      feedback: text,
      timestamp: new Date().toISOString(),
    });
    closeFeedbackModal();
  } catch (e) {
    setStatus("feedback-status", "Couldn't reach the sheet — check your connection and try again.", true);
  } finally {
    submitBtn.disabled = false;
  }
}
