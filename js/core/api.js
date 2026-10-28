"use strict";

/* ---------- Backend (Google Sheet via Apps Script) ----------
   Same endpoints, same payloads as the original app — the rebuild changes
   nothing server-side. Every request carries the shared access key; see
   "Securing the backend" in the original app's README. */

function getWebhookUrl() {
  return loadString(STORE.webhookUrl, LEGACY_KEYS.webhookUrl) || DEFAULT_WEBHOOK_URL;
}

function setWebhookUrl(url) {
  saveString(STORE.webhookUrl, url);
}

function getApiKey() {
  return loadString(STORE.apiKey, LEGACY_KEYS.apiKey);
}

// "own" = entered in this app, "legacy" = borrowed (read-only) from the
// original app in this same browser, "" = no key on this device at all.
function apiKeySource() {
  try {
    if (localStorage.getItem(STORE.apiKey)) return "own";
    if (localStorage.getItem(LEGACY_KEYS.apiKey)) return "legacy";
  } catch (e) {
    // storage blocked — treat as no key
  }
  return "";
}

function setApiKey(key) {
  saveString(STORE.apiKey, key);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Apps Script occasionally drops or times out a request under load; a few
// retries with backoff clears most of those without anyone noticing.
const SYNC_RETRIES = 3;
const SYNC_RETRY_DELAY_MS = 700;
// A request that never answers must never hang the app (a stalled Apps
// Script call once left the boot screen spinning forever) — every attempt
// is capped, after which it counts as a failed attempt like any other.
const REQUEST_TIMEOUT_MS = 20000;

// The backend rejected the access key. Not a blip — never retried, and
// surfaced to the person so they can fix the key.
class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

function isUnauthorized(e) {
  return e instanceof UnauthorizedError;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function checkAuth(data) {
  if (data && !Array.isArray(data) && data.ok === false && /unauthori[sz]ed/i.test(data.error || "")) {
    throw new UnauthorizedError();
  }
}

async function postToSheet(payload, attempt = 1) {
  let data;
  try {
    const res = await fetchWithTimeout(getWebhookUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight Apps Script can't answer
      body: JSON.stringify({ ...payload, key: getApiKey() }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    // Apps Script answers 200 even when the handler throws (the body is an
    // HTML error page), so only a parseable JSON body counts as success.
    data = JSON.parse(await res.text());
  } catch (e) {
    if (attempt >= SYNC_RETRIES) throw e;
    await sleep(SYNC_RETRY_DELAY_MS * attempt);
    return postToSheet(payload, attempt + 1);
  }
  checkAuth(data);
  // A well-formed failure isn't a blip a retry would fix — surface it.
  if (data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}

async function fetchFromSheet(sheet, { key = getApiKey(), retries = SYNC_RETRIES } = {}, attempt = 1) {
  const url = getWebhookUrl();
  const sep = url.includes("?") ? "&" : "?";
  let data;
  try {
    const res = await fetchWithTimeout(`${url}${sep}sheet=${sheet}&key=${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (e) {
    if (attempt >= retries) throw e;
    await sleep(SYNC_RETRY_DELAY_MS * attempt);
    return fetchFromSheet(sheet, { key, retries }, attempt + 1);
  }
  checkAuth(data);
  return data;
}

// Checks a key against the backend without saving it. Resolves to
// "ok" | "unauthorized" | "unreachable".
async function verifyApiKey(key) {
  try {
    await fetchFromSheet("staff", { key, retries: 1 });
    return "ok";
  } catch (e) {
    return isUnauthorized(e) ? "unauthorized" : "unreachable";
  }
}

const api = {
  pushProduct: (item) => postToSheet({ type: "master", ...item }),
  tagAssign: (p) => postToSheet({ type: "tagassign", ...p }),
  staffAdd: (p) => postToSheet({ type: "staffadd", ...p }),
  auditBatch: (entries) => postToSheet({ type: "auditbatch", entries }),
  consolBoxClose: (p) => postToSheet({ type: "consolboxclose", ...p }),
  consolUpdate: (p) => postToSheet({ type: "consolupdate", ...p }),
  consolCountUpdate: (p) => postToSheet({ type: "consolcountupdate", ...p }),
  consolLogResolve: (p) => postToSheet({ type: "consollogresolve", ...p }),
  receivingImport: (item) => postToSheet({ type: "receivingimport", ...item }),
  receivingImportBatch: (items) => postToSheet({ type: "receivingimportbatch", items }),
  receivingStatus: (p) => postToSheet({ type: "receivingstatus", ...p }),
  checkFloorUpdate: (p) => postToSheet({ type: "checkfloorupdate", ...p }),
  floorPickUpdate: (p) => postToSheet({ type: "floorpickupdate", ...p }),
  floor86Restock: (p) => postToSheet({ type: "floor86restock", ...p }),
  floorRestockAdd: (p) => postToSheet({ type: "floorrestockadd", ...p }),
  feedback: (p) => postToSheet({ type: "feedback", ...p }),
};
