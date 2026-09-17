"use strict";

let html5QrCode = null;
let activeScanCallback = null;
let startPromise = null; // the in-flight start() call, if any — never stop() before this settles
let scannerBusy = false; // guards against a second scan session opening before the first tears down

function initScannerModal() {
  document.getElementById("scanner-modal-cancel").addEventListener("click", closeScanner);
}

async function openScanner(title, onDecode) {
  if (typeof Html5Qrcode === "undefined") {
    alert("Camera scanner library failed to load (needs an internet connection the first time). You can still type values in manually, or use a handheld scanner.");
    return;
  }

  // Stopping html5-qrcode before its start() has actually settled is what
  // tends to leave the camera stream open and stuck (nothing short of a
  // page reload recovers it). Closing out any still-active session first —
  // and actually waiting for it — keeps every start()/stop() pair strictly
  // sequential instead of racing.
  if (scannerBusy) {
    await closeScanner();
  }
  scannerBusy = true;

  document.getElementById("scanner-modal-title").textContent = title;
  document.getElementById("scanner-modal").hidden = false;
  activeScanCallback = onDecode;

  const instance = new Html5Qrcode("scanner-modal-view");
  html5QrCode = instance;

  startPromise = instance
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

  await startPromise;
}

async function closeScanner() {
  document.getElementById("scanner-modal").hidden = true;
  activeScanCallback = null;

  const instance = html5QrCode;
  html5QrCode = null;

  if (instance) {
    try {
      // Wait for start() to finish settling (success or failure) before
      // ever calling stop() — calling it while start() is still in flight
      // is the specific thing that orphans the camera stream.
      if (startPromise) await startPromise.catch(() => {});
      await instance.stop();
      await instance.clear();
    } catch (e) {
      // Already stopped/cleared, or never actually started — nothing to do.
    }
  }

  scannerBusy = false;
}
