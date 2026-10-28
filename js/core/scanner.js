"use strict";

let html5QrCode = null;
let activeScanCallback = null;
let startPromise = null; // the in-flight start() call, if any — never stop() before this settles
let scannerBusy = false; // guards against a second scan session opening before the first tears down
let scannerContinuous = false; // when true, the camera stays open across multiple decodes
let closingPromise = null; // the in-flight closeScanner() call, if any — see closeScanner()
let scannerZoomCapability = null; // { min, max, step } from the current track, or null if unsupported

function initScannerModal() {
  document.getElementById("scanner-modal-cancel").addEventListener("click", closeScanner);
  document.getElementById("scanner-zoom-out-btn").addEventListener("click", () => stepScannerZoom(-1));
  document.getElementById("scanner-zoom-in-btn").addEventListener("click", () => stepScannerZoom(1));
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
      {
        fps: 10,
        qrbox: { width: 260, height: 130 },
        // A phone's back camera defaults (picked by the OS/browser, not
        // this app) are often a wide-angle lens with a focus range that
        // doesn't go nearly as close as you'd want for a barcode held a
        // few inches away. "continuous" keeps the camera re-focusing
        // instead of locking on the first frame (Chrome on Android reads
        // this; browsers that don't understand the constraint name just
        // ignore it, including iOS Safari, which already autofocuses
        // continuously on its own). The higher ideal resolution gives the
        // decoder more real detail to work with at a given distance,
        // independent of focus.
        videoConstraints: {
          facingMode: "environment",
          focusMode: "continuous",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      },
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
  if (html5QrCode === instance) await setupScannerZoom(instance);
}

/* ---------- Zoom: a software stand-in for "can't get close enough" ----------
   A lens's true minimum focus distance is a hardware limit no constraint
   can override — if a camera genuinely can't focus any closer than, say,
   10cm, getting closer just makes it blurrier. The fix is the opposite:
   back off to outside that limit, then zoom in digitally to bring the
   barcode back up to a readable size. Only shown when the running camera
   track actually reports zoom support (mainly Android Chrome — iOS Safari
   doesn't expose track capabilities the same way, so this plainly stays
   hidden there rather than showing a control that does nothing). The
   chosen zoom level is remembered per device (see STORE.scannerZoom) and
   re-applied automatically next time, since it's the phone's camera that
   needs it, not anything about who's signed in. */

async function setupScannerZoom(instance) {
  const row = document.getElementById("scanner-zoom-row");
  scannerZoomCapability = null;

  let capabilities;
  try {
    capabilities = instance.getRunningTrackCapabilities();
  } catch (e) {
    row.hidden = true;
    return;
  }

  const zoom = capabilities && capabilities.zoom;
  if (!zoom || zoom.min === zoom.max) {
    row.hidden = true;
    return;
  }

  scannerZoomCapability = { min: zoom.min, max: zoom.max, step: zoom.step || (zoom.max - zoom.min) / 10 || 0.1 };
  row.hidden = false;

  const remembered = loadJSON(STORE.scannerZoom, null) ?? loadJSON(LEGACY_KEYS.scannerZoom, null);
  const initial = typeof remembered === "number" && Number.isFinite(remembered) ? clampScannerZoom(remembered) : zoom.min;
  await applyScannerZoom(instance, initial);
}

function clampScannerZoom(value) {
  if (!scannerZoomCapability) return value;
  return Math.min(scannerZoomCapability.max, Math.max(scannerZoomCapability.min, value));
}

async function applyScannerZoom(instance, value) {
  const clamped = clampScannerZoom(value);
  try {
    await instance.applyVideoConstraints({ zoom: clamped });
    document.getElementById("scanner-zoom-label").textContent = `${clamped.toFixed(1)}x`;
    saveJSON(STORE.scannerZoom, clamped);
  } catch (e) {
    // Reported support but rejected the actual call — leave the label/
    // stored value as whatever last succeeded rather than guessing.
  }
}

function stepScannerZoom(direction) {
  if (!html5QrCode || !scannerZoomCapability) return;
  const current = Number(loadJSON(STORE.scannerZoom, scannerZoomCapability.min)) || scannerZoomCapability.min;
  applyScannerZoom(html5QrCode, current + direction * scannerZoomCapability.step);
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
  document.getElementById("scanner-zoom-row").hidden = true;
  activeScanCallback = null;
  scannerContinuous = false;
  scannerZoomCapability = null;

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
