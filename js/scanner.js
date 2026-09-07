"use strict";

let html5QrCode = null;
let activeScanCallback = null;

function initScannerModal() {
  document.getElementById("scanner-modal-cancel").addEventListener("click", closeScanner);
}

function openScanner(title, onDecode) {
  if (typeof Html5Qrcode === "undefined") {
    alert("Camera scanner library failed to load (needs an internet connection the first time). You can still type values in manually, or use a handheld scanner.");
    return;
  }
  document.getElementById("scanner-modal-title").textContent = title;
  document.getElementById("scanner-modal").hidden = false;
  activeScanCallback = onDecode;

  html5QrCode = new Html5Qrcode("scanner-modal-view");
  html5QrCode
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 130 } },
      (decodedText) => {
        const cb = activeScanCallback;
        closeScanner();
        if (cb) cb(decodedText.trim());
      },
      () => {} /* ignore per-frame decode errors */
    )
    .catch(() => {
      alert("Couldn't start the camera. Check camera permission for this site in Settings > Safari.");
      closeScanner();
    });
}

function closeScanner() {
  document.getElementById("scanner-modal").hidden = true;
  activeScanCallback = null;
  if (html5QrCode) {
    const instance = html5QrCode;
    html5QrCode = null;
    instance
      .stop()
      .then(() => instance.clear())
      .catch(() => {});
  }
}
