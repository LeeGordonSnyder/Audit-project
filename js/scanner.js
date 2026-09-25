"use strict";

let html5QrCode = null;
let activeScanCallback = null;
let startPromise = null; // the in-flight start() call, if any — never stop() before this settles
let scannerBusy = false; // guards against a second scan session opening before the first tears down
let scannerContinuous = false; // when true, the camera stays open across multiple decodes
let closingPromise = null; // the in-flight closeScanner() call, if any — see closeScanner()

function initScannerModal() {
  document.getElementById("scanner-modal-cancel").addEventListener("click", closeScanner);
}

// opts.continuous: true keeps the camera running after every decode
// (calling onDecode repeatedly) instead of closing after the first one —
// for scanning a stack of boxes/items in one session. The user closes it
// themselves via the modal's button (labeled "Done Scanning" in this mode).
async function openScanner(title, onDecode, opts = {}) {
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
  scannerContinuous = !!opts.continuous;

  document.getElementById("scanner-modal-title").textContent = title;
  document.getElementById("scanner-modal-cancel").textContent = scannerContinuous ? "Done Scanning" : "Cancel";
  document.getElementById("scanner-modal-feedback").textContent = "";
  document.getElementById("scanner-modal").hidden = false;
  activeScanCallback = onDecode;

  const instance = new Html5Qrcode("scanner-modal-view");
  html5QrCode = instance;

  startPromise = instance
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 130 } },
      (decodedText) => {
        if (scannerContinuous) {
          if (activeScanCallback) activeScanCallback(decodedText.trim());
          // camera keeps running — the user closes it manually when done
        } else {
          const cb = activeScanCallback;
          closeScanner();
          if (cb) cb(decodedText.trim());
        }
      },
      () => {} /* ignore per-frame decode errors */
    )
    .catch(() => {
      alert("Couldn't start the camera. Check camera permission for this site in Settings > Safari.");
      closeScanner();
    });

  await startPromise;
}

// Callers (openScanner()'s own guard, a Cancel/Done tap, and now a
// continuous-mode handler reacting to one particular decode) can all call
// this around the same time. Without coalescing, a second call started
// while the first is still awaiting instance.stop() would see html5QrCode
// already nulled out, skip straight past its own stop()/clear(), and
// return as if closed — letting a caller (e.g. openScanner()'s guard)
// start a brand new camera session while the original stop() is still
// resolving in the background. That's the same "stuck camera" hazard the
// start/stop-ordering comment below warns about, just from the other
// direction. Every caller instead awaits the one real close in progress.
async function closeScanner() {
  if (closingPromise) return closingPromise;

  // The reset-to-null has to happen in a .finally() chained on here, not
  // as the last line inside the async body below: this whole statement is
  // "closingPromise = <evaluate the right-hand side>", and the right-hand
  // side fully evaluates (synchronously, when there's no instance to stop
  // and so no real await inside it) BEFORE that outer assignment runs.
  // Resetting closingPromise to null from inside the body would happen
  // first, then get immediately clobbered back to a truthy (already-
  // resolved) promise by the outer assignment completing after it. Once
  // that happens — which it does the very first time this is ever called
  // with no camera open, e.g. the first tab switch after load — every
  // later call sees a permanently non-null closingPromise and returns
  // immediately without ever running again, so a real open camera can
  // never actually be stopped from then on. .finally()'s callback is
  // guaranteed to run as a later microtask, strictly after this
  // assignment has already completed, so it can't be clobbered this way.
  closingPromise = closeScannerNow().finally(() => {
    closingPromise = null;
  });

  return closingPromise;
}

async function closeScannerNow() {
  document.getElementById("scanner-modal").hidden = true;
  activeScanCallback = null;
  scannerContinuous = false;

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
