"use strict";

function normalize(s) {
  return (s || "").toString().trim().toLowerCase();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function uid() {
  return Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function todayISO() {
  // toISOString() converts to UTC first -- for any timezone behind UTC
  // (all of North America), that rolls the date over to tomorrow for the
  // last several hours of every local day (e.g. anytime after ~4-5pm
  // Pacific). Build the string from the local date parts instead.
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setStatus(elId, message, isError) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", !!isError);
}

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
