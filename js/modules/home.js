"use strict";

/* ---------- Home ----------
   The first screen after sign-in: what needs attention right now, a short
   set of KPIs, and one-tap shortcuts into the most common next step. */

function homeKpis() {
  const weekStart = startOfWeek();
  const inThisWeek = (value) => {
    const d = parseDay(value);
    return d && d >= weekStart;
  };

  const counts = loadJSON(STORE.auditLog, []).filter((e) => inThisWeek(e.date || e.timestamp));
  const within = counts.filter((e) => !isFlaggedVariance(e)).length;
  const accuracy = counts.length ? Math.round((within / counts.length) * 100) : null;

  const consolOpen = loadJSON(STORE.consolMaster, []).filter((i) => !isConsolProcessed(i)).length;
  const boxesThisWeek = loadJSON(STORE.receivingMaster, []).filter((b) => inThisWeek(b.physicallyReceivedDate)).length;
  const on86 = loadJSON(STORE.floorRestock, []).filter(isFloorOn86).length;

  return [
    {
      label: "Count accuracy",
      value: accuracy == null ? "—" : `${accuracy}%`,
      sub: counts.length ? `${plural(counts.length, "count")} this week` : "No counts this week",
      route: "counts",
    },
    { label: "Open consolidation lines", value: consolOpen, sub: "from HQ's list", route: "consol" },
    { label: "Boxes received", value: boxesThisWeek, sub: "this week", route: "receiving" },
    { label: "86 Board", value: on86, sub: on86 === 1 ? "item out of stock" : "items out of stock", route: "floor/86" },
  ];
}

/* ---------- Your shift today ----------
   Read from the Deployment tab in the sheet (built each morning from When I
   Work, then edited by leads as the day changes), matched on the signed-in
   person's initials, taken from their When I Work name ("Li Snyder" → LS). */

function fmtClock(min) {
  const h24 = Math.floor(min / 60), m = min % 60;
  const h = ((h24 + 11) % 12) + 1;
  return `${h}:${String(m).padStart(2, "0")}${h24 < 12 ? "am" : "pm"}`;
}

function myDeployment() {
  const saved = loadJSON(STORE.deployment, null);
  if (!saved) return null;
  if (!saved.deployment) return { d: null };
  const d = saved.deployment;
  const me = currentInitials().toUpperCase();
  const mine = (d.people || []).filter((p) => (p.initials || "").toUpperCase() === me);
  // Two people with the same initials: use the name picked on this phone,
  // or ask.
  const picked = loadJSON(STORE.deploymentPick, {})[me];
  const person = mine.length === 1 ? mine[0] : mine.find((p) => p.name === picked) || null;
  const choices = !person && mine.length > 1 ? mine.map((p) => p.name) : null;
  const codes = Object.fromEntries((saved.codes || []).map((c) => [c.code, c]));
  return { d, person, choices, picked: mine.length > 1, codes, isToday: d.date === todayISO() };
}

function renderShiftCard() {
  const el = document.getElementById("home-shift");
  const info = myDeployment();
  const head = `<div class="shift-head"><span class="kicker-sm">Your shift today</span></div>`;
  if (!info) {
    // Nothing saved: either this sheet has no deployment add-on (stay hidden),
    // or the request failed, which is worth saying.
    el.hidden = !deploymentError;
    if (deploymentError) el.innerHTML = `${head}<p class="hint">Couldn't load today's deployment (${escapeHtml(deploymentError)}). Tap ↻ to try again.</p>`;
    return;
  }
  el.hidden = false;
  const { d, person, choices, picked, codes, isToday } = info;
  if (!d) {
    el.innerHTML = `${head}<p class="hint">There's no Deployment tab in the sheet right now. Once a lead builds today's deployment, it shows here.</p>`;
    return;
  }
  if (!isToday) {
    el.innerHTML = `<div class="shift-head"><span class="kicker-sm">Your shift today</span></div>
      <p class="hint">Today's deployment hasn't been built yet${d.label ? ` (latest is ${escapeHtml(d.label)})` : ""}.</p>`;
    return;
  }
  if (choices) {
    el.innerHTML = `${head}<p class="hint">${choices.length} people on today's deployment have your initials. Which one are you? This phone will remember.</p>
      <div class="chips">${choices.map((n) => `<button type="button" class="chip" data-action="pick-shift" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join("")}</div>`;
    return;
  }
  if (!person || !person.blocks.length) {
    el.innerHTML = `<div class="shift-head"><span class="kicker-sm">Your shift today</span></div>
      <p class="hint">You're not on today's deployment. If that's wrong, ask a lead: your sign-in initials need to match your name on it (Li Snyder → LS).</p>`;
    return;
  }
  const now = (() => { const t = new Date(); return t.getHours() * 60 + t.getMinutes(); })();
  const span = person.end - person.start;
  const worked = person.blocks.filter((b) => b.code !== "B").reduce((a, b) => a + (b.end - b.start), 0);
  const style = (code) => {
    const c = codes[code];
    return c ? `background:${c.bg};color:${c.fg}` : "background:#ddd;color:#333";
  };
  const label = (code) => (codes[code] ? codes[code].label : code);
  const bar = person.blocks
    .map((b) => `<span class="seg" style="${style(b.code)};flex:${b.end - b.start}" title="${escapeHtml(label(b.code))}"></span>`)
    .join("");
  const marker = now > person.start && now < person.end
    ? `<span class="now-marker" style="left:${(((now - person.start) / span) * 100).toFixed(2)}%"></span>`
    : "";
  const status = now < person.start
    ? `Starts in ${formatDuration(person.start - now)}`
    : now >= person.end
    ? "Shift finished — nice work"
    : `On now · done in ${formatDuration(person.end - now)}`;
  const rows = person.blocks
    .map((b) => {
      const current = now >= b.start && now < b.end;
      return `<li class="${current ? "current" : ""}${now >= b.end ? " past" : ""}">
        <span class="code-chip" style="${style(b.code)}">${escapeHtml(b.code)}</span>
        <span class="blk-label">${escapeHtml(label(b.code))}${current ? ' <span class="pill pill-ok">now</span>' : ""}</span>
        <span class="blk-time">${fmtClock(b.start)} – ${fmtClock(b.end)}</span>
      </li>`;
    })
    .join("");
  el.innerHTML = `
    <div class="shift-head">
      <span class="kicker-sm">Your shift today · ${escapeHtml(d.label || "")}${picked ? ` · ${escapeHtml(person.name)} <button type="button" class="link-btn" data-action="unpick-shift">Not you?</button>` : ""}</span>
      <span class="hint">${escapeHtml(status)}</span>
    </div>
    <div class="shift-times"><strong>${fmtClock(person.start)}</strong> – <strong>${fmtClock(person.end)}</strong>
      <span class="hint">· ${formatDuration(worked)} on the floor</span></div>
    <div class="shift-bar">${bar}${marker}</div>
    <div class="shift-axis"><span>${fmtClock(person.start)}</span><span>${fmtClock(person.end)}</span></div>
    <ul class="shift-blocks">${rows}</ul>`;
}

function setShiftPick(name) {
  const picks = loadJSON(STORE.deploymentPick, {});
  const me = currentInitials().toUpperCase();
  if (name) picks[me] = name;
  else delete picks[me];
  saveJSON(STORE.deploymentPick, picks);
  renderShiftCard();
}

/* ---------- Team to-do list ----------
   One shared list from the "To-do" tab (Todos.gs add-on). Anyone can add a
   task and assign it to someone, or leave it for anyone. Ticking one off
   stamps the signed-in initials and the time. Open tasks stay until done;
   done ones show for a day. Hidden when the sheet has no to-do add-on. */

function todoWhen(iso, withTime) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const day = localDayISO(d) === todayISO() ? "today" : d.toLocaleDateString([], { month: "short", day: "numeric" });
  return withTime ? `${day}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : day;
}

function todoAssignOptions(selected) {
  const roster = [...new Set(loadStaffRoster().map((s) => String(s).toUpperCase()))];
  if (selected && !roster.includes(selected)) roster.push(selected);
  return [`<option value="">Anyone</option>`]
    .concat(roster.map((i) => `<option value="${escapeHtml(i)}"${i === selected ? " selected" : ""}>${escapeHtml(i)}</option>`))
    .join("");
}

function renderTodos() {
  const wrap = document.getElementById("home-todos-wrap");
  const saved = loadJSON(STORE.todos, null);
  wrap.hidden = !saved;
  if (!saved) return;
  const me = currentInitials().toUpperCase();
  const todos = saved.todos || [];
  // yours first, then anyone's, then everyone else's; oldest first in each
  const rank = (t) => (t.assignedTo === me ? 0 : t.assignedTo ? 2 : 1);
  const open = todos.filter((t) => !t.doneAt).sort((a, b) => rank(a) - rank(b) || String(a.addedAt).localeCompare(String(b.addedAt)));
  const done = todos.filter((t) => t.doneAt).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  const mine = open.filter((t) => t.assignedTo === me).length;
  document.getElementById("home-todos-count").textContent = open.length
    ? `${open.length} open${mine ? ` · ${mine} for you` : ""}`
    : "";

  const select = document.getElementById("todo-assign");
  const keep = select.value;
  select.innerHTML = todoAssignOptions("");
  select.value = keep;

  document.getElementById("home-todos").innerHTML = open.length
    ? open
        .map(
          (t) => `
      <li class="todo${t.assignedTo === me ? " mine" : ""}">
        <button type="button" class="todo-check" data-action="todo-done" data-id="${escapeHtml(t.id)}" aria-label="Mark done"></button>
        <div class="grow">
          <div class="todo-task">${escapeHtml(t.task)}</div>
          <div class="todo-meta">
            <label class="todo-for">For <select class="todo-reassign" data-id="${escapeHtml(t.id)}" aria-label="Assigned to">${todoAssignOptions(t.assignedTo)}</select></label>
            <span>Added by ${escapeHtml(t.addedBy || "?")} · ${escapeHtml(todoWhen(t.addedAt))}</span>
          </div>
        </div>
        <button type="button" class="todo-remove" data-action="todo-delete" data-id="${escapeHtml(t.id)}" aria-label="Remove task">✕</button>
      </li>`
        )
        .join("")
    : `<li class="todo-empty hint">Nothing to do. Add a task above.</li>`;

  const doneEl = document.getElementById("home-todos-done");
  doneEl.hidden = !done.length;
  doneEl.querySelector("summary").textContent = `Done in the last day (${done.length})`;
  doneEl.querySelector("ul").innerHTML = done
    .map(
      (t) => `
      <li class="todo done">
        <span class="todo-check checked" aria-hidden="true">✓</span>
        <div class="grow">
          <div class="todo-task">${escapeHtml(t.task)}</div>
          <div class="todo-meta"><span>Done by ${escapeHtml(t.doneBy || "?")} · ${escapeHtml(todoWhen(t.doneAt, true))}</span></div>
        </div>
        <button type="button" class="link-btn" data-action="todo-undo" data-id="${escapeHtml(t.id)}">Undo</button>
      </li>`
    )
    .join("");
}

// Sends one change and shows the list the sheet answers with.
async function todoSend(btn, type, payload, verb) {
  const status = document.getElementById("todo-status");
  if (!requireOnline(status, verb)) return false;
  setStatus(status, "");
  const run = async () => {
    try {
      const res = await api.todo(type, payload);
      if (!Array.isArray(res.todos)) throw new Error("the sheet's Code.gs is missing the to-do line in doPost (see backend/README.md)");
      saveTodos(res.todos);
      renderTodos();
      return true;
    } catch (e) {
      setStatus(status, `Couldn't update the to-do list: ${e.message || e}. Nothing was ${verb}.`, true);
      return false;
    }
  };
  return btn ? withBusy(btn, run) : run();
}

async function addTodo(btn) {
  const input = document.getElementById("todo-task");
  const task = input.value.trim();
  if (!task) return input.focus();
  const assignedTo = document.getElementById("todo-assign").value;
  if (await todoSend(btn, "todoadd", { task, assignedTo }, "added")) {
    input.value = "";
    document.getElementById("todo-assign").value = "";
  }
}

function formatDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h${m ? " " + m + "m" : ""}` : `${m}m`;
}

registerView("home", {
  init(root) {
    onAction(root, {
      go: (el) => goTo(el.dataset.route),
      "quick-count": () => goTo("counts", startCountScan),
      "quick-packslip": () => goTo("consol", startBoxCloseScan),
      "quick-boxes": () => goTo("receiving", startReceivingScan),
      "pick-shift": (el) => setShiftPick(el.dataset.name),
      "unpick-shift": () => setShiftPick(null),
      "todo-add": (el) => addTodo(el),
      "todo-done": (el) => {
        el.classList.add("checked");
        todoSend(el, "tododone", { id: el.dataset.id }, "ticked off").then((ok) => ok || el.classList.remove("checked"));
      },
      "todo-undo": (el) => todoSend(el, "todoundo", { id: el.dataset.id }, "changed"),
      "todo-delete": (el) => {
        const task = el.closest(".todo").querySelector(".todo-task").textContent;
        if (confirm(`Remove "${task}" from the list? Use this for mistakes; tick a task off when it's done.`)) {
          todoSend(el, "tododelete", { id: el.dataset.id }, "removed");
        }
      },
    });
    root.addEventListener("change", (e) => {
      const sel = e.target.closest(".todo-reassign");
      if (sel) todoSend(null, "todoassign", { id: sel.dataset.id, assignedTo: sel.value }, "reassigned").then((ok) => ok || renderTodos());
    });
    document.getElementById("todo-task").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addTodo(root.querySelector('[data-action="todo-add"]'));
    });
  },

  show() {
    const initials = currentInitials();
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    document.getElementById("home-greeting").textContent = `${greet}${initials ? ", " + initials : ""}`;

    renderShiftCard();
    renderTodos();

    const lastSync = loadJSON(STORE.lastSync, null);
    document.getElementById("home-freshness").textContent = lastSync
      ? `Synced with the sheet ${new Date(lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "Not synced with the sheet yet";

    document.getElementById("home-kpis").innerHTML = homeKpis()
      .map(
        (k) => `
        <button type="button" class="kpi" data-action="go" data-route="${k.route}">
          <span class="kpi-value">${escapeHtml(k.value)}</span>
          <span class="kpi-label">${escapeHtml(k.label)}</span>
          <span class="kpi-sub">${escapeHtml(k.sub)}</span>
        </button>`
      )
      .join("");

    const exceptions = computeExceptions();
    const actionable = exceptions.filter((e) => e.severity !== "info").length;
    document.getElementById("home-exceptions-count").textContent = exceptions.length
      ? actionable
        ? `${actionable} to act on`
        : "Just notes"
      : "";

    const listEl = document.getElementById("home-exceptions");
    if (exceptions.length === 0) {
      listEl.innerHTML = `<div class="all-clear"><span class="all-clear-icon">✓</span><div><strong>All clear.</strong><br><span class="hint">Nothing waiting on anyone right now.</span></div></div>`;
      return;
    }
    listEl.innerHTML = exceptions
      .map(
        (ex) => `
        <article class="exception sev-${ex.severity}">
          <div class="exception-head">
            <span class="sev-dot" aria-hidden="true"></span>
            <h3>${escapeHtml(ex.title)}</h3>
          </div>
          <p class="exception-detail">${escapeHtml(ex.detail)}</p>
          ${
            ex.items && ex.items.length
              ? `<ul class="exception-items">${ex.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
              : ""
          }
          <button type="button" class="btn secondary small" data-action="go" data-route="${escapeHtml(ex.action.route)}">${escapeHtml(
          ex.action.label
        )} ›</button>
        </article>`
      )
      .join("");
  },
});
