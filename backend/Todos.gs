/* ============================================================================
   Oakridge Product Suite — Team to-do list (Todos.gs)

   A shared to-do list for the app's Home screen, kept on a "To-do" tab in
   the shared Google Sheet. Anyone can add a task, assign it to someone (or
   leave it for anyone), and tick it off: the tick stamps their initials and
   the time. Open tasks stay until they're done; done tasks show in the app
   for a day, and stay on the tab as a record.

   Add this as a NEW file in the existing Apps Script project (Files → + →
   Script → "Todos"), then add TWO lines to Code.gs — see backend/README.md.
   ========================================================================== */

const TODO = {
  SHEET: "To-do",
  HEADER: ["ID", "TASK", "ASSIGNED TO", "ADDED BY", "ADDED", "DONE BY", "DONE"],
  COL: { ID: 1, TASK: 2, ASSIGNED: 3, ADDED_BY: 4, ADDED: 5, DONE_BY: 6, DONE: 7 },
  DONE_SHOWN_HOURS: 24, // done tasks drop off the app after this long
  MAX_TASK_CHARS: 200,
  CACHE_KEY: "doGet:todos", // Code.gs caches GETs for 10s; a change clears it
};

// GET ?sheet=todos
function getTodosForApp() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TODO.SHEET);
  return { ok: true, todos: sh ? todoRead_(sh) : [] };
}

// POST { type: "todoadd" | "tododone" | "todoundo" | "todoassign" | "tododelete", ... }
// Answers with the whole list, so the app shows the change straight away.
function handleTodoPost(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = todoSheet_();
    const who = todoInitials_(body.initials);
    const now = new Date();
    if (body.type === "todoadd") {
      const task = String(body.task || "").replace(/\s+/g, " ").trim().slice(0, TODO.MAX_TASK_CHARS);
      if (!task) return jsonResponse({ ok: false, error: "The task is empty." });
      sh.appendRow([Utilities.getUuid(), task, todoInitials_(body.assignedTo), who, now, "", ""]);
    } else {
      const row = todoFindRow_(sh, body.id);
      if (!row) return jsonResponse({ ok: false, error: "That task isn't on the list any more. Refresh to see the latest." });
      if (body.type === "tododone") sh.getRange(row, TODO.COL.DONE_BY, 1, 2).setValues([[who, now]]);
      else if (body.type === "todoundo") sh.getRange(row, TODO.COL.DONE_BY, 1, 2).setValues([["", ""]]);
      else if (body.type === "todoassign") sh.getRange(row, TODO.COL.ASSIGNED).setValue(todoInitials_(body.assignedTo));
      else if (body.type === "tododelete") sh.deleteRow(row);
      else return jsonResponse({ ok: false, error: "Unknown to-do request: " + body.type });
    }
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(TODO.CACHE_KEY);
    return jsonResponse({ ok: true, todos: todoRead_(sh) });
  } finally {
    lock.releaseLock();
  }
}

// Open tasks, plus tasks done within the last DONE_SHOWN_HOURS. A task typed
// straight into the tab gets an ID here, so the app can act on it, and one
// ticked off by typing initials under DONE BY gets its DONE time.
function todoRead_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const range = sh.getRange(2, 1, last - 1, TODO.HEADER.length);
  const rows = range.getValues();
  // only the filled-in cells are written, so a change made meanwhile on
  // another row is never written over
  rows.forEach((r, i) => {
    if (!String(r[1]).trim()) return;
    if (!String(r[0]).trim()) {
      r[0] = Utilities.getUuid();
      sh.getRange(i + 2, TODO.COL.ID).setValue(r[0]);
    }
    if (String(r[5]).trim() && !r[6]) {
      r[6] = new Date();
      sh.getRange(i + 2, TODO.COL.DONE).setValue(r[6]);
    }
  });
  const cutoff = Date.now() - TODO.DONE_SHOWN_HOURS * 3600 * 1000;
  return rows
    .filter((r) => String(r[1]).trim())
    .map((r) => ({
      id: String(r[0]),
      task: String(r[1]).trim(),
      assignedTo: todoInitials_(r[2]),
      addedBy: todoInitials_(r[3]),
      addedAt: todoIso_(r[4]),
      doneBy: todoInitials_(r[5]),
      doneAt: todoIso_(r[6]),
    }))
    .filter((t) => !t.doneAt || new Date(t.doneAt).getTime() >= cutoff);
}

function todoSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TODO.SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(TODO.SHEET);
  sh.getRange(1, 1, 1, TODO.HEADER.length).setValues([TODO.HEADER]).setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.hideColumns(TODO.COL.ID);
  sh.setColumnWidth(TODO.COL.TASK, 360);
  sh.getRange("E:E").setNumberFormat("mmm d, h:mm am/pm");
  sh.getRange("G:G").setNumberFormat("mmm d, h:mm am/pm");
  return sh;
}

function todoFindRow_(sh, id) {
  id = String(id || "").trim();
  const last = sh.getLastRow();
  if (!id || last < 2) return 0;
  const ids = sh.getRange(2, TODO.COL.ID, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return 0;
}

function todoInitials_(v) {
  return String(v || "").trim().toUpperCase().slice(0, 4);
}

function todoIso_(v) {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? "" : d.toISOString();
}

// Node test harness hook (ignored by Apps Script)
if (typeof module !== "undefined") {
  module.exports = { TODO, getTodosForApp, handleTodoPost, todoRead_ };
}
